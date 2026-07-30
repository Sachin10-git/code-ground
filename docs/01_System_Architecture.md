# Code Ground — System Architecture

> **Scope of this document:** This is the architectural reference for Code Ground — how the system is structured, how its subsystems communicate, and the reasoning behind its major design decisions. It is written for engineers, technical interviewers, open-source contributors, and future maintainers who need to understand *how the system is built and why*, not a feature tour and not a source-file walkthrough. No code is included; every diagram is a structural or sequence diagram of real, implemented behavior.
>
> Companion document: [`00_Project_Overview.md`](./00_Project_Overview.md) covers the product/feature view. This document covers the engineering view.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Overall Component Diagram](#3-overall-component-diagram)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Architecture](#5-backend-architecture)
6. [Authentication Flow](#6-authentication-flow)
7. [Project & Workspace Flow](#7-project--workspace-flow)
8. [Real-Time Collaboration Architecture](#8-real-time-collaboration-architecture)
9. [AI Architecture](#9-ai-architecture)
10. [Docker Execution Architecture](#10-docker-execution-architecture)
11. [Interactive Terminal Architecture](#11-interactive-terminal-architecture)
12. [Database Architecture](#12-database-architecture)
13. [Request Lifecycle](#13-request-lifecycle)
14. [Socket Event Lifecycle](#14-socket-event-lifecycle)
15. [Security Architecture](#15-security-architecture)
16. [Performance Architecture](#16-performance-architecture)
17. [Fault Tolerance](#17-fault-tolerance)
18. [Architectural Design Decisions](#18-architectural-design-decisions)
19. [Scalability Considerations](#19-scalability-considerations)
20. [Conclusion](#20-conclusion)

---

## 1. Introduction

### 1.1 What "System Architecture" Means Here

For Code Ground, architecture is the answer to four questions, applied consistently across every subsystem:

1. **Where does this piece of logic live**, and why there and not somewhere else?
2. **How do two subsystems that need to cooperate actually talk to each other** — a REST call, a socket event, a shared in-process module?
3. **What is the blast radius of a failure** in this subsystem, and is that radius acceptable?
4. **What would have to change for this to scale beyond its current, single-process shape?**

This document answers those questions for every major subsystem: the frontend, the backend's layered structure, the real-time collaboration engine, the AI integration, and the Docker-based execution engine (both its batch and interactive modes).

### 1.2 High-Level Overview

Code Ground is a three-tier web application with two additional infrastructure dependencies bolted on at the service layer, not the presentation layer:

- A **React SPA** frontend.
- A **layered Node.js/Express** backend exposing both a REST API and three Socket.IO namespaces.
- A **MongoDB** persistence layer.
- A **Docker Engine** dependency, used exclusively by the execution subsystem to sandbox user code.
- A **Gemini AI** dependency, used exclusively by the AI subsystem, reached through an internal provider abstraction.

Nothing outside the execution and AI subsystems is aware that Docker or Gemini exist — that isolation is itself a deliberate architectural property, discussed throughout this document.

### 1.3 Architectural Goals

| Goal | What it means in this system |
|---|---|
| **Modularity** | Each subsystem (auth, projects, files, collaboration, AI, execution) is a self-contained service with a narrow, explicit interface to the rest of the system. |
| **Separation of Concerns** | Routes never contain business logic; controllers never talk to the database directly; services never know about HTTP or sockets. |
| **Extensibility** | Adding a language to the execution engine, or a new AI capability, or a new Socket.IO event, should be additive — a new file/config entry — not a change scattered across the codebase. |
| **Maintainability** | A phase-based build history and consistent layering mean a new contributor can predict where a given piece of logic lives without having read the whole codebase first. |
| **Security** | Every trust boundary (HTTP request, socket connection, Docker container) is treated as such: authenticated, authorized, and resource-bounded at that boundary, not several layers downstream. |
| **Performance** | The system favors streaming over buffering, incremental CRDT updates over full-document broadcasts, and bounded resource usage (execution concurrency, output size) over unbounded "best effort." |

### 1.4 Principles Followed

- **Two things that look similar but behave differently get two implementations, not one over-generalized one.** (See §10 and §18 for why REST execution and interactive execution are deliberately separate code paths.)
- **A subsystem's internal failure must be visible, not silent.** (See §10's execution metrics and health checks.)
- **Real-time domains that don't need to share state, don't share a connection.** (See §8 and §14 — three independent Socket.IO namespaces.)
- **Correctness under concurrency is proven, not assumed.** (See §8's CRDT discussion and §17's fault-tolerance discussion of race conditions found and fixed.)

---

## 2. High-Level Architecture

Code Ground is organized as a strict layered pipeline for synchronous work, with a parallel real-time layer for anything that must be live:

```
┌─────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                │
│   React SPA — pages, components, hooks, services (Vite-built)        │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  HTTPS (REST)         WebSocket (Socket.IO)
                                 ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                               BACKEND                                 │
│   Express REST API            │        Socket.IO real-time layer     │
│   routes → controllers →      │        3 namespaces, each with its   │
│   services                    │        own room/broadcast logic      │
└───────────────┬───────────────┴───────────────┬─────────────────────┘
                 │                               │
                 ▼                               ▼
      ┌─────────────────┐            ┌─────────────────────────┐
      │    DATABASE       │            │   IN-PROCESS RUNTIME     │
      │    MongoDB        │            │   STATE                  │
      │  (Atlas, via      │            │   Live Yjs documents,     │
      │   Mongoose)        │            │   execution queue,        │
      │                    │            │   active sessions,         │
      │                    │            │   metrics ring buffer      │
      └─────────────────┘            └───────────┬─────────────┘
                                                     │
                        ┌────────────────────────────┼─────────────────────┐
                        ▼                            ▼                     ▼
              ┌───────────────────┐        ┌───────────────────┐  ┌───────────────┐
              │   DOCKER ENGINE     │        │   GEMINI AI API     │  │  (future:       │
              │  (via dockerode)    │        │  (@google/genai)     │  │  external cache/│
              │  one container per  │        │  reached through an  │  │  queue/etc.)    │
              │  execution or       │        │  internal provider    │  └───────────────┘
              │  session            │        │  abstraction           │
              └───────────────────┘        └───────────────────┘
```

Two things to note about this diagram that matter architecturally:

1. **The database and the "in-process runtime state" box are architecturally distinct**, even though both live behind the backend. MongoDB is the durable source of truth for everything that must survive a restart (users, projects, files, chat, snapshots). The in-process state box is explicitly *not* durable — it holds live collaboration documents, the execution concurrency queue, currently-running execution sessions, and the metrics ring buffer, all of which are rebuilt or reset on process restart by design. This is a deliberate, documented scaling boundary (see §19).
2. **Docker and Gemini sit at the same architectural depth** — both are external dependencies reached only from the execution and AI subsystems respectively, never from routes/controllers directly, and never from each other.

---

## 3. Overall Component Diagram

```
                                  ┌──────────────┐
                                  │   Browser     │
                                  └───────┬───────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │   React Frontend        │
                              │  (Pages / Components /   │
                              │   Hooks / Services)       │
                              └────┬───────────────┬────┘
                                   │               │
                     REST (Axios)  │               │  WebSocket (socket.io-client)
                                   ▼               ▼
                    ┌───────────────────┐   ┌───────────────────────────┐
                    │     REST API        │   │       Socket.IO Layer       │
                    │  /api/auth           │   │  ┌───────────────────┐   │
                    │  /api/projects       │   │  │ default namespace   │   │
                    │  /api/projects/:id/  │   │  │ (editor collab.)     │   │
                    │      files, folders  │   │  ├───────────────────┤   │
                    │  /api/invitations     │   │  │ /workspace           │   │
                    │  /api/ai              │   │  │ (files, presence,    │   │
                    │  /api/execution       │   │  │  chat, activity,     │   │
                    │  /api/health           │   │  │  snapshots)          │   │
                    └─────────┬─────────┘   │  ├───────────────────┤   │
                              │              │  │ /terminal             │   │
                              │              │  │ (execution sessions)  │   │
                              │              │  └───────────────────┘   │
                              │              └───────────┬───────────────┘
                              ▼                          ▼
                    ┌──────────────────────────────────────────────┐
                    │         Authentication  (shared JWT check)      │
                    │   REST middleware  ⇄  Socket.IO handshake        │
                    │           middleware — same token, same          │
                    │           verification logic                     │
                    └──────────────────────────────────────────────┘
                              │                          │
              ┌───────────────┼──────────────┬───────────┼─────────────────┐
              ▼               ▼              ▼           ▼                 ▼
    ┌─────────────┐ ┌─────────────────┐ ┌────────┐ ┌────────────────┐ ┌───────────┐
    │  Workspace    │ │  Execution Queue   │ │  CRDT   │ │  Execution        │ │  Gemini AI  │
    │  Service       │ │  (concurrency cap)  │ │  Layer  │ │  Sessions          │ │  (provider   │
    │  (projects,    │ └────────┬───────────┘ │ (Yjs)   │ │  (interactive       │ │  abstraction)│
    │  files,        │           │             └────┬────┘ │  terminal)          │ └───────────┘
    │  folders)      │           ▼                    │      └────────┬────────────┘
    └───────┬───────┘   ┌───────────────────┐          │               │
            │           │  Language Runner /  │          │               ▼
            │           │  Temp Workspace /    │          │      ┌───────────────┐
            │           │  Docker Engine        │◄─────────┘      │  File Storage   │
            │           │  (dockerode)           │                 │  (ephemeral,     │
            │           └───────────────────┘                 │  temp workspace   │
            │                                                        │  per execution)  │
            ▼                                                        └───────────────┘
    ┌─────────────────┐
    │     MongoDB        │
    │  (Users, Projects,  │
    │  Files, Folders,     │
    │  Chat, Snapshots,     │
    │  CRDT persistence)     │
    └─────────────────┘
```

**Reading this diagram:** every arrow into "Authentication" represents a real, independent verification — a REST request and a Socket.IO connection do not trust each other's prior verification; each carries and re-validates its own JWT. Execution Queue is the single funnel both REST execution and interactive Execution Sessions pass through, which is why it sits between Authentication and the Docker Engine rather than being owned by either execution path individually.

---

## 4. Frontend Architecture

The frontend is a **React SPA** built with Vite, organized in four layers with a strict dependency direction: **Pages depend on Components and Hooks; Components depend on Hooks; Hooks depend on Services; Services are the only layer that touches `axios` or `socket.io-client` directly.**

```
   Pages  ──uses──▶  Components  ──uses──▶  Hooks  ──uses──▶  Services
     │                                          │
     │                                          ▼
     └──────────────────────────────▶  (also used directly for
                                         page-level concerns, e.g.
                                         routing/auth context)
```

### 4.1 Pages

Top-level, router-mounted views: Landing, Login/Register, Dashboard (project list), the Editor (the primary workspace — the most complex page in the app), Invitations, Pricing. Pages compose components and hooks; they hold page-scoped state (e.g. which file is currently selected) but delegate all actual logic downstream.

### 4.2 Shared Components

Presentation-focused, mostly stateless-or-locally-stateful units: the Navbar (language selector, presence, Run/Stop, Save, Snapshots, Invite), the File Explorer (tree rendering + drag/drop), the interactive Terminal (xterm.js wrapper), the AI Chat panel, the Team Chat panel, the Presence indicator, the Snapshot drawer, the Activity feed. Components receive data and callbacks as props; they do not reach into hooks or services on their own initiative except where a component *is* the natural owner of a specific piece of live infrastructure (the Terminal component owns its own Socket.IO-backed session hook, because a terminal session is conceptually scoped to that one component's lifetime).

### 4.3 Hooks (Cross-Cutting Client Logic)

Each cross-cutting concern is encapsulated in exactly one hook, so the Editor page itself reads as a *composition* of concerns rather than a monolith:

| Hook | Owns |
|---|---|
| Yjs collaboration hook | The per-file CRDT document, cursor/typing broadcast, file lock state |
| AI hook | Chat history and the request/response lifecycle for all five AI capabilities |
| Team chat hook | Chat message history and send/receive for the current project |
| Workspace sync hook | File-tree events, presence, activity feed on the `/workspace` namespace |
| File presence hook | Per-file "who's viewing/editing this" state |
| Terminal session hook | The `/terminal` socket connection and the currently running execution session's lifecycle |
| Editor context hook | A single source of truth for "what is the user currently looking at" (file, language, selection) — consumed by both the AI hook and the Run action, so neither re-derives it independently |
| Resizable panel hook | Generic drag-to-resize behavior shared by the sidebar and AI panel |

### 4.4 Services (Transport Layer)

Thin wrappers around exactly two transports:

- **REST transport** — a single configured Axios instance with a request interceptor (attaches the JWT) and a response interceptor (handles global 401 → redirect-to-login).
- **Socket transports** — one connection-management module per Socket.IO namespace (default/editor, `/workspace`, `/terminal`), each responsible only for opening/closing its connection and exposing typed emit/listen helpers. Hooks never call `socket.io-client` or `axios` directly — this is the layer boundary that makes it possible to reason about "everything that can produce network traffic" in one place.

### 4.5 Monaco Integration

Monaco is mounted once per open file as its own **model** (an independent in-memory buffer with its own undo stack). Switching between open files swaps which model is attached to the single visible Monaco instance, rather than mounting/unmounting the editor itself — this is what makes tab-switching instant and preserves per-file scroll/selection/undo state, mirroring how a desktop IDE behaves. The Yjs collaboration hook binds the active model to the shared CRDT document so remote edits are applied directly into the Monaco buffer.

### 4.6 xterm.js Integration

The Terminal component mounts one xterm.js instance for the lifetime of the Editor page (not recreated per Run) and keeps it visually hidden (not unmounted) while the panel is collapsed, so a running session's scrollback and connection persist across the user collapsing/expanding the panel. Keystrokes typed into it are forwarded verbatim to the active execution session's stdin over the `/terminal` socket; output chunks arriving from that socket are written directly into the terminal's buffer as they arrive.

### 4.7 State Flow Summary

```
User action (type, click Run, send chat message)
        │
        ▼
   Hook handles it (updates local/CRDT state, calls a Service)
        │
        ▼
   Service sends REST request or socket event
        │
        ▼
   Backend processes it, and/or broadcasts to other connected clients
        │
        ▼
   Every subscribed hook (this client's and every collaborator's)
   receives the update and the relevant Component re-renders
```

---

## 5. Backend Architecture

The backend follows a strict **layered service architecture**:

```
   Routes  →  Controllers  →  Services  →  (Models / Docker / AI Provider)
     │             │              │
  declare      translate     own ALL
  HTTP        HTTP ⇄ data      business
  surface +    shapes,         logic —
  middleware   nothing else    the only
                               layer that
                               "knows things"
```

| Layer | Responsibility | Explicitly does NOT do |
|---|---|---|
| **Routes** | Declare the URL surface, attach middleware (auth, validation, authorization) in the correct order | Contain any conditional business logic |
| **Controllers** | Pull request data out, call exactly one service method, shape the response | Query the database, talk to Docker, contain validation rules |
| **Services** | Own all business rules, all database queries, all cross-cutting orchestration (e.g. "creating a file also broadcasts a workspace event") | Know anything about `req`/`res`, HTTP status codes, or Socket.IO wire format |
| **Middleware** | Cross-cutting request concerns: JWT verification, project-role authorization, centralized error formatting, async-error forwarding | Contain domain-specific business rules |
| **Models** | Mongoose schema definitions and their built-in validation | Contain query logic beyond what Mongoose provides natively |
| **Socket layer** | Namespace registration, room membership, event routing | Duplicate REST business logic — it calls the same services REST controllers call |
| **Docker subsystem** | Everything execution-related (see §10) | Anything unrelated to running user code |
| **AI subsystem** | Everything AI-related (see §9) | Anything unrelated to generating a model response |

**Why business logic is isolated inside services:** this is what allows the *same* logic to be triggered from two different entry points without duplication. Creating a file, for example, is invoked from a REST controller — but the service call it makes also has to trigger a `/workspace` broadcast so every other connected collaborator's file tree updates. If that logic lived in the controller, the Socket.IO layer would have no way to reuse it; if it lived in the socket handler, the REST path would have no way to reuse it. Putting it in the service makes both entry points call the same one piece of truth.

### 5.1 Middleware Chain (Representative)

```
Incoming request
   │
   ▼
helmet / cors / compression / cookie-parser / express.json()   (global)
   │
   ▼
authenticate            — verifies JWT, attaches req.user, or 401s
   │
   ▼
authorizeProject(role)  — verifies project membership/role, or 403s
   │
   ▼
validate*               — express-validator rule checks, or 400s
   │
   ▼
Controller → Service → (Model / Docker / AI)
   │
   ▼
notFound (only if no route matched)  →  errorHandler (global, catches everything)
```

`asyncHandler` wraps every async route handler so a thrown/rejected error is forwarded to `next()` automatically rather than needing a try/catch in every controller — this is what makes the global `errorHandler` a reliable single place all errors converge, regardless of which layer raised them.

---

## 6. Authentication Flow

### 6.1 Lifecycle

```
User
  │
  ▼
Register / Login  (REST: POST /api/auth/register or /login)
  │
  ▼
Server: verify credentials, hash-compare password
  │
  ▼
JWT Generation:
   • Access Token  (short-lived, returned in the response body)
   • Refresh Token (longer-lived, stored server-side + httpOnly cookie)
  │
  ▼
Client stores the Access Token, attaches it to every subsequent request
  │
  ├──▶ REST: Authorization: Bearer <token>  on every protected route
  │        │
  │        ▼
  │    `authenticate` middleware verifies the token, loads the user,
  │    attaches req.user — every protected controller can trust it
  │
  └──▶ Socket.IO: token sent in the connection handshake (`auth.token`)
           │
           ▼
       A per-namespace auth middleware (`io.use(...)`) verifies the
       *same* token the same way, attaches socket.user — every event
       handler on that connection can trust it for its entire lifetime
```

### 6.2 Sequence Diagram

```
 Client                         REST API                      Socket.IO
   │                               │                               │
   │  POST /api/auth/login          │                               │
   │ ───────────────────────────▶  │                               │
   │                               │  verify password (bcrypt)       │
   │                               │  issue access + refresh JWT     │
   │  200 { accessToken, user }    │                               │
   │ ◀───────────────────────────  │                               │
   │                               │                               │
   │  GET /api/projects                                             │
   │  Authorization: Bearer <token>                                 │
   │ ───────────────────────────▶  │                               │
   │                               │  authenticate() verifies token  │
   │                               │  → req.user set                │
   │  200 [ projects ]              │                               │
   │ ◀───────────────────────────  │                               │
   │                               │                               │
   │  io.connect({ auth: { token } })                                │
   │ ─────────────────────────────────────────────────────────────▶ │
   │                               │        namespace auth middleware │
   │                               │        re-verifies the SAME token │
   │                               │        → socket.user set          │
   │  connection established                                         │
   │ ◀───────────────────────────────────────────────────────────── │
   │                               │                               │
   │  socket.emit('room:join', fileId)                               │
   │ ─────────────────────────────────────────────────────────────▶ │
   │                               │        uses socket.user for any  │
   │                               │        subsequent authorization   │
```

### 6.3 Why Authentication Is Shared but Independently Verified

REST and Socket.IO are architecturally two separate transports with no shared session state between them — there is no server-side "this browser tab is logged in" flag that both consult. Instead, **the same JWT verification logic is applied at both boundaries independently**: a REST request that never presents a valid token never reaches a controller; a socket connection that never presents a valid token never completes its handshake. This means a REST session and a socket connection can be reasoned about entirely separately (one could be revoked, expire, or be attacked without the other being implicitly trusted), while still resting on exactly one source of truth for *what a valid token looks like*.

---

## 7. Project & Workspace Flow

### 7.1 Lifecycle: Opening a Project to Editing a File

```
1. Project creation
     REST: POST /api/projects  →  ProjectService  →  MongoDB (Project doc,
     current user recorded as owner)

2. Workspace loading (Dashboard / Editor mount)
     REST: GET /api/projects/:id/tree
       → FileService.getProjectTree()
       → membership check (is this user a member of this project?)
       → returns the full folder + file tree in one response

3. File retrieval
     Selecting a file: REST GET (file metadata already in the tree
     response) + Socket.IO ROOM_JOIN on the default namespace for that
     file's collaboration room

4. Editing
     Keystrokes flow through the CRDT layer (see §8), NOT through a
     REST call per keystroke — REST is not on the hot path of typing

5. Saving
     Explicit Save (or the debounced auto-save inside the CRDT layer)
     is a REST PATCH to persist File.content as the durable record;
     if a live collaboration room is open, the in-memory CRDT document
     is reconciled against what was just saved (see §8.4)

6. Synchronization
     Every structural change (create/rename/move/delete a file or
     folder) is BOTH a REST write (durable) AND a `/workspace`
     broadcast (live) — every other connected collaborator's tree
     updates without a refresh
```

### 7.2 MongoDB Interaction Pattern

Every project-scoped REST route follows the same shape: **membership/role check → the actual query/mutation → (for workspace-mutating actions) a broadcast**. This consistency is what `authorizeProject` and the workspace broadcast helpers exist to enforce uniformly, rather than each controller reimplementing the check.

---

## 8. Real-Time Collaboration Architecture

### 8.1 Components Involved

| Component | Role |
|---|---|
| **Socket.IO (default namespace)** | Transport for per-file collaboration rooms — one room per open file, joined by every socket currently viewing it |
| **Yjs** | The CRDT engine — each file's live content is a `Y.Doc`; edits are small binary updates, not full-document snapshots |
| **Hydration pipeline** | The atomic "make this room's document trustworthy" step (load persisted state → recover from snapshot → seed from last save) that must complete before any client's edits are treated as authoritative |
| **Awareness** | Yjs's mechanism for ephemeral, non-document state — used for live cursor position, selection, and typing indicators |
| **Presence** | Both project-wide (who's online) and per-file (who has this file open) |
| **File locking** | A soft, advisory lock broadcast when a user starts actively editing a file |
| **Snapshots** | Project-wide checkpoints, reading *live* CRDT content where a room is active rather than only the last saved value |
| **Team chat** | Persisted, broadcast messages scoped to a project room on the `/workspace` namespace |

### 8.2 Conflict Resolution

Code Ground does not implement a custom merge algorithm. Yjs's CRDT guarantees are used directly: every client applies incoming binary updates to its own local replica of the document, and CRDT mathematics guarantee that **all replicas converge to the same final state regardless of the order updates arrive in** — there is no "conflict" state to resolve, because concurrent operations on a CRDT are defined to commute. This is a fundamentally different (and stronger) guarantee than "last write wins" or manual three-way merging.

### 8.3 Sequence Diagram — Two Users Editing the Same File

```
 User A (socket)            Server                    User B (socket)
      │                       │                              │
      │  room:join(fileId)     │                              │
      │ ───────────────────▶  │                              │
      │                       │  hydration pipeline runs        │
      │                       │  (loads persisted CRDT state)   │
      │  editor:document-sync  │                              │
      │ ◀───────────────────  │                              │
      │                       │                              │
      │                       │      room:join(fileId)          │
      │                       │ ◀─────────────────────────── │
      │                       │  hydration already done —       │
      │                       │  reuses the SAME in-memory doc    │
      │                       │      editor:document-sync         │
      │                       │ ───────────────────────────▶ │
      │                       │                              │
      │  types "hello"          │                              │
      │  editor:file-change     │                              │
      │  (binary CRDT update)   │                              │
      │ ───────────────────▶  │                              │
      │                       │  applies update to server-side   │
      │                       │  doc, re-broadcasts to the room   │
      │                       │      editor:file-updated           │
      │                       │ ───────────────────────────▶ │
      │                       │                              │  applies update to
      │                       │                              │  local Yjs doc —
      │                       │                              │  Monaco reflects it
      │                       │                              │  instantly
```

### 8.4 Hydration — Why It's a Distinct Architectural Step

A room's Yjs document cannot simply be "created and immediately trusted," because creating the in-memory object is synchronous but *loading its real content is not* (it may need to load persisted state from MongoDB, or recover from a periodic snapshot, or seed itself from the file's last saved content on a genuinely first-ever open). Hydration is the explicit, atomic pipeline that must complete — successfully, exactly once, with concurrent first-opens sharing one in-flight attempt — before the room is marked trustworthy for either collaborative editing or a REST save to safely reconcile against. See §17 for the failure mode this specifically prevents.

---

## 9. AI Architecture

### 9.1 Structure

```
Controller (per capability: chat / explain / review / refactor / generate)
        │
        ▼
Capability Service  (aiChatService, aiExplainService, aiReviewService, ...)
        │
        ▼
Context Builder            Prompt Builder
(assembles: file language,   (combines a per-capability system
 content, selection, recent   instruction with the built context
 edits)                       into the final model prompt)
        │                          │
        └────────────┬─────────────┘
                      ▼
              AI Executor
                      │
                      ▼
              Provider Factory  →  Gemini Provider (@google/genai)
```

### 9.2 Request Lifecycle

1. The frontend calls one of five REST endpoints (`/api/ai/chat|explain|review|refactor|generate`) with the current file's content/language/selection and the user's message or instruction.
2. The corresponding capability service asks the **context builder** to assemble what the model should see.
3. The **prompt builder** combines that context with a capability-specific system instruction into a final prompt.
4. The **AI executor** resolves a provider (currently always Gemini, via a **provider factory** that could resolve a different provider by name without any caller change) and sends the prompt.
5. The provider's response is returned as a single JSON payload in the HTTP response — there is no token-by-token streaming in the current architecture.

### 9.3 Supported Capabilities

| Capability | Purpose |
|---|---|
| **Chat** | Open-ended Q&A grounded in the current file |
| **Explain** | Explain what selected code (or the whole file) does |
| **Review** | Identify bugs, risks, and style issues |
| **Refactor** | Suggest an improved version of selected code |
| **Generate** | Produce new code from a natural-language description |

### 9.4 Why AI Remains Stateless

Each AI request is a **self-contained round trip**: the backend holds no server-side conversation memory between requests. Whatever conversational context is needed (prior messages, the file's content) is sent by the client with each request, rebuilt from the client's own state. This keeps the AI subsystem horizontally trivial (any backend instance can serve any request, with no session affinity requirement) and keeps its failure mode simple — a failed or slow AI call affects exactly one request, never a shared server-side conversation state that other requests depend on.

---

## 10. Docker Execution Architecture

### 10.1 Subsystem Map

```
                     REST: POST /api/execution/run     Socket: terminal:start
                              │                                  │
                              ▼                                  ▼
                    execution.service.js                executionSession.service.js
                    (one-shot, buffered)                 (long-lived, streaming)
                              │                                  │
                              └────────────────┬─────────────────┘
                                                ▼
                                  executionQueue.service.js
                                  (shared concurrency semaphore —
                                   caps containers alive at once,
                                   across BOTH execution modes)
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        ▼                       ▼                       ▼
              languageRunner.service   tempWorkspace.service    dockerHealth.service
              (image + resource        (isolated temp dir       (daemon reachability +
               limits per language)     per execution)           required-image checks)
                        │                       │
                        └───────────┬───────────┘
                                     ▼
                          Docker Engine API (dockerode)
                          one throwaway container per execution/session
                                     │
                                     ▼
                       executionMetrics.service.js
                       (outcome recorded regardless of which path ran)
```

### 10.2 REST Execution vs. Interactive Execution

| | REST Execution (`execution.service.js`) | Interactive Execution (`executionSession.service.js`) |
|---|---|---|
| **Container shape** | No TTY, no open stdin — runs to completion | Pseudo-TTY allocated, stdin left open |
| **I/O model** | Buffered — full result returned once, on exit | Streamed — every chunk forwarded as produced |
| **Lifetime in the queue** | One queue slot for the duration of one run | One queue slot for the *entire session*, however long it runs |
| **Transport** | HTTP request/response | Socket.IO (`/terminal` namespace), one connection per session |
| **Cancellation** | Client disconnect detected → container killed | Explicit Stop event, or timeout, or disconnect |
| **Shared infrastructure** | Language config, temp workspace, execution queue, metrics — all identical to the interactive path |

**Why two implementations sharing one set of primitives:** these are genuinely different problems (see §18.5) — forcing both into one code path would have made the simpler REST path carry complexity (an open stdin, a live socket) it never needs, and would have made the interactive path fight the REST path's "buffer until done" assumption. Sharing the queue, language configuration, and metrics — rather than duplicating those — is what keeps the two paths from silently drifting apart on the properties (resource limits, observability) that must apply to both identically.

### 10.3 Cross-Cutting Execution Concerns

| Concern | Mechanism |
|---|---|
| **Queue** | A single in-process semaphore, shared by both execution modes, caps simultaneous containers; excess requests wait in FIFO order for a slot |
| **Metrics** | Every completed execution (either mode) is recorded — language, exit code, duration, timeout flag, owning user/project where known — into a bounded ring buffer with running aggregates |
| **Timeouts** | Both modes enforce a maximum execution duration; interactive sessions use a longer default than one-shot runs, appropriate to genuinely interactive use |
| **Cancellation** | Both modes converge on the same underlying action — killing the container — regardless of *why* (explicit stop, timeout, disconnect) |
| **Cleanup** | Every container is created with auto-removal on exit, plus an explicit force-removal safety net for the case where a container was created but never successfully started — verified to leave zero orphaned containers under every exit path |
| **Isolation** | Every execution gets its own freshly created temporary workspace directory and its own container; nothing is shared between two executions, ever |
| **Resource limits** | Every container is created with explicit memory, CPU, and process-count caps, and (except for one narrow, deliberate language-specific exception) no network access |

### 10.4 Docker Health

A dedicated health check verifies Docker daemon reachability and confirms every required language image is actually present, both at server startup (failing the boot fast, with a clear log message, if Docker itself is unreachable) and on demand via a deep health endpoint that also reports current queue depth and the metrics summary above.

---

## 11. Interactive Terminal Architecture

### 11.1 Why a Session-Based Architecture (Not Request/Response)

Code that reads from stdin (`input()`, `Scanner`, `cin`, `fmt.Scan`) cannot be modeled as "submit code, get a final result" — the *program itself* needs to pause mid-execution, receive input the user hasn't typed yet at request time, and continue. That requires a fundamentally different shape: a long-lived container the user can talk to *while it's running*, not a single buffered round trip. A session — one container, one Socket.IO connection, streaming in both directions for as long as it's alive — is the only model that fits.

### 11.2 Components

| Component | Role |
|---|---|
| **xterm.js** | Renders live output (with ANSI color support, scrollback, resizing) and captures every keystroke |
| **`/terminal` Socket.IO namespace** | One connection per browser tab's terminal; carries session start/output/input/resize/stop/exit events |
| **Execution Session** | The server-side unit tying exactly one container to exactly one socket connection |
| **Container (TTY-enabled)** | Allocated with an open pseudo-TTY and open stdin, so the attached stream is genuinely bidirectional |

### 11.3 Session Lifecycle Diagram

```
 Browser (xterm.js)              /terminal socket                Docker
      │                               │                            │
      │  terminal:start                │                            │
      │  { language, code }            │                            │
      │ ───────────────────────────▶  │                            │
      │                               │  acquire queue slot           │
      │                               │  create container (TTY,        │
      │                               │  open stdin)                    │
      │                               │ ─────────────────────────▶ │
      │                               │  register exit-wait BEFORE      │
      │                               │  starting the container          │
      │                               │  (closes an AutoRemove race —   │
      │                               │   see §17)                       │
      │                               │  start container                  │
      │  terminal:ready                │ ◀──────────────────────── │
      │ ◀───────────────────────────  │                            │
      │                               │                            │
      │                               │      stdout/stderr chunk       │
      │  terminal:output (live)        │ ◀──────────────────────── │
      │ ◀───────────────────────────  │                            │
      │  (program is waiting on        │                            │
      │   stdin — user types & Enter)  │                            │
      │  terminal:input                │                            │
      │ ───────────────────────────▶  │      forwarded to stdin        │
      │                               │ ─────────────────────────▶ │
      │                               │      more output                │
      │  terminal:output (live)        │ ◀──────────────────────── │
      │ ◀───────────────────────────  │                            │
      │                               │                            │
      │  (user clicks Stop, OR          │                            │
      │   process exits naturally,       │                            │
      │   OR timeout elapses)            │                            │
      │                               │      container killed/exited    │
      │                               │ ─────────────────────────▶ │
      │  terminal:exit                 │  release queue slot,            │
      │  { exitCode, reason }           │  record metrics, remove          │
      │ ◀───────────────────────────  │  workspace                       │
```

### 11.4 Ownership Validation & Multi-User Isolation

Every session is recorded against the exact socket connection that created it. Every subsequent `terminal:input`, `terminal:resize`, and `terminal:stop` event is checked against that recorded ownership before being honored — a session ID alone is never sufficient to act on a session; it must also match the requesting connection. This is what guarantees that two different users' terminal sessions — even running concurrently, even if a session ID somehow leaked — can never interfere with each other. Each session additionally has its own container and its own temporary workspace, so there is no shared mutable state between sessions at any layer beneath the socket check either.

---

## 12. Database Architecture

### 12.1 Purpose in the Architecture

MongoDB is the **durable system of record** for everything that must survive a process restart. It is deliberately *not* used to hold anything that is inherently transient (live collaboration documents in memory, the current execution queue depth, currently-running sessions) — those live in the in-process runtime state described in §2, and are reconstructed or reset on restart rather than persisted.

### 12.2 Major Collections & Relationships

```
        User
          │  owns / is a member of (with a role)
          ▼
       Project ──────────────┐
          │                    │
          │ contains            │ has
          ▼                    ▼
       Folder ◀── parent of ── File            Snapshot
          │                    │            (captures the FULL
          │                    │             folder + file tree
          └──── organizes ─────┘              of a Project at a
                                               point in time)

       Project ── has many ──▶ ChatMessage   (team chat history)
       Project ── has many ──▶ Invitation    (pending membership invites)
       Project ── has many ──▶ WorkspaceActivity  (activity feed entries)

       File (or its collaboration room) ── backed by ──▶ CRDTDocument
                                        ── periodically checkpointed as ──▶ CRDTSnapshot
```

**Relationships, in plain terms:**

- A **User** can own or be a member (with a role — owner/editor/viewer) of many **Projects**.
- A **Project** contains a tree of **Folders** and **Files**; a File optionally belongs to a Folder (a `null` folder reference means "at the project root").
- A **Project** has many **ChatMessages** (its team chat history), many **Invitations** (pending), and many **WorkspaceActivity** entries (its activity feed).
- A **Snapshot** belongs to a Project and captures its entire folder/file structure and every file's content at the moment it was taken.
- Each **File**'s live collaborative state is represented separately, as a **CRDTDocument** (the durable form of its Yjs document) and periodic **CRDTSnapshots** — deliberately distinct from `File.content`, because a file's "currently being collaboratively edited" state and its "last explicitly saved" state are related but not identical (see §7 and §8.4).

This document intentionally does not enumerate individual schema fields — the architectural point is the *relationships* above, which is what determines how data flows between services.

---

## 13. Request Lifecycle

### 13.1 Sequence Diagram — A Typical REST Request

```
 Browser        React          API Service       Express          Middleware        Controller       Service        MongoDB
   │              │                 │                │                 │                │              │              │
   │  user action   │                 │                │                 │                │              │              │
   │ ───────────▶  │                 │                │                 │                │              │              │
   │              │  axios.patch(...) │                │                 │                │              │              │
   │              │ ─────────────▶  │                │                 │                │              │              │
   │              │                 │  HTTP request    │                 │                │              │              │
   │              │                 │ ─────────────▶  │                 │                │              │              │
   │              │                 │                │  authenticate()   │                │              │              │
   │              │                 │                │  authorizeProject()│                │              │              │
   │              │                 │                │  validate()        │                │              │              │
   │              │                 │                │ ─────────────▶  │                │              │              │
   │              │                 │                │                 │  calls Controller │              │              │
   │              │                 │                │                 │ ─────────────▶  │              │              │
   │              │                 │                │                 │                │  calls Service │              │
   │              │                 │                │                 │                │ ─────────────▶ │              │
   │              │                 │                │                 │                │              │  query/write   │
   │              │                 │                │                 │                │              │ ─────────────▶│
   │              │                 │                │                 │                │              │  result        │
   │              │                 │                │                 │                │              │ ◀───────────── │
   │              │                 │                │                 │                │  shaped result │              │
   │              │                 │                │                 │                │ ◀───────────── │              │
   │              │                 │                │                 │  JSON response   │              │              │
   │              │                 │                │                 │ ◀───────────── │              │              │
   │              │                 │  HTTP response   │                 │                │              │              │
   │              │                 │ ◀─────────────  │                 │                │              │              │
   │              │  resolved promise│                │                 │                │              │              │
   │              │ ◀─────────────  │                │                 │                │              │              │
   │  UI updates    │                 │                │                 │                │              │              │
   │ ◀───────────  │                 │                │                 │                │              │              │
```

### 13.2 Notes on This Flow

- **Middleware order is itself an architectural decision**: authentication must run before authorization (you can't check a role for an unknown user), and both must run before validation of the request body (there's no point validating input for a request that's going to be rejected anyway) — though in practice all three are cheap enough that ordering is about correctness, not performance.
- **Errors short-circuit this diagram at any middleware or service step** and are forwarded to the global error handler (§5.1) rather than propagating back up through each layer manually.
- **The Service step is the only one that can differ in shape** depending on the request — e.g. a workspace-mutating request also triggers a Socket.IO broadcast as a side effect of the same service call, which this generic diagram intentionally omits for clarity (see §7 and §14 for that specific interaction).

---

## 14. Socket Event Lifecycle

### 14.1 Lifecycle Stages

```
 Connection
    │  client calls io.connect() with { auth: { token } }
    ▼
 Authentication
    │  namespace-level `io.use(...)` middleware verifies the JWT,
    │  attaches socket.user, or rejects the handshake entirely
    ▼
 Room Join
    │  client emits a join event (room:join / workspace:join /
    │  terminal:start creating an implicit session "room")
    │  server validates membership/ownership as applicable,
    │  calls socket.join(roomId)
    ▼
 Broadcast
    │  subsequent events from any member of the room are relayed to
    │  `io.to(roomId).emit(...)` (everyone) or `socket.to(roomId)...`
    │  (everyone except the sender), depending on the event's semantics
    ▼
 Disconnection
    │  client closes the tab, loses network, or explicitly leaves
    ▼
 Cleanup
       server's "disconnecting" handler runs BEFORE the socket's rooms
       are cleared — releasing any locks/presence/sessions this socket
       held, notifying remaining room members, and (if the departing
       socket was the last one in a room) tearing down that room's
       server-side state (flushing any pending CRDT save, stopping its
       snapshot scheduler, stopping any execution session it owned)
```

### 14.2 Why Three Separate Namespaces

```
   default namespace  ──▶  per-file Yjs collaboration rooms
   /workspace          ──▶  project-wide: files, presence, chat, activity, snapshots
   /terminal            ──▶  one execution session per connection
```

Each namespace is a **physically separate connection** with its own room membership and its own disconnect handler. This is deliberate: the default namespace's disconnect handler reasons about "which per-file collaboration rooms did this socket belong to," `/workspace`'s reasons about "which project room," and `/terminal`'s reasons about "which execution session did this socket own." Merging these onto one connection would mean every disconnect handler has to correctly distinguish between three unrelated kinds of room membership on every single event — a persistent source of subtle bugs traded for a marginal connection-count saving that Socket.IO's namespace multiplexing (all three still ride over one underlying WebSocket where the transport allows it) already avoids anyway.

### 14.3 Why Socket.IO (Architecturally)

Socket.IO was chosen over raw WebSockets specifically because it provides **rooms**, **namespaces**, and **automatic reconnection/fallback** as first-class primitives — exactly the three things this system's real-time layer needs repeatedly (per-file rooms, per-project rooms, per-session rooms; three logically separate namespaces; resilience to brief network drops) without hand-rolling connection bookkeeping for each of the three real-time domains independently.

---

## 15. Security Architecture

| Layer | Mechanism |
|---|---|
| **Authentication** | JWT access tokens (short-lived) + server-tracked refresh tokens; bcrypt password hashing; independently re-verified at every REST and Socket.IO boundary (§6) |
| **Authorization** | Project membership + role (owner/editor/viewer) checked at the route/middleware level before any project-scoped logic runs; execution-session ownership checked before honoring input/resize/stop |
| **Input validation** | Request bodies validated (via `express-validator`) before reaching business logic; the execution endpoint validates the requested language against an explicit allowlist rather than trusting arbitrary input as a Docker image reference |
| **Execution isolation** | User code never runs on the host process — every execution is a throwaway Docker container with its own filesystem and process namespace |
| **Docker sandbox** | Explicit memory/CPU/process-count limits per container; no network access by default (one narrow, deliberate per-language exception) |
| **Container cleanup** | Auto-removal on exit plus an explicit force-removal safety net for containers that were created but never started — guaranteed under every exit path (success, failure, timeout, cancellation) |
| **Ownership validation** | Execution sessions are bound to the exact socket that created them; every subsequent action against a session ID is checked against that binding |
| **Timeouts** | Both execution modes enforce a maximum duration, independent of container resource limits, so a process that isn't resource-heavy but simply never terminates still cannot run forever |
| **Rate limiting** | `express-rate-limit` is part of the dependency stack for abuse throttling on public-facing endpoints; applying it consistently across every relevant route is tracked as near-term hardening work rather than uniformly enforced today |
| **Centralized error handling** | A single global error handler formats every error response consistently and suppresses stack traces outside development, so no individual controller can accidentally leak internal detail |

---

## 16. Performance Architecture

| Concern | Approach |
|---|---|
| **Execution Queue** | Bounds simultaneous Docker containers so load manifests as a queue wait, not host resource exhaustion |
| **Metrics** | A lightweight in-memory ring buffer, not an external call on every execution — visibility with negligible overhead |
| **Streaming** | Interactive execution output is forwarded the instant it's produced rather than buffered — bounded server memory regardless of a program's total output volume, and immediate user feedback |
| **CRDT synchronization** | Yjs updates are small incremental binary diffs, not full-document broadcasts — collaboration stays responsive as document size and edit history grow |
| **Monaco performance** | Per-file models (not full editor remounts) make switching between open files an O(1) operation from the UI's perspective |
| **Socket efficiency** | Namespace separation avoids one connection's event volume (e.g. a chatty terminal session) creating head-of-line contention with an unrelated domain's events (e.g. cursor broadcasts) |
| **Lazy loading** | Heavy client libraries (Monaco, Yjs, `socket.io-client`, xterm.js) are dynamically imported rather than bundled into the initial page load, keeping first paint fast |
| **Docker reuse strategy** | Currently, containers are single-use and throwaway by design (a correctness and isolation property, discussed in §18) rather than pooled/reused; this is an explicit trade-off, not an oversight — see §19 for what reuse/pooling would require |

---

## 17. Fault Tolerance

| Failure | System behavior |
|---|---|
| **Docker daemon unavailable** | Server startup fails fast with a clear log message rather than starting in a silently broken state; the deep health endpoint reports this on demand at any later point too |
| **Container crash / unexpected exit** | The same cleanup path that handles a normal exit runs regardless — the container's exit status is captured, resources are released, and the outcome is recorded in metrics as a non-zero/failed result rather than left in an ambiguous state |
| **Docker's AutoRemove racing a fast-exiting container** | A container configured to self-remove on exit can, for a fast enough script, be reaped by the daemon before the server asks for its exit status — this was diagnosed and fixed by registering the exit-status wait *before* starting the container, using the correct wait condition, and giving trailing output a small bounded grace window (see the companion Project Overview document for the full incident narrative) |
| **Socket disconnect (any namespace)** | The relevant namespace's "disconnecting" handler runs before room membership is cleared: locks are released, presence is cleared, and — specifically for `/terminal` — any execution session that socket owned is stopped, so a dropped connection can never leave an orphaned running container |
| **Execution timeout** | Enforced independently of resource limits; the container is killed, cleanup proceeds identically to any other exit path, and the outcome is recorded as timed-out in metrics |
| **AI provider failure** | Scoped to the single request that triggered it — because the AI subsystem is stateless (§9.4), a failed call never corrupts or blocks any other conversation or request |
| **MongoDB failure** | REST operations that depend on it fail with a clear error surfaced through the centralized error handler; in-memory real-time state (live CRDT documents, active execution sessions) is unaffected by a transient database outage, though durability of any pending writes depends on the database recovering |
| **Backend restart** | All in-process state is intentionally lost (live CRDT documents are already persisted incrementally and re-hydrate from storage on next access; the execution queue and active sessions simply reset to empty) — this is the direct, accepted consequence of the architectural boundary described in §2 and §19, not an unhandled edge case |

---

## 18. Architectural Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why MERN (MongoDB, Express, React, Node)** | A single language (JavaScript/Node) across frontend and backend simplifies context-switching and made it practical to build every layer — including real-time and execution orchestration — without juggling a second runtime | One language end-to-end; huge ecosystem for every layer used (Express, Socket.IO, Mongoose, React) | Node's single-threaded event loop means CPU-bound work must be pushed out of-process (which is exactly what the Docker execution engine already does) |
| **Why MongoDB** | The domain data (projects, files, folders, chat, snapshots) is naturally document-shaped and doesn't need rigid multi-table joins | Flexible schema evolution; natural fit for nested/variable-shape data (e.g. a project's member list); Atlas removes operational database burden | Less enforced relational integrity than a SQL database — relationship correctness (e.g. a file's project actually existing) is enforced in application code, not by foreign-key constraints |
| **Why Docker** | Running untrusted user code requires real process/filesystem isolation and enforceable resource limits | Strong isolation guarantees; industry-standard tooling; direct low-level control via the Docker Engine API | Adds an external infrastructure dependency the backend must actively health-check and gracefully degrade around |
| **Why Socket.IO** | Three independent real-time domains all need rooms, reconnection, and namespace isolation | Batteries-included room/namespace/reconnection support instead of reimplementing it three times | An abstraction layer over raw WebSockets — marginally more overhead than a hand-tuned raw WebSocket implementation would have, in exchange for far less custom connection-management code |
| **Why Yjs / CRDT** | Correct concurrent text editing is a hard, well-studied distributed-systems problem already solved by mature CRDT libraries | Mathematically guaranteed convergence; no custom conflict-resolution logic to get subtly wrong | Some conceptual overhead (understanding CRDT semantics) for contributors unfamiliar with the model |
| **Why Monaco** | It is the actual VS Code editor engine | Professional-grade editing (syntax highlighting, per-language modes) with zero need to build an editor from scratch | A heavier client dependency, mitigated by lazy-loading it rather than bundling it eagerly |
| **Why xterm.js** | The de facto standard terminal emulator for the web, also used by VS Code itself | ANSI/color, scrollback, resize, and keyboard/paste handling all come built-in | Requires care to keep its DOM node persistently mounted so it initializes correctly regardless of panel visibility (a real issue encountered and fixed during development) |
| **Why separate `execution.service.js` and `executionSession.service.js`** | One-shot buffered execution and long-lived interactive execution are different problems wearing the same "run code" label | Neither implementation is burdened with the other's complexity; the well-tested batch path was never put at risk while building the interactive path | Some shared concepts (language config, resource limits) must be deliberately kept in sync across two call sites rather than one — mitigated by both pulling from the same shared configuration/queue/metrics modules |
| **Why an execution queue** | Unbounded concurrent Docker containers can exhaust host resources | Graceful degradation (queueing) instead of host-level failure under load; one shared cap covers both execution modes | Adds a small amount of latency under contention (a request may wait for a slot) — an intentional trade against the alternative of no cap at all |
| **Why execution metrics** | A subsystem that can fail silently is worse than one that can't fail at all | Failures/degradation become visible and diagnosable instead of only surfacing as user complaints | In-memory only (not yet exported to long-term storage) — a known, documented limitation, not an oversight |
| **Why health monitoring (including startup checks)** | "The API process is up" and "code execution actually works" are different facts that a shallow uptime check conflates | Fast, clear failure at boot if the execution engine's hard dependency (Docker) isn't available; on-demand deep status at any later point | Adds a small amount of startup latency for the Docker reachability/image check |
| **Why temporary, per-execution workspaces** | Every execution or session needs its own isolated filesystem, created fresh and destroyed afterward | Guarantees zero state leakage between unrelated executions/users | No persistence of installed packages/build artifacts between runs — a deliberate simplicity trade-off (see §19's future direction) |
| **Why a service-oriented backend layering** | Business logic needs to be callable from more than one entry point (REST controllers and Socket.IO handlers) without duplication | One source of truth per capability; controllers and socket handlers both stay thin | Requires discipline to keep genuinely enforcing the boundary as the codebase grows |

---

## 19. Scalability Considerations

The current architecture makes a deliberate, documented trade-off: **the execution queue, active execution sessions, live CRDT documents, and the metrics ring buffer all live in a single Node process's memory.** This is the correct starting shape for a single-instance deployment, and it is also the system's most explicit scaling boundary. What would change, and why, to scale beyond it:

| Direction | What it addresses | What it requires |
|---|---|---|
| **Redis (or similar shared store)** | Multiple backend instances currently can't share one execution queue's state, one set of active sessions, or Socket.IO room membership | Moving the execution queue's counters, the active-session registry, and Socket.IO's adapter to a shared, external store so any instance can see the true global state |
| **Horizontal scaling of the API/socket layer** | A single Node process is a single point of both compute and connection-count limits | Requires the Redis step above first (Socket.IO's own multi-instance support depends on a shared adapter), plus a load balancer capable of sticky sessions or transport-aware routing for WebSocket connections |
| **Load balancer** | Distributing REST and socket connections across multiple backend instances | Standard L7 load balancing, with WebSocket upgrade support and (if not using the Redis adapter's cross-instance broadcast) session affinity |
| **Persistent execution sessions across reconnects** | Currently, a dropped client connection ends its execution session server-side | Would require decoupling "the container is alive" from "a specific socket is currently attached to it," allowing a reconnecting client to re-attach to a still-running session rather than losing it |
| **Kubernetes-orchestrated execution** | Running Docker containers directly on the API host ties execution capacity to that host's own resources | Moving container orchestration to a dedicated execution cluster (Kubernetes, or a managed container-execution service), with the API server submitting execution requests to it rather than talking to a local Docker daemon directly |
| **Microservices decomposition** | The execution engine, the AI subsystem, and the core API currently share one deployable process | Each has a plausible seam to split along (execution already has almost no dependency on the collaboration/chat code paths, and vice versa) — splitting would trade deployment simplicity for independent scaling and failure isolation |
| **Distributed execution across multiple hosts** | A single host's Docker daemon caps total execution throughput | Requires the queue/scheduling logic to become host-aware (or delegate entirely to Kubernetes/an execution cluster) rather than assuming one local daemon |
| **Message queues for execution requests** | Currently, an execution request is handled synchronously (queued in-process, then run) | A durable external queue (e.g. RabbitMQ/SQS) would let execution requests survive an API process restart and allow execution workers to scale independently of the API layer itself |

None of these changes are required for the system as it exists today to function correctly for its current scale — they are the concrete, honest answer to "what would have to change to go further," which is itself a property of good architecture: the boundary is explicit and the path past it is known, rather than the system having an accidental scaling ceiling nobody can name.

---

## 20. Conclusion

Code Ground's architecture is built around one recurring idea, applied consistently at every layer: **isolate what genuinely differs, share what genuinely doesn't, and make every trust and resource boundary explicit rather than implied.**

- The **frontend** is a clean, layered composition of pages, components, hooks, and a thin transport layer — never reaching past its own boundaries to talk to a transport directly except in the one place (services) designed for it.
- The **backend** enforces a strict routes → controllers → services layering specifically so the same business logic can be triggered from both REST and real-time entry points without duplication.
- **Authentication** is verified independently at every trust boundary — REST and Socket.IO never implicitly trust each other's prior checks.
- **Real-time collaboration** rests on a mathematically sound CRDT foundation rather than a custom, likely-fragile merge strategy, and is kept in three cleanly separated namespaces so unrelated real-time domains can never interfere with each other's state.
- The **AI subsystem** is stateless and provider-abstracted, so a request's failure is contained and a future provider swap is additive.
- The **execution engine** is the most operationally mature subsystem in the project: a shared concurrency queue, shared metrics, and shared health checks span two deliberately distinct execution models (batch and interactive), each isolated in its own throwaway container with real resource limits and verified, exception-safe cleanup.
- Every major failure mode this document discusses — a Docker daemon outage, a socket disconnect mid-execution, a race condition in container lifecycle timing — has a specific, designed-for recovery path, not an assumed absence of failure.

Together, this is an architecture that demonstrates the specific, hard combination a real cloud IDE product has to solve — secure sandboxed execution, correct real-time collaboration, and integrated AI assistance — built from first principles, with its scaling boundaries known and documented rather than discovered under load.

---

*This document should be revisited as the system evolves — in particular, if any of the Scalability Considerations in §19 are implemented, the in-process state boundary described in §2 and §17 will need to be updated accordingly.*
