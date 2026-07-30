# Code Ground — Backend Architecture

> **Scope of this document:** This document explains the Code Ground backend as an independent software system — its layering, its internal service boundaries, its request/event lifecycles, and the engineering reasoning behind its structure. It assumes the reader may never open the frontend at all. Where frontend interaction is unavoidable (an API contract, a socket event), it is described only from the backend's side of that boundary.
>
> Companion documents: [`00_Project_Overview.md`](./00_Project_Overview.md) (product view), [`01_System_Architecture.md`](./01_System_Architecture.md) (whole-system view, including the frontend). This document goes deeper on everything in those two that is backend-internal, and avoids re-explaining what they already cover about cross-system concerns (authentication's *shared* nature, the CRDT collaboration model, the frontend's own layering) except where backend-specific context requires it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Backend Overview](#2-backend-overview)
3. [Backend Folder Structure](#3-backend-folder-structure)
4. [Express Server Architecture](#4-express-server-architecture)
5. [Configuration Layer](#5-configuration-layer)
6. [Routing Layer](#6-routing-layer)
7. [Middleware Architecture](#7-middleware-architecture)
8. [Controller Layer](#8-controller-layer)
9. [Service Layer](#9-service-layer)
10. [Socket Architecture](#10-socket-architecture)
11. [Docker Subsystem](#11-docker-subsystem)
12. [AI Integration](#12-ai-integration)
13. [Database Layer](#13-database-layer)
14. [Request Lifecycle](#14-request-lifecycle)
15. [Socket Request Lifecycle](#15-socket-request-lifecycle)
16. [Error Handling Strategy](#16-error-handling-strategy)
17. [Security](#17-security)
18. [Testing Strategy](#18-testing-strategy)
19. [Design Decisions](#19-design-decisions)
20. [Future Backend Improvements](#20-future-backend-improvements)
21. [Conclusion](#21-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the Backend

The backend is the system of record and the system of execution for Code Ground. Concretely, it is responsible for four categories of work that the frontend is never trusted to do itself:

1. **Identity and authorization** — who is this request from, and are they allowed to do what they're asking.
2. **Durable state** — projects, files, folders, chat history, snapshots, invitations: anything that must survive a page refresh or a server restart.
3. **Real-time coordination** — brokering CRDT updates, presence, and terminal I/O between many simultaneously connected clients.
4. **Privileged execution** — the one thing the frontend fundamentally *cannot* do itself: running arbitrary user code inside an isolated Docker container, and talking to an external AI provider with a server-held API key.

Every architectural decision in this document follows from those four responsibilities needing to be handled correctly, safely, and independently of whatever the frontend happens to be doing.

### 1.2 Architectural Goals

| Goal | Concrete meaning in this backend |
|---|---|
| **Separation of Concerns** | Routes declare surface, controllers translate HTTP, services own logic, models own schema — each layer has exactly one job |
| **Reusability** | The same service method backs both a REST controller and, where relevant, a Socket.IO handler — business logic is written once |
| **Maintainability** | A contributor can predict where a rule lives (validation → middleware/validators; business rule → services; schema constraint → models) without reading the whole codebase |
| **Scalability** | Stateless request handling wherever possible, with the (documented) exceptions — the execution queue, active sessions, live CRDT documents — called out explicitly rather than hidden |
| **Security** | Every trust boundary (HTTP route, socket connection, Docker container, AI request) is authenticated/authorized/bounded at that boundary |
| **Testability** | Services are plain, framework-agnostic functions/modules wherever possible, so they can be exercised directly in tests without spinning up HTTP or bootstrapping a database connection unless the test genuinely needs one |

### 1.3 Why a Service-Oriented Backend

The backend exposes its capabilities through **two independent entry points** — a REST API and three Socket.IO namespaces — and several capabilities (creating a file, joining a collaboration room, running code) are meaningfully reachable from more than one of them, or need the same business rule enforced regardless of entry point. A service-oriented layering — where **all business logic lives in services, and both REST controllers and socket handlers call into the same services** — is what makes that possible without duplicating logic (and risking the two entry points silently drifting apart on behavior). This is the single most load-bearing structural decision in the backend, and it is why §9 (Service Layer) is the largest section of this document.

### 1.4 Design Principles Followed

- **Thin edges, fat middle.** Routes and controllers are deliberately "dumb" — all judgment calls happen in services.
- **One source of truth per capability.** If two code paths need the same behavior, they call the same service; the behavior is never reimplemented a second time.
- **Fail fast, fail loud.** A missing Docker daemon, an unreachable database, an invalid token — all of these are designed to produce an immediate, explicit failure rather than a degraded silent one (see §4.6, §17).
- **Isolation of privileged subsystems.** The Docker execution engine and the AI integration are each contained to their own subtree of the codebase, reachable only through their own service APIs — nothing else in the backend imports `dockerode` or the Gemini SDK directly.

---

## 2. Backend Overview

At the highest level, every unit of work entering the backend passes through the same layered pipeline, regardless of whether it originated as an HTTP request or a Socket.IO event:

```
                              ┌───────────────┐
                              │    Client       │
                              │ (REST or Socket) │
                              └───────┬───────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │      Express Server        │
                         │  (HTTP + attached           │
                         │   Socket.IO server)          │
                         └───────────┬─────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │        Middleware           │
                         │  security headers, CORS,     │
                         │  body parsing, auth, role      │
                         │  authorization, validation       │
                         └───────────┬─────────────┘
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                  ▼
           ┌─────────────────┐                 ┌─────────────────┐
           │      Routes        │                 │   Socket Handlers   │
           │  (REST surface,     │                 │  (per namespace,      │
           │   declares which     │                 │   per event)           │
           │   middleware runs)   │                 └─────────┬─────────┘
           └───────┬───────┘                                   │
                   ▼                                            │
           ┌─────────────────┐                                 │
           │    Controllers      │                                 │
           │ (HTTP-shape only)   │                                 │
           └───────┬───────┘                                   │
                   └────────────────────┬─────────────────────┘
                                         ▼
                              ┌─────────────────────┐
                              │       Services          │
                              │  ALL business logic       │
                              │  lives here                 │
                              └───────────┬─────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
           ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
           │     MongoDB         │   │  Docker Engine     │   │   Gemini AI API    │
           │  (via Mongoose        │   │  (via dockerode,     │   │  (via provider       │
           │   models)              │   │   execution only)    │   │   abstraction)       │
           └─────────────────┘   └─────────────────┘   └─────────────────┘
```

Two structural facts fall out of this diagram that recur throughout the rest of the document:

- **Routes and Socket Handlers are two different entry points into the exact same Services layer.** Neither talks to MongoDB, Docker, or the AI provider directly.
- **Only the Service layer is allowed to reach into MongoDB, Docker, or the AI provider.** This is enforced by convention and directory structure, not a runtime guard — but it is consistently followed throughout the codebase.

---

## 3. Backend Folder Structure

The backend's `src/` directory is organized by **role**, not by feature — every file's directory tells you what *kind* of thing it is before you've read a single line of it.

| Folder | Responsibility |
|---|---|
| **`db/config/`** | Centralized environment configuration and the two external connections the whole backend depends on: the MongoDB connection and the Docker Engine client |
| **`db/models/`** and **`models/`** | Mongoose schema definitions. (The codebase carries two model directories — a legacy split from earlier development phases — with core domain entities such as `Project`/`File`/`User`/the CRDT persistence models in `db/models/`, and later-added entities such as `Folder`, `Snapshot`, `Invitation`, `ChatMessage`, and activity/notification models in `models/`. Both are consumed identically by the service layer; the split is a structural artifact rather than a meaningful architectural boundary.) |
| **`routes/`** | REST endpoint declarations — one file per resource area (auth, projects, files, folders, invitations, activity, snapshots, AI, execution, health) — each wiring its middleware chain and controller, nothing else |
| **`controllers/`** | Thin HTTP-shape translation between a route and a service |
| **`services/`** | All business logic — the largest and most important layer (see §9) |
| **`services/execution/`** | A deliberately self-contained subtree: the entire Docker-based execution engine (language configuration, workspace management, the concurrency queue, metrics, health checks, and both the batch and interactive execution orchestrators) |
| **`socket/`** | Socket.IO server initialization, namespace registration, room/presence/lock/awareness managers, and per-namespace event wiring |
| **`crdt/`** | The Yjs document lifecycle: hydration, persistence, snapshotting, awareness state |
| **`ai/`** | A second deliberately self-contained subtree: the AI provider abstraction, context/prompt builders, and per-capability services |
| **`middleware/`** | Cross-cutting request concerns: authentication, project authorization, async-error forwarding, centralized error handling, 404 handling |
| **`validators/`** | Per-domain `express-validator` rule sets (auth, projects, invitations, AI requests, snapshots, the legacy runner endpoint) |
| **`utils/`** | Small, dependency-free helpers: JWT signing/verification, password hashing, structured logging, and the API response/error shaping classes |
| **`__tests__/`** directories (co-located per subtree) | Automated tests, kept next to the code they exercise rather than in one parallel top-level tree — so a contributor changing `services/execution/` finds its tests in the same neighborhood |

**Why this structure, not a feature-based one:** because the *cross-cutting layering rule* (routes are thin, services own logic) is the property the project most needs to hold consistently as it grows — organizing by role makes violations of that rule visually obvious (business logic showing up in a controller file looks out of place immediately), which a feature-based folder structure would not surface nearly as clearly.

---

## 4. Express Server Architecture

### 4.1 Startup Lifecycle

```
1. Load environment configuration (db/config/env.js)
        │
        ▼
2. Require the Express app module
     - connects to MongoDB immediately (fail-fast: process exits
       non-zero if the connection cannot be established)
     - registers all global middleware (security headers, CORS,
       compression, cookie/body parsing, request logging)
     - mounts the full REST route tree
     - registers the 404 handler, then the global error handler
       (in that order — this order matters, see §7)
        │
        ▼
3. Create the underlying HTTP server and attach Socket.IO to it
        │
        ▼
4. Initialize Socket.IO:
     - attach the shared JWT auth middleware to the default namespace
     - register the default namespace's event handlers (editor
       collaboration)
     - initialize the /workspace namespace (its own auth + handlers)
     - initialize the /terminal namespace (its own auth + handlers)
        │
        ▼
5. Validate the execution engine's hard dependency BEFORE accepting
   traffic:
     - check Docker daemon reachability — if unreachable, log a clear
       error and exit the process rather than start in a silently
       broken state
     - check that every required language image is present locally —
       if any are missing, log a warning (non-fatal: other languages
       remain usable) rather than failing the boot
        │
        ▼
6. Begin listening for HTTP/WebSocket connections
```

### 4.2 Middleware Registration

Global middleware is registered once, in a fixed order, before any route is reachable: security headers, CORS policy, response compression, cookie parsing, and JSON/urlencoded body parsing. Route-specific middleware (authentication, authorization, per-route validation) is registered per-route inside the routing layer, not globally — see §6 and §7.

### 4.3 Route Registration

All REST routes are mounted under a single root router, itself mounted under `/api` implicitly by each sub-router's own prefix (`/api/auth`, `/api/projects`, `/api/execution`, etc.). Route registration order matters only in one respect: the 404 handler and the global error handler must be registered **last**, after every real route, so an unmatched path correctly falls through to "not found" rather than to a mismatched handler.

### 4.4 Socket.IO Initialization

Socket.IO is attached to the same underlying HTTP server the REST API uses (not a separate port/process), and is initialized in a fixed order: the default namespace's auth middleware and event handlers first, then the `/workspace` namespace, then the `/terminal` namespace — each namespace initializing its own authentication middleware and its own connection handler independently (see §10).

### 4.5 Error Handling at the Server Level

Every request that falls through every route without a match reaches a 404 handler that forwards a structured "not found" error to the global error handler, rather than responding directly — meaning **there is exactly one place in the entire backend that formats an error response body**, whether the error originated from a missing route, a validation failure, a thrown business error, or an unexpected exception (see §16).

### 4.6 Fail-Fast Startup Philosophy

Both of the backend's external hard dependencies — MongoDB and the Docker Engine — are checked at startup, and both failures are treated the same way: **log clearly, exit the process, and let the process supervisor/operator know immediately**, rather than starting an API that answers HTTP requests while one of its core capabilities is silently non-functional. This is a deliberate trade of "the server takes slightly longer, or refuses, to start" against "the server starts instantly but confusingly fails every execution or every database-backed request."

### 4.7 Graceful Shutdown — Current State

At present, the server does not register explicit `SIGTERM`/`SIGINT` shutdown handlers — a process stop is a hard stop. In practice this means any in-flight execution containers or open Socket.IO connections are not given an explicit drain/cleanup window on shutdown; they rely on Docker's own container lifecycle (a container is not left running just because the API process that started it exited) and on clients reconnecting and re-establishing state on their next connection. This is a known, honest gap rather than an implemented behavior — see §20 for the concrete improvement this implies.

---

## 5. Configuration Layer

### 5.1 What Is Centralized

A single configuration module loads every environment variable the backend needs — server port, environment mode, MongoDB connection string, JWT secrets and expiries, outbound email credentials, the frontend's URL (for CORS/email links), and the Gemini API key — from one root-level `.env` file, and exposes them as one plain configuration object that the rest of the codebase imports, rather than reading `process.env` directly wherever a value is needed.

| Configuration domain | What it covers |
|---|---|
| **Server** | Port, environment mode (development/production) |
| **Database** | MongoDB connection string |
| **Security** | JWT access/refresh secrets and expiry durations |
| **Email** | Outbound email credentials (used for verification/reset flows) |
| **Client** | The frontend's URL, used where the backend needs to reference it (e.g. email links) |
| **AI** | The Gemini API key |
| **Docker** | Not environment-variable-driven — the Docker client connects to a fixed local socket/named pipe path, since it always targets the local Docker daemon; execution-specific tunables (concurrency limit, session timeout) are read from their own environment variables directly inside the execution subsystem, with sensible defaults if unset |

### 5.2 Why Centralized Configuration

- **A single point of truth for "what can this backend be configured to do."** A new contributor (or an operator standing up a new environment) has one file to read, not a `grep` across the codebase for `process.env`.
- **Fail-fast defaults where correctness matters, silent defaults where convenience matters.** Values with no safe default (database URI, JWT secrets) are simply absent if unset — the code that needs them will fail loudly the first time it tries to use `undefined` as a secret, rather than the configuration layer inventing a fake one. Values with a genuinely safe default (port, environment mode) fall back to one inline.
- **Decouples configuration *shape* from configuration *source*.** Every consumer imports the same plain object regardless of whether a value ultimately came from a `.env` file, a container orchestrator's injected environment, or a secrets manager — changing the source requires touching one file, not every consumer.

---

## 6. Routing Layer

### 6.1 Organization

Routes are organized **one file per resource area**, each declaring only its URL paths, its middleware chain, and which controller method handles each:

| Route group | Resource area |
|---|---|
| **Auth routes** | Register, login, token refresh, logout, password reset, email verification |
| **Project routes** | Create/list/get/update/delete a project, membership listing, leaving a workspace |
| **Folder & File routes** | Project tree retrieval, file/folder create/rename/move/delete, file content save |
| **Invitation routes** | Inviting a member to a project by email |
| **Activity routes** | Reading a project's activity feed |
| **Snapshot routes** | Creating/listing/renaming/restoring/deleting project snapshots |
| **AI routes** | The five AI capabilities (chat, explain, review, refactor, generate) |
| **Execution routes** | The batch (REST) code execution endpoint |
| **Health routes** | The deep health-check endpoint |

### 6.2 Why Routes Stay Lightweight

A route file's job is to answer exactly one question per endpoint: **"what middleware must run, in what order, before this controller is called?"** It intentionally contains no conditional logic of its own — no route file branches on request content, queries a database, or shapes a response. This keeps the entire REST surface of the API readable end-to-end from the route files alone (every endpoint, its path, its required auth/role/validation, and which controller owns it, is visible without opening a second file), while ensuring that changing *behavior* never means changing a route file — only a controller or service.

---

## 7. Middleware Architecture

### 7.1 Categories

| Category | Examples | Purpose |
|---|---|---|
| **Security headers** | `helmet` | Sets standard HTTP security headers (content-type sniffing prevention, etc.) on every response |
| **CORS** | `cors` | Governs which origins may call the API |
| **Compression** | `compression` | Compresses response bodies |
| **Body/cookie parsing** | `express.json()`, `cookie-parser` | Makes request bodies and cookies available to downstream handlers |
| **Request logging** | `morgan` | Structured access logging for every request |
| **Authentication** | `authenticate` | Verifies the JWT access token, attaches the resolved user to the request, or short-circuits with 401 |
| **Authorization** | `authorizeProject(role)` | Verifies the authenticated user is a member (optionally: a specific role) of the project a route operates on, or short-circuits with 403 |
| **Validation** | per-domain `express-validator` rule sets + a shared `validate` check | Rejects malformed request bodies with 400 before a controller ever sees them |
| **Async error forwarding** | `asyncHandler` | Wraps async route handlers so a thrown/rejected error is automatically forwarded to Express's error pipeline instead of needing a try/catch in every handler |
| **Rate limiting** | `express-rate-limit` (declared dependency) | Intended abuse throttling for public-facing endpoints — present in the stack; not yet applied uniformly across every route (see §17) |
| **Not-found handling** | `notFound` | Converts an unmatched route into a structured error rather than Express's default HTML response |
| **Global error handling** | `errorHandler` | The single place every error response is formatted (see §16) |

### 7.2 Request Processing Order

Global middleware (security/CORS/compression/parsing/logging) applies to every request, in registration order, before any route-specific middleware runs. Per-route middleware then applies in the order each route declares it — and that order is itself meaningful:

```
Incoming request
      │
      ▼
 [global]  helmet → cors → compression → cookie-parser → body parser → morgan
      │
      ▼
 [per-route]  authenticate
      │             (must run first — nothing downstream can check
      │              a role or validate ownership for an unknown user)
      ▼
 [per-route]  authorizeProject(role)
      │             (runs after identity is known, before validation —
      │              there's no reason to validate a body for a request
      │              that's about to be rejected for lacking permission)
      ▼
 [per-route]  validate*(rules)
      │
      ▼
 Controller  →  Service  →  (DB / Docker / AI)
      │
      ▼
 Response, OR an error forwarded to:
      │
      ▼
 [always-last]  notFound (if nothing matched)  →  errorHandler
```

---

## 8. Controller Layer

### 8.1 Responsibilities

A controller's job is narrowly scoped to **HTTP-shape translation**:

- Pull the relevant pieces out of `req` (params, query, body, the authenticated user attached by middleware).
- Call **exactly one** service method with that data.
- Shape whatever the service returns into an HTTP response (status code + a consistent response envelope).
- Forward any thrown error to `next()` (usually via the shared async-handler wrapper) rather than handling it locally.

### 8.2 What Controllers Explicitly Do Not Do

| Not a controller's job | Where it actually lives |
|---|---|
| Deciding *whether* a request is valid input | Validators (middleware layer) |
| Deciding *whether* the user is allowed to do this | Authorization middleware |
| Querying or writing to MongoDB | Services |
| Talking to Docker or the AI provider | Services (specifically the execution and AI subtrees) |
| Deciding what error to raise for an invalid business state (e.g. "project not found", "you don't own this session") | Services — controllers only propagate whatever error a service throws |
| Triggering side effects like a Socket.IO broadcast | Services — e.g. creating a file is one service call that both writes to MongoDB and triggers the corresponding workspace broadcast, so a controller calling it never needs to know a broadcast happened at all |

### 8.3 Why Controllers Avoid Business Logic

If a controller contained business logic, that logic would only be reachable from HTTP — a Socket.IO handler needing the same behavior would have no way to call a controller (controllers depend on `req`/`res`, which sockets don't have), and would either duplicate the logic or reach past the controller into the service anyway, leaving the controller's copy an orphaned, drift-prone duplicate. Keeping controllers logic-free means **there is never a temptation to duplicate**, because the service is always the only place the logic exists.

---

## 9. Service Layer

The service layer is where the backend's actual behavior lives. Every business rule, every database query, every cross-cutting side effect (a broadcast, a metrics record, a cleanup) is owned by exactly one service.

### 9.1 Why Services Exist (Restated Precisely)

A service is the backend's unit of **reusable, framework-agnostic business logic**. It takes plain arguments, returns plain data (or throws a structured error), and knows nothing about HTTP status codes or Socket.IO event names. This is what allows the same capability to be invoked from a REST controller and a Socket.IO handler without duplication, and what allows a service to be tested directly (call the function, assert on what it returns/throws) without needing to simulate an HTTP request.

### 9.2 Core Domain Services

| Service | Responsibility |
|---|---|
| **Auth Service** | Registration, login, password hashing/verification, JWT issuance, refresh-token lifecycle, password reset and email verification flows |
| **Project Service** | Project CRUD, membership/role management, leaving a workspace |
| **File Service** | File CRUD, project tree assembly, content save — including reconciling a save against a file's *live* collaboration state when one is active (see §9.5 and the CRDT discussion in the System Architecture document) |
| **Folder Service** | Folder CRUD and tree placement |
| **Invitation Service** | Resolving an invite by email, validating it (no self-invites, no duplicate invites), granting membership |
| **Chat Service** | Persisting and retrieving a project's team chat history |
| **Workspace Activity Service** | Recording and retrieving a project's activity feed entries |
| **Snapshot Service** | Capturing a project's full folder/file tree (overlaying live CRDT content where applicable) and restoring a project to a captured state |

### 9.3 Execution Services (`services/execution/`)

| Service | Responsibility |
|---|---|
| **Execution Service** | Orchestrates one-shot, buffered (REST) code execution: validate → acquire a queue slot → resolve language config → prepare a workspace → run in Docker → record metrics → clean up |
| **Execution Session Service** | Orchestrates interactive, streaming execution: the same shared building blocks, but a long-lived container with an open TTY/stdin, tied to one Socket.IO connection for its entire lifetime |
| **Language Runner** | The single source of truth mapping each supported language to its Docker image, entry filename, compile/run commands, and resource limits — adding a language is a change here, and only here |
| **Temporary Workspace Service** | Creates, writes to, and destroys an isolated temp directory per execution/session |
| **Execution Queue Service** | The shared in-process concurrency semaphore both execution services acquire a slot from and release it back to |
| **Execution Metrics Service** | Records every completed execution's outcome (language, exit code, duration, timeout flag, owning user/project) into a bounded ring buffer with running aggregates |
| **Docker Health Service** | Checks Docker daemon reachability and required-image presence, consumed both by server startup and by the deep health endpoint |

### 9.4 AI Services (`ai/`)

| Component | Responsibility |
|---|---|
| **Provider Factory** | Resolves a named AI provider (currently only `gemini`) to its implementation — the seam that would let a second provider be added without touching any calling code |
| **Gemini Provider** | The only module in the codebase that calls the `@google/genai` SDK directly |
| **Context Builder** | Assembles what the model should see: file language/content, the user's current selection, recent edit history |
| **Prompt Builder** | Combines a per-capability system instruction with the built context into a final prompt |
| **Per-capability services** (chat/explain/review/refactor/generate) | Each a thin composition of the context builder, the prompt builder, and the provider — the only place each capability's specific system instruction lives |

### 9.5 Collaboration Services (`crdt/`)

| Component | Responsibility |
|---|---|
| **Yjs document manager** | Creates/retrieves/removes the in-memory `Y.Doc` for a given room, and tracks which rooms have completed hydration |
| **Hydration** | The atomic, once-per-room pipeline (load persisted state → recover from snapshot → seed from last save) that must succeed before a room is trusted |
| **Persistence manager** | Loads/saves a room's CRDT state to its durable Mongo representation |
| **Debounce manager** | Coalesces rapid edits into an infrequent persisted save rather than writing on every keystroke |
| **Snapshot scheduler / snapshot manager** | Periodic full-document CRDT checkpoints, independent of the debounced incremental save |
| **Awareness manager** | Ephemeral per-room state — live cursors, selections, typing indicators — that is never persisted |

### 9.6 How Services Communicate

Services call other services directly (as plain function/module calls) when one capability genuinely depends on another — for example, the Snapshot Service calls the File Service's project-tree assembly rather than re-implementing that query, and the File Service reaches into the CRDT layer's `hasDocument`/`getDocument` accessors when saving, specifically to reconcile a save against any currently-live collaboration state. There is no message bus or event emitter between services in-process — a service that needs another service's capability simply calls it, because both live in the same process and the same call stack.

### 9.7 Service Interaction Diagram (Representative Cross-Service Flow)

```
  FileController.updateContent()
          │
          ▼
  FileService.updateFileContent()
          │
          ├──▶ MongoDB: persist File.content (the durable write)
          │
          └──▶ crdt/yjsManager.hasDocument(fileId)?
                       │
                yes ───┤─── no  (nothing further to reconcile)
                       ▼
               crdt/persistenceManager:
               replace the live Y.Doc's text to match what was
               just saved, then persist THAT — closing a narrow
               timing gap where a stale live document could
               otherwise silently overwrite a fresh save
```

This single flow is a concrete illustration of §9.1's point: the File Service does not know or care whether a REST call or a Socket.IO event is what eventually causes a collaborator to see this reconciled state — it only owns the correctness of the write itself.

---

## 10. Socket Architecture

### 10.1 Socket Server

A single Socket.IO server instance is attached to the same HTTP server the REST API runs on. It exposes three **namespaces** — independent logical connections multiplexed (where the transport allows) over the same underlying socket infrastructure, each with its own authentication middleware and its own set of event handlers.

### 10.2 Namespaces

| Namespace | Purpose | Room model |
|---|---|---|
| **Default (`/`)** | Per-file editor collaboration | One room per open file; a socket joins it by emitting a join event for that file's ID |
| **`/workspace`** | Project-wide concerns: file tree events, presence, team chat, activity feed, snapshots | One room per project |
| **`/terminal`** | Interactive execution sessions | Session state is tracked per socket connection directly (a session belongs to exactly one connection) rather than via a joined room |

### 10.3 Authentication

Each namespace registers its own `io.use(...)` authentication middleware, independently verifying the same JWT the REST API uses, from the connection handshake's auth payload — a connection to any namespace that does not present a valid token never completes its handshake. There is no cross-namespace trust: a socket authenticated on the default namespace is a *different connection* than one on `/workspace`, independently authenticated.

### 10.4 Events and Routing

Each namespace's connection handler registers listeners for exactly the events relevant to its domain (e.g. the default namespace listens for room join/leave, cursor/selection/typing updates, file-change CRDT updates, file lock/unlock; `/terminal` listens for session start/input/resize/stop). An incoming event is routed to its handler, which typically: validates the request (room/session ownership as applicable), calls the relevant service, and — for anything that other connected clients need to know about — broadcasts a corresponding event to the room (`io.to(room).emit(...)`) or to everyone in the room except the sender (`socket.to(room).emit(...)`), depending on the event's semantics.

### 10.5 Cleanup

Every namespace registers a "disconnecting" handler (fired before the socket's room memberships are cleared), which is where all connection-scoped state is released: locks held by that socket, presence entries, and — specifically on `/terminal` — any execution session that socket owned is stopped. If a departing socket was the last member of a room, the room's own server-side state is torn down too (a pending debounced CRDT save is flushed, periodic snapshot scheduling for that room stops, and its in-memory Yjs document and hydration state are released).

### 10.6 Event Flow Diagram (Representative)

```
  socket.emit('editor:file-change', { roomId, update })
          │
          ▼
  default namespace handler
          │
          ├──▶ crdt/liveUpdateManager: apply the update to the
          │     room's server-side Y.Doc
          │
          └──▶ socket.to(roomId).emit('editor:file-updated', update)
                       │
                       ▼
               every OTHER socket currently in that room receives it
               and applies it to its own local Yjs replica
```

---

## 11. Docker Subsystem

### 11.1 Why It Is a Subsystem, Not Just "Some Services"

The Docker-related services (§9.3) are grouped under their own directory and treated as a cohesive subsystem because they share concerns no other part of the backend has: a hard external dependency (the Docker daemon) that must be health-checked, a shared finite resource (host capacity for concurrent containers) that must be rationed, and a security-critical cleanup guarantee (no orphaned containers, ever) that must hold under every possible exit path.

### 11.2 How the Pieces Work Together

```
      REST: execution.service.js         Socket: executionSession.service.js
      (one-shot, buffered)                (long-lived, streaming)
                  │                                    │
                  └───────────────┬────────────────────┘
                                   ▼
                     executionQueue.service.js
                     acquire a slot (or wait, FIFO)
                                   │
                                   ▼
                     languageRunner.service.js
                     resolve image + resource limits for the
                     requested language
                                   │
                                   ▼
                     tempWorkspace.service.js
                     create an isolated temp directory,
                     write the submitted code into it
                                   │
                                   ▼
                     Docker Engine (via dockerode)
                     create a throwaway container bound to
                     that workspace directory, with the
                     resolved resource limits applied
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                             ▼
           run to completion,             stream I/O live over
           return final buffered           the /terminal socket
           result (REST response)          for as long as it runs
                                   │
                                   ▼
                     executionMetrics.service.js
                     record the outcome (language, exit code,
                     duration, timeout flag)
                                   │
                                   ▼
                     tempWorkspace.service.js
                     destroy the temp directory
                                   │
                                   ▼
                     executionQueue.service.js
                     release the slot
```

`dockerHealth.service.js` sits outside this per-execution flow — it is consulted at server startup (§4.6) and by the health endpoint (§14 of the System Architecture document), checking the same underlying Docker connection this whole pipeline depends on.

### 11.3 Cross-Cutting Properties

| Property | How it's enforced |
|---|---|
| **Resource limits** | Every container is created with explicit memory, CPU, and process-count caps, resolved per-language by the Language Runner |
| **Isolation** | Every execution/session gets its own temp workspace directory and its own container — nothing is shared between two executions |
| **Queue** | Both execution modes acquire a slot from the same semaphore before a container is created, and release it only once the container's full lifecycle (including cleanup) has completed |
| **Timeouts** | Enforced independently for each mode (a shorter default for one-shot runs, a longer one appropriate to genuine interactivity for sessions) |
| **Cancellation** | A unified underlying action (killing the container) regardless of the trigger — explicit stop, timeout, or a disconnected client |
| **Cleanup** | Containers self-remove on exit by configuration, with an explicit force-removal safety net for the narrow case where a container was created but never successfully started — verified by tests to leave zero orphaned containers under every exit path |
| **Metrics** | Recorded once per execution/session, regardless of which mode produced it, using the same shape |

---

## 12. AI Integration

### 12.1 Backend-Side Flow

```
  Controller (chat / explain / review / refactor / generate)
        │
        ▼
  Capability service
        │
        ├──▶ Context Builder: assemble file language/content/selection
        │                      (and, for chat, prior turns supplied by
        │                      the client itself — see §12.3)
        │
        ▼
  Prompt Builder: combine a per-capability system instruction with
                  the built context into one final prompt
        │
        ▼
  Provider Factory → Gemini Provider: send the prompt to the
                      @google/genai SDK
        │
        ▼
  Response parsing: extract the model's text response
        │
        ▼
  Returned as a single JSON payload in the HTTP response
```

### 12.2 Error Handling

A failure at any step (context assembly, the outbound API call itself, an unexpected response shape) is caught and forwarded through the same centralized error-handling path every other backend error uses (§16) — there is no AI-specific error format leaking to the client.

### 12.3 Why AI Logic Remains Isolated and Stateless

**Isolated:** nothing outside `ai/` imports the Gemini SDK or constructs a prompt directly — every capability is reached only through its own service, which is what makes the provider swappable (a new provider is a new module behind the same factory, not a search-and-replace across the codebase).

**Stateless:** the backend holds no server-side conversation memory between AI requests. Any context a request needs (prior chat turns, the file being discussed) is supplied by the client on each call and rebuilt fresh. This means any backend instance can serve any AI request with no session affinity requirement, and a failed or slow AI call can never corrupt or block a *different* request's context, because there is no shared context to corrupt.

---

## 13. Database Layer

### 13.1 MongoDB and Mongoose

MongoDB is the backend's sole durable datastore, accessed exclusively through Mongoose models — no service issues a raw driver query. Mongoose provides schema-level validation (required fields, enums, references) as the first line of defense for data integrity, ahead of whatever additional business-rule validation a service performs.

### 13.2 Why MongoDB

The domain's core entities (a project's member list, a file's metadata, a chat message, a snapshot's captured tree) are naturally document-shaped and don't require rigid multi-table joins to represent — a good fit for MongoDB's flexible schema model. Using a managed cloud cluster (Atlas) also removes the operational burden of running and backing up a database server by hand, which was not the focus of this project's engineering effort.

### 13.3 Models and Relationships (Summary)

*(Full relationship diagram in the System Architecture document, §12 — summarized here from the backend's perspective.)* A `User` owns or is a role-scoped member of many `Project`s. A `Project` owns a tree of `Folder`/`File` entities, a `ChatMessage` history, `Invitation` records, and `WorkspaceActivity` entries. A `Snapshot` captures a `Project`'s entire tree at a point in time. Each `File`'s live collaborative state is represented separately, in `CRDTDocument`/`CRDTSnapshot` records, kept intentionally distinct from `File.content` (see §9.5).

### 13.4 "Repository" Responsibilities

Code Ground does not use a separate formal repository layer between services and Mongoose models — **the service layer itself plays that role**. Each service is the sole owner of the queries relevant to its domain (the File Service is the only place `File` queries live; the Project Service is the only place `Project` queries live), which achieves the same goal a repository pattern would (one place per entity's persistence logic) without an additional indirection layer, given that no entity in this system currently needs multiple, divergent persistence strategies that would justify separating "repository" from "service."

---

## 14. Request Lifecycle

### 14.1 Sequence Diagram — REST Request, Start to Finish

```
 Browser              Route                Middleware            Controller           Service              MongoDB
    │                    │                       │                     │                    │                    │
    │  HTTP request        │                       │                     │                    │                    │
    │ ─────────────────▶ │                       │                     │                    │                    │
    │                    │  matches path/method     │                     │                    │                    │
    │                    │ ─────────────────────▶ │                     │                    │                    │
    │                    │                       │  authenticate()        │                    │                    │
    │                    │                       │  authorizeProject()     │                    │                    │
    │                    │                       │  validate()               │                    │                    │
    │                    │                       │ ─────────────────────▶ │                    │                    │
    │                    │                       │                     │  calls Service       │                    │
    │                    │                       │                     │ ─────────────────▶ │                    │
    │                    │                       │                     │                    │  query / write       │
    │                    │                       │                     │                    │ ─────────────────▶ │
    │                    │                       │                     │                    │  result               │
    │                    │                       │                     │                    │ ◀───────────────── │
    │                    │                       │                     │  domain result       │                    │
    │                    │                       │                     │ ◀───────────────── │                    │
    │                    │                       │  shaped JSON            │                    │                    │
    │                    │                       │ ◀───────────────────── │                    │                    │
    │  HTTP response        │                       │                     │                    │                    │
    │ ◀───────────────── │                       │                     │                    │                    │
```

### 14.2 Notes Specific to the Backend

- **Every arrow after "matches path/method" is synchronous within one request's lifetime** — there is no queuing or deferred processing for ordinary REST requests (execution requests are the one exception, discussed in §11, where a request may wait at the queue step before a container is even created).
- **A thrown error at any step** (an invalid ID format, a missing project, a Mongoose validation failure) short-circuits this diagram and is forwarded to the global error handler (§16) instead of continuing down the chain.
- **The database step can, for some endpoints, trigger a side effect beyond the response** — a workspace-mutating request also causes a Socket.IO broadcast from within the Service step, which this generic diagram deliberately omits for clarity (see §10.6 for that specific interaction).

---

## 15. Socket Request Lifecycle

### 15.1 Stage-by-Stage (Backend Perspective)

```
 Connection
    handshake arrives at a specific namespace (default / /workspace / /terminal)
        │
        ▼
 Authentication
    that namespace's io.use(...) middleware verifies the JWT from
    the handshake's auth payload; failure rejects the connection
    before any event handler is even registered for it
        │
        ▼
 Room Join  (or, for /terminal, session creation)
    the client emits a join/start event; the handler validates
    membership/ownership as applicable and calls socket.join(roomId)
    — or, for /terminal, registers a new execution session tied to
    this exact socket connection
        │
        ▼
 Broadcast
    subsequent events from this or other room members are relayed
    via io.to(room)/socket.to(room), per the event's semantics
        │
        ▼
 Streaming  (execution-specific)
    for /terminal specifically, output events flow continuously
    from the backend to the client for as long as the session is
    alive — this is the one namespace where the backend is a
    sustained SOURCE of events, not only a relay between clients
        │
        ▼
 Disconnection
    the client closes the tab, loses network, or explicitly leaves
        │
        ▼
 Cleanup
    the "disconnecting" handler releases everything this socket
    held (locks, presence, or — for /terminal — stops its owned
    execution session), notifies remaining room members, and tears
    down room-level state if this was the last member
```

---

## 16. Error Handling Strategy

### 16.1 Categories of Error

| Category | Where it's raised | How it surfaces |
|---|---|---|
| **Validation errors** | `express-validator` rule sets, checked by a shared `validate` middleware | 400, with the specific field-level validation messages |
| **Business errors** | Services, via a structured application error carrying an HTTP status code (e.g. "project not found" → 404, "not a member" → 403) | The status code and message the service specified |
| **Database failures** | Mongoose (a connection failure, a schema validation failure) | Caught and forwarded as a 500 (or, for validation, mapped to 400) through the same global path |
| **Docker failures** | The execution subsystem — daemon unreachable, image pull failure, unexpected container-lifecycle error | Surfaced as an execution-specific error to the requester; recorded in execution metrics as an infrastructure failure regardless |
| **Socket failures** | A rejected handshake (bad/missing token), or an error thrown inside an event handler | A rejected handshake never completes the connection; an in-handler error is caught and logged, without crashing the namespace's other connections |
| **AI failures** | A failed or malformed call to the Gemini API | Caught and forwarded through the same centralized error path as any other backend error |

### 16.2 The Global Error Middleware

Every one of the categories above, regardless of where it originates, is designed to converge on **one Express error-handling middleware**, registered last in the middleware chain. It reads a status code off the error (defaulting to 500 if none is present), logs the failure, and returns one consistent JSON response shape — including a stack trace only when running in development. This is what guarantees that a client never has to handle more than one error response shape, no matter which subsystem actually failed.

### 16.3 How Errors Reach That One Place

Every async route handler is wrapped so a thrown or rejected promise is automatically forwarded to Express's error pipeline (`next(err)`) rather than requiring an explicit try/catch at each call site — this is what makes "every error, from every layer, reaches the same global handler" true in practice rather than only in principle.

---

## 17. Security

| Concern | Backend mechanism |
|---|---|
| **JWT** | Short-lived access tokens + server-tracked refresh tokens; independently verified at every REST route and every Socket.IO namespace's handshake |
| **Authorization** | Project membership and role (owner/editor/viewer) checked before any project-scoped service logic runs; execution-session ownership checked before honoring any input/resize/stop action against a session |
| **Ownership validation** | Specifically for interactive execution sessions — an action against a session ID is only honored if it comes from the exact socket connection that created that session |
| **Input validation** | `express-validator` rule sets ahead of every mutating route; the execution endpoint additionally validates the requested language against an explicit allowlist rather than trusting client input as a Docker image reference |
| **Execution isolation** | User code never executes in the API process — always inside a throwaway, resource-capped Docker container |
| **Rate limiting** | `express-rate-limit` is part of the dependency stack for abuse throttling; consistent application across every public-facing route is tracked as near-term hardening rather than uniformly enforced today (an intentionally honest gap, not an oversight) |
| **Environment variables** | Secrets (JWT signing keys, database URI, email credentials, the Gemini API key) are never hard-coded — they are read once, centrally, from environment configuration (§5) |
| **Docker sandbox** | No network access by default for execution containers (one narrow, deliberate per-language exception); explicit memory/CPU/process-count limits on every container |
| **Timeouts** | Enforced independently of resource limits, for both execution modes, so a process that isn't resource-heavy but simply never terminates still cannot run indefinitely |

---

## 18. Testing Strategy

### 18.1 What Is Tested and How

| Test category | What it exercises |
|---|---|
| **Execution tests** | Every supported language's success, compile-failure, and runtime-failure paths, run against a **real Docker daemon** — deliberately not mocked, because the class of bug that matters here (container-lifecycle races, cleanup guarantees) only exists when a real daemon is involved |
| **Interactive terminal/session tests** | Session creation, incremental output streaming (asserted to arrive before a process finishes, not only after), real stdin round-trips, stop/cancellation (including stopping a session that's still queued, before any container exists), disconnect cleanup, timeout cleanup, and concurrent sessions across multiple simulated users verified not to cross-talk |
| **API (integration) tests** | The REST execution endpoint end-to-end, against a real HTTP server bound to an ephemeral port — validation-error paths and a real successful execution |
| **CRDT tests** | The room hydration pipeline specifically: first-open seeding, idempotent re-hydration, concurrent-open safety, recovery from a snapshot, and the save-path reconciliation that prevents a stale in-memory document from overwriting a fresh save |
| **Unit-style service tests** | Where a service's logic is meaningfully separable from its external dependencies, it is exercised directly as a plain function call rather than through an HTTP layer |

### 18.2 Why Automated Testing at This Depth Matters Here

The subsystems with the most automated coverage — execution and CRDT hydration — are also the subsystems where **the bugs that matter are timing- and concurrency-related**, not simple logic errors a code review would catch by inspection. A container-removal race, or a room-hydration race, only reproduces under real timing conditions; testing against a real Docker daemon (rather than a mock that would define the race away) and writing tests that explicitly assert on *ordering* (output arriving before completion, a room being marked trustworthy only after its pipeline finishes) is what actually catches this class of defect before it reaches production.

---

## 19. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why Express** | A minimal, unopinionated HTTP framework was enough — the project needed control over its own layering (routes/controllers/services), not a framework imposing its own | Full control over middleware ordering and layering; a huge, well-understood ecosystem | Less built-in structure than an opinionated framework — layering discipline has to be maintained by convention, not enforced by the framework itself |
| **Why a Services layer** | Multiple entry points (REST, three socket namespaces) need to invoke the same business logic without duplicating it | One source of truth per capability; testable independent of HTTP/sockets | Requires discipline to keep truly enforcing "no business logic outside services" as the codebase grows |
| **Why thin Controllers** | Controllers are the layer most tempted to accumulate "just this one bit of logic" over time, which would silently defeat the Services layer's purpose | Controllers stay trivially readable and easy to reason about; the Services layer's reuse guarantee actually holds | An extra layer of indirection for very simple endpoints, where a controller and its service are nearly the same length |
| **Why Socket.IO (backend-specific reasoning)** | Three independent real-time domains (editor collaboration, workspace sync, terminal sessions) each need room semantics and reconnection handling, all on the same underlying server process | Namespaces/rooms/reconnection as built-in primitives instead of three hand-rolled connection-management implementations | A layer of abstraction over raw WebSockets, with the small overhead that implies |
| **Why Docker for execution** | Untrusted code needs real OS-level isolation and enforceable resource limits, which nothing short of a container/VM boundary genuinely provides | Strong isolation; direct low-level control via the Docker Engine API (dockerode) rather than a black-box third-party execution API | An external daemon the backend must health-check and can fail independently of the API process itself |
| **Why an Execution Queue** | Unbounded concurrent containers can exhaust host resources under load or abuse | Graceful degradation (a queue wait) instead of host-level failure; one shared cap covers both execution modes | Adds latency under contention — an accepted trade against having no cap |
| **Why session-based (not request/response) interactive execution** | Code that reads from stdin fundamentally cannot be modeled as a single buffered round trip | A real, live terminal experience; correct behavior for `input()`/`Scanner`/`cin`/`fmt.Scan` across all six languages, uniformly | A materially more complex lifecycle to get right (container TTY/stdin setup, ownership validation, streaming) than the batch path — justified by keeping it as a separate implementation rather than complicating the simpler batch path (§11, §19's "session vs batch" entry in the System Architecture document) |
| **Why Execution Metrics** | An execution engine that can degrade silently is worse than one that cannot execute at all, because failures would only surface as user complaints | Failures and degradation become visible and diagnosable | In-memory only today — not yet exported to durable, long-term storage (§20) |
| **Why Health Checks (including fail-fast startup)** | "The API process answers HTTP" and "code execution actually works" are different facts a shallow uptime check would conflate | Immediate, clear failure at boot if Docker is unreachable; on-demand deep status at any later point | A small amount of added startup latency for the Docker reachability/image check |

---

## 20. Future Backend Improvements

| Improvement | Addresses |
|---|---|
| **Redis-backed shared state** | The execution queue, active session registry, and Socket.IO room adapter currently live in one process's memory — moving them to Redis is the prerequisite for running more than one backend instance at once |
| **Message queues for execution requests** | Would let execution requests survive an API process restart and allow execution "workers" to scale independently of the API layer, rather than the API process directly holding the queue and talking to Docker itself |
| **Microservices decomposition** | The execution engine and the AI subsystem already have almost no coupling to the core project/collaboration code — a plausible seam to split into independently deployable/scalable services |
| **Distributed execution / Kubernetes** | Running containers directly against a local Docker daemon ties execution capacity to one host; delegating to Kubernetes (or a managed execution cluster) would remove that ceiling |
| **Horizontal scaling of the API/socket layer** | Depends on the Redis step above (Socket.IO's multi-instance support requires a shared adapter) plus a load balancer with WebSocket-aware/sticky routing |
| **Caching** | Read-heavy, rarely-changing data (e.g. project membership checks performed on nearly every project-scoped request) is a candidate for a short-lived cache layer, currently unimplemented |
| **Persistent execution sessions across reconnects** | Decoupling "the container is alive" from "a specific socket is currently attached to it" would let a client that briefly disconnects re-attach to a still-running session instead of losing it |
| **Observability / metrics export** | Exporting the existing in-memory execution metrics to a real time-series backend (e.g. Prometheus) for historical trend analysis, rather than only recent in-memory visibility |
| **Graceful shutdown** | Registering explicit shutdown handlers to drain in-flight requests/sessions and stop accepting new connections before exiting, closing the gap noted in §4.7 |
| **Uniform rate limiting** | Applying `express-rate-limit` consistently across every public-facing route, closing the gap noted in §17 |

---

## 21. Conclusion

The Code Ground backend is built around a small number of consistently enforced rules rather than a large number of special cases: **routes stay thin, controllers stay thin, all business logic lives in services, and only services are allowed to reach an external dependency (MongoDB, Docker, the AI provider).** That single discipline is what makes it possible for the same capability to be safely reachable from both a REST endpoint and a Socket.IO event without the two ever drifting apart, and what makes the two privileged subsystems — Docker-based execution and AI integration — cleanly isolable, independently testable, and swappable at their one seam (the language configuration map; the provider factory) without disturbing anything else.

On top of that discipline, the backend adds the specific engineering maturity a real execution platform requires: a shared concurrency queue, execution outcome metrics, fail-fast health checks, and a rigorously verified container-cleanup guarantee — turning what could have been a fragile "run some code" demo into infrastructure that fails predictably, recovers correctly, and reports honestly on its own health. Together, this is a backend built to be extended (a new language, a new AI capability, a new real-time namespace) without needing to be re-architected first.

---

*This document should be revisited if the Future Backend Improvements in §20 are implemented — in particular, any move of the execution queue or session registry out of process memory changes the fail-tolerance and scaling story described throughout this document.*
