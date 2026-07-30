# Code Ground — Project Overview

**A cloud-native, real-time collaborative IDE with AI assistance and sandboxed multi-language code execution.**

> **Document purpose:** This is the canonical, high-level reference for the Code Ground system. It is written for recruiters and evaluators who need to understand the scope and depth of the engineering work, for engineers who need a mental model before touching the codebase, and for the author's own future self returning to the project after time away. It intentionally does not walk through source files line-by-line — it explains the system as a whole: what it does, why it exists, how its pieces fit together, and the engineering judgment behind its harder decisions.

---

## Table of Contents

1. [Project Introduction](#1-project-introduction)
2. [Objectives](#2-objectives)
3. [Major Features](#3-major-features)
4. [High-Level Architecture](#4-high-level-architecture)
5. [User Workflow](#5-user-workflow)
6. [Technology Stack](#6-technology-stack)
7. [Project Structure](#7-project-structure)
8. [Key Design Decisions](#8-key-design-decisions)
9. [Security](#9-security)
10. [Performance](#10-performance)
11. [Testing](#11-testing)
12. [Challenges Faced](#12-challenges-faced)
13. [Final Outcome](#13-final-outcome)
14. [Future Scope](#14-future-scope)

---

## 1. Project Introduction

### 1.1 What Code Ground Is

Code Ground is a **browser-based, multi-user, AI-assisted Integrated Development Environment**. A user opens a tab, logs in, and gets a full coding workspace — a file explorer, a Monaco-powered editor (the same editor engine behind VS Code), a live collaborative session other teammates can join instantly, an AI pair-programmer, and a real, isolated Linux container in which their code actually compiles and runs, with a live terminal they can type into.

Nothing is installed locally. There is no compiler on the user's machine, no language runtime, no local Docker daemon the user has to manage themselves. All of that lives on the server side, behind a REST API and a set of real-time Socket.IO channels, and is provisioned per-execution, on demand, then torn down again.

### 1.2 Why It Was Built

Code Ground was built as a **deep, end-to-end systems engineering exercise** — not a wrapper around an existing product, but an original implementation of every layer a real cloud IDE needs:

- A **conflict-free real-time collaboration layer** built on CRDTs (Conflict-free Replicated Data Types), not a naive "last write wins" broadcast.
- A **sandboxed, resource-limited execution engine** built directly on the Docker Engine API, not a third-party "code execution as a service" API.
- An **AI assistance layer** integrated as a first-class part of the editor rather than a bolted-on chat widget.
- A **production-hardening discipline** (concurrency queues, execution metrics, deep health checks, container-cleanup guarantees) applied to what could otherwise have been a toy execution demo.

The project deliberately chose the hard version of each of these problems, because the value of the project — as a portfolio piece and as a learning exercise — is in having actually solved them, not in having glued together existing SaaS APIs.

### 1.3 The Problem It Solves

Traditional collaborative coding today is fragmented across tools that don't talk to each other:

- Screen-sharing to pair-program, with only one person actually able to type.
- A separate chat app for discussion.
- A separate terminal or local machine to actually run the code.
- A separate AI assistant (a browser tab, a different app) that has no real context on the file actually open.
- Environment setup ("works on my machine") friction before anyone can even start.

Code Ground collapses all of that into one browser tab: the editor, the collaborators' live cursors, the team chat, the AI assistant, and a real running terminal are all part of the same page, backed by the same project, in real time.

### 1.4 Target Users

| Audience | What they get |
|---|---|
| **Students & educators** | A zero-setup coding environment for teaching multiple languages, with instructors able to watch/collaborate live. |
| **Small engineering teams** | A pair-programming and interview environment — shared file tree, shared cursors, shared terminal output, no screen-share needed. |
| **Hobbyist / prototyping developers** | Quick, disposable, multi-language sandboxes without installing six different toolchains locally. |
| **Recruiters & technical evaluators** | A single, coherent artifact demonstrating full-stack, distributed-systems, and infrastructure engineering ability. |
| **Future contributors** | A codebase with a documented phase history, test coverage, and explicit design rationale to build on top of. |

---

## 2. Objectives

The project was scoped around a set of concrete engineering objectives, each corresponding to a real subsystem rather than a vague feature wish-list:

1. **Cloud IDE** — a full editing experience (multi-file, multi-language, persistent) reachable from nothing but a browser.
2. **Real-time collaboration** — multiple users editing the same file simultaneously with correct, conflict-free merging, live cursors, typing indicators, and presence.
3. **AI-assisted development** — an assistant that can chat about, explain, review, refactor, and generate code with real knowledge of the file/selection the user is looking at.
4. **Secure, sandboxed execution** — user-submitted code must never be able to affect the host machine, other users' executions, or run unbounded in time/memory/CPU.
5. **Multi-language support** — a single, uniform execution pipeline that supports compiled and interpreted languages alike (JavaScript, Python, Java, TypeScript, C++, Go) without language-specific execution code sprawling through the codebase.
6. **Interactive execution, not just batch execution** — code that reads from stdin (`input()`, `Scanner`, `cin`, `fmt.Scan`) must work exactly as it would in a real terminal, not just fire-and-forget with no feedback loop.
7. **Operational maturity** — the execution engine should behave like production infrastructure: bounded concurrency, cleanup guarantees, observability, and health checks — not just a single happy-path demo.
8. **Team collaboration features** — projects with membership/roles, invitations, team chat, and point-in-time project snapshots.

---

## 3. Major Features

Each feature below is described by its **purpose**, **how it works**, and the **benefit** it delivers.

### 3.1 Authentication

**Purpose:** Establish a verified user identity so every other feature (projects, collaboration, execution, AI) can be scoped to the right person.

**How it works:** Users register with a username/email/password. Passwords are hashed (bcrypt) before storage — plaintext passwords are never persisted. On login, the server issues a short-lived **JWT access token** and a longer-lived **refresh token** (stored server-side and set as an `httpOnly` cookie). Every protected REST route and every Socket.IO connection re-verifies the access token independently — there is no session state trusted purely on the client. The `User` model also carries fields for email verification and password reset, so the account model supports a full production auth lifecycle, not just login/logout.

**Benefit:** A single identity is reused consistently across the REST API, both Socket.IO namespaces, and the execution engine's metrics — so every part of the system can answer "who did this" without re-implementing auth.

### 3.2 Projects (Workspaces)

**Purpose:** The top-level container for a body of work — a codebase, its files, its collaborators, and its history.

**How it works:** A `Project` has an owner, a list of members each with a role (`owner` / `editor` / `viewer`), a default language, and visibility (`private`/`public`). Membership and role are checked on essentially every project-scoped action, both on REST routes (via an `authorizeProject` middleware) and on Socket.IO room joins.

**Benefit:** Everything else in the system — files, collaboration rooms, chat, snapshots, execution — is scoped to a Project, giving the whole system one consistent unit of ownership and access control.

### 3.3 Invitations & Roles

**Purpose:** Let a project owner bring specific people into a project without exposing it publicly.

**How it works:** An owner invites a collaborator by email; the system resolves that email to an existing user, validates it isn't a self-invite or a duplicate, and grants membership at a specified role. Roles are enforced downstream — for example, only an owner can rename or delete a project.

**Benefit:** Projects can be shared precisely and safely, and the role model gives a foundation for future fine-grained permissioning (e.g. read-only reviewers).

### 3.4 Workspace / File Explorer

**Purpose:** Organize a project's code into a familiar folder/file tree, with full CRUD.

**How it works:** Files and folders are independent Mongo collections referencing their parent `Project` (and, for files, an optional parent `Folder`). The frontend's File Explorer renders this as a tree and supports create, rename, move (drag-and-drop), and delete — each of which is both a REST call (the durable write) and a Socket.IO broadcast (`workspace:file-created`, `workspace:file-renamed`, etc., on the dedicated `/workspace` namespace) so every other connected collaborator's tree updates live without a page refresh.

**Benefit:** Multiple people can restructure a codebase together and never see a stale tree.

### 3.5 Monaco Editor Integration

**Purpose:** Provide a real, professional-grade code editing experience — syntax highlighting, per-language intelligence, multi-file editing — inside the browser.

**How it works:** The frontend embeds **Monaco**, the open-source editor that powers VS Code. Each open file gets its own Monaco *model* (an in-memory buffer with its own undo history and language mode), so switching between files is instant and preserves scroll position/selection/undo stack per file, exactly like a desktop IDE's tab strip. Language is auto-resolved from the file extension when a file's stored language is unset. A custom dark theme (`codeground`) is registered for visual consistency with the rest of the UI.

**Benefit:** Users get an editing experience indistinguishable from a local IDE, with zero installation.

### 3.6 Real-Time Collaboration (CRDT-based)

**Purpose:** Let multiple users edit the *same file* at the *same time* with changes merging correctly, regardless of network timing — no "your edit overwrote mine."

**How it works:** Each file's live content is represented as a **Yjs CRDT document** (`Y.Doc`). Every keystroke is encoded as a small binary update and broadcast over a per-file Socket.IO "room" (the default namespace) to every other collaborator with that file open; each client applies the update to its own local Yjs document, which is mathematically guaranteed to converge to the same final state no matter what order updates arrive in. Monaco is bound to the Yjs document (via a Monaco/Yjs binding), so remote edits appear directly in the editor buffer. The Yjs document itself is periodically persisted (debounced saves + periodic full snapshots) so collaboration state survives server restarts.

**Benefit:** True simultaneous multi-cursor editing with no manual merge conflicts — the same class of guarantee tools like Google Docs and VS Code Live Share provide, implemented from first principles.

### 3.7 Presence

**Purpose:** Show who else is around — both "who's in this project" and "who's looking at this exact file."

**How it works:** Two layers: a lightweight **project-wide presence** (who's online in the project at all, shown in the navbar) and a per-file **collaboration room presence** (who's actually got *this* file open, with live cursor positions and selections broadcast via Yjs "awareness" state, plus typing-start/stop indicators).

**Benefit:** Collaborators always know who they're working alongside and where those people's cursors currently are — essential for avoiding "we both just typed in the same spot."

### 3.8 File Locking

**Purpose:** Provide an optional soft-lock signal so two people don't unknowingly fight over the exact same file at the exact same moment.

**How it works:** When a user starts actively editing a file, the server can mark it locked to that user for the room; other collaborators are notified (`editor:file-locked`) and can see the lock in the Explorer too. Locks are released on room leave or on hard disconnect (crash/tab close) so a lock can never outlive its owner's connection.

**Benefit:** A lightweight social signal (not a hard constraint — Yjs would merge concurrent edits correctly anyway) that reduces accidental collisions.

### 3.9 Team Chat

**Purpose:** In-context team discussion without leaving the IDE.

**How it works:** Each project has a chat room on the `/workspace` namespace. Messages are persisted (so history survives reconnects and is replayed to a socket the moment it joins the room) and broadcast live to every connected member.

**Benefit:** Discussion happens right next to the code it's about, instead of in a disconnected Slack thread.

### 3.10 Activity Feed

**Purpose:** A running, human-readable log of what's happening in a project — files created, renamed, moved, deleted; snapshots taken; locks acquired.

**How it works:** Workspace mutations are recorded and broadcast as activity entries, rendered as a live-updating feed in the UI.

**Benefit:** Gives every collaborator situational awareness of a project's recent history without requiring a full audit-log UI.

### 3.11 Snapshots

**Purpose:** A point-in-time checkpoint of an entire project — every folder, every file's content — that can be restored later.

**How it works:** Creating a snapshot walks the full project tree and, for every file, takes the *live* content: if a file currently has an active collaboration session, the snapshot reads straight from the in-memory Yjs document rather than the last explicitly-saved `File.content`, so a snapshot taken mid-edit reflects exactly what's on everyone's screen at that moment. Restoring a snapshot rewrites the project's folders/files back to that captured state and triggers a full tree resync for every connected client.

**Benefit:** A safety net against destructive mistakes, and a way to bookmark meaningful project states (e.g. "before the refactor") without needing a full Git integration.

### 3.12 AI Assistant

**Purpose:** A context-aware coding assistant embedded directly in the editor, not a generic chatbot.

**How it works:** The AI subsystem is built with a clean internal architecture: a **provider abstraction** (currently backed by Google's Gemini via the `@google/genai` SDK, chosen deliberately so a different model provider could be swapped in later without touching the calling code), a **context builder** that assembles what the AI should see (the file's language, its content, the user's current selection, and recent edit history), and a **prompt builder** per capability. Five capabilities are exposed:

| Capability | What it does |
|---|---|
| **Chat** | Free-form Q&A grounded in the currently open file. |
| **Explain** | Explains what the selected code (or whole file) does. |
| **Review** | Flags bugs, risks, and style issues in the code. |
| **Refactor** | Suggests an improved version of the selected code. |
| **Generate** | Writes new code from a natural-language description. |

Responses are returned as a single JSON payload per request (not token-by-token streaming) — the frontend shows a "thinking" placeholder state while the request is in flight, then reveals the full response.

**Benefit:** The assistant always answers about the *real* code the user is looking at — not a paste-in-a-different-tab experience — and the provider/prompt abstraction means new capabilities or model providers are additive, not a rewrite.

### 3.13 Docker Execution Engine (Batch / REST Execution)

**Purpose:** Actually run user-submitted code, safely, for any of six supported languages.

**How it works:** `POST /api/execution/run` takes `{ language, code }`. The backend resolves a per-language configuration (Docker image, entry filename, compile command if any, resource limits), writes the code into a fresh temporary workspace directory, and runs it inside a **single-use, resource-capped Docker container** with no network access by default (with a narrow exception for TypeScript, which needs the network to fetch the compiler package). Compiled languages (Java, C++, Go, TypeScript) run a compile step and a run step chained inside the container; interpreted languages (JavaScript, Python) run directly. The full `{ stdout, stderr, exitCode, timedOut }` result is returned in one response once the container exits, and the container and its temp files are guaranteed to be cleaned up regardless of success, failure, or timeout.

**Benefit:** A uniform execution model across six very different language ecosystems, with the security properties (isolation, resource caps) built in at the lowest level rather than bolted on per language.

### 3.14 Interactive Execution Terminal

**Purpose:** Support code that needs to *talk back and forth* with the user while it runs — `input()`, `Scanner`, `cin`, `readline`, `fmt.Scan` — the way a real terminal does, not just a single request/response.

**How it works:** Clicking Run opens a **persistent execution session**: one real Docker container, allocated a pseudo-TTY with open stdin, tied to one Socket.IO connection on a dedicated `/terminal` namespace. Output streams to the browser as it's produced — not buffered until the process exits — and is rendered live in an **xterm.js** terminal embedded in the editor. Every keystroke the user types into that terminal is forwarded straight into the container's stdin, so an `input()` prompt genuinely pauses execution until the user types an answer and hits Enter, exactly as it would on a local machine. A Stop control lets the user kill a runaway or long-running session at any time.

**Benefit:** Transforms execution from "fire a script and read a static result" into a real, live terminal session — the single biggest gap between "toy code runner" and "actual development environment."

### 3.15 Execution Queue (Concurrency Control)

**Purpose:** Prevent a burst of simultaneous Run clicks (or one abusive client) from spinning up unbounded Docker containers and exhausting the host.

**How it works:** A single in-process semaphore caps the number of executions (both one-shot REST runs and interactive sessions) that may have a container alive at once; anything beyond the cap waits in a FIFO queue for a slot to free up. An interactive session holds its slot for its *entire* lifetime, not just its startup — so a long-running interactive session correctly counts against the same concurrency budget a batch execution would.

**Benefit:** The execution engine degrades gracefully (requests queue) under load instead of catastrophically (host resource exhaustion).

### 3.16 Execution Metrics

**Purpose:** Give the system (and its operators) visibility into how the execution engine is actually being used and how healthy it is.

**How it works:** Every completed execution — success, failure, or timeout, from either the batch or interactive path — is recorded into a bounded in-memory ring buffer with language, exit code, duration, timeout flag, and (where available) the owning user/project. Aggregate counters (total run, succeeded, failed, timed out, broken down by language) are maintained alongside the raw recent history.

**Benefit:** Turns the execution engine from a black box into something observable — the basis for the health endpoint below, and for any future dashboarding.

### 3.17 Health Monitoring

**Purpose:** Let the system (and whoever operates it) know, in one request, whether code execution is actually working — not just whether the API process is alive.

**How it works:** A deep `GET /api/health` endpoint checks Docker daemon reachability, verifies every required language image is actually present locally, and reports current queue depth and the execution metrics summary above, alongside standard process uptime/memory. On server startup, the same Docker reachability check runs and **fails the boot fast** with a clear log message if Docker itself is unreachable — a backend that "starts successfully" but can't run any submitted code is worse than one that refuses to start with an obvious reason.

**Benefit:** The difference between "the server is up" and "the server can actually do its one core job" is made explicit and machine-checkable.

### 3.18 Execution Cancellation

**Purpose:** Let a user stop code that's misbehaving — an infinite loop, a runaway `print`, or code they simply don't want to wait for — without waiting for a fixed timeout.

**How it works:** For interactive sessions, a Stop action kills the underlying container immediately, cleanly, using the exact same cleanup path a natural exit or timeout would use. For the REST batch path, a client disconnecting mid-request (closing the tab, navigating away) is detected server-side and used to cancel the still-running container rather than letting it run to its full timeout with nobody listening for the result.

**Benefit:** No wasted compute for abandoned or unwanted executions, and users get immediate control over runaway code.

---

## 4. High-Level Architecture

### 4.1 System Overview

```
                              ┌────────────────────────────┐
                              │         Browser            │
                              │  React SPA (Vite build)    │
                              │  Monaco Editor · xterm.js   │
                              └─────────────┬──────────────┘
                                            │
                     HTTPS (REST)  │        │  WebSocket (Socket.IO)
                                    ▼        ▼
                       ┌─────────────────────────────────────┐
                       │         Node.js / Express API        │
                       │  ┌───────────────┐ ┌───────────────┐│
                       │  │  REST Routes   │ │ Socket.IO     ││
                       │  │  /api/*        │ │ Namespaces:    ││
                       │  │  (auth, files, │ │  / (editor)    ││
                       │  │  projects, AI, │ │  /workspace    ││
                       │  │  execution,    │ │  /terminal     ││
                       │  │  health)       │ │               ││
                       │  └───────┬────────┘ └───────┬───────┘│
                       └──────────┼──────────────────┼────────┘
                                  │                  │
              ┌───────────────────┼──────────┬───────┴─────────────┐
              ▼                   ▼          ▼                     ▼
      ┌───────────────┐  ┌────────────────┐ ┌────────────────┐ ┌───────────────┐
      │   MongoDB       │  │  Docker Engine │ │  Gemini AI API  │ │ In-process     │
      │  (Atlas cloud)  │  │  (dockerode)   │ │  (@google/genai)│ │ state: CRDT     │
      │  users, projects│  │  one container │ │  chat/explain/  │ │ docs, execution │
      │  files, folders,│  │  per execution │ │  review/refactor│ │ queue, metrics, │
      │  chat, snapshots│  │  or session     │ │  /generate     │ │ live sessions   │
      └───────────────┘  └────────────────┘ └────────────────┘ └───────────────┘
```

### 4.2 Frontend

A **React single-page application**, built and served by **Vite**. Its dev server proxies `/api` and `/socket.io` to the backend, so the frontend never hard-codes a backend host. Major building blocks:

- **Pages** — Landing, Auth (Login/Register), Dashboard (project list), Editor (the main workspace), Invitations, Pricing.
- **Editor page** — the heart of the app: Monaco (the code buffer), the File Explorer sidebar, the AI Chat panel, the Team Chat panel, the interactive Terminal panel, and the Navbar (language selector, presence, Run/Stop, Snapshots, Save, Invite).
- **Hooks layer** — each cross-cutting concern (Yjs collaboration, AI, team chat, workspace sync, file presence, the terminal session, resizable panels) is encapsulated in its own hook, keeping the Editor page itself a composition of hooks rather than a monolith.
- **Services layer** — thin wrappers around Socket.IO connections (one per namespace) and the Axios REST client, so hooks never talk to `socket.io-client` or `axios` directly.

### 4.3 Backend

A **Node.js / Express** application, structured in clear layers:

- **Routes** → thin, declare the HTTP surface and attach middleware (auth, validation).
- **Controllers** → thin, translate HTTP in/out; no business logic lives here.
- **Services** → own all business logic (projects, files, auth, snapshots, AI, execution).
- **Socket layer** — three independent real-time surfaces (see §4.5).
- **CRDT layer** — Yjs document lifecycle: hydration, persistence, snapshotting, awareness.
- **Execution layer** — the Docker orchestration subsystem (see §4.6).
- **AI layer** — provider abstraction, context/prompt builders, per-capability services.

### 4.4 Database

**MongoDB** (hosted on Atlas), accessed via **Mongoose**. Core collections: `User`, `Project`, `Folder`, `File`, `Invitation`, `ChatMessage`, `Snapshot`, `WorkspaceActivity`, plus CRDT-specific collections (`CRDTDocument`, `CRDTSnapshot`) that persist the Yjs collaboration state itself, separately from each file's "last saved" `content` field.

### 4.5 Real-Time Layer (Socket.IO)

Three deliberately **separate namespaces** — separate physical connections, separate room semantics, separate disconnect handling — so one domain's cleanup logic can never misfire against another's state:

```
Default namespace ( / )        →  Per-file Yjs collaboration rooms
                                   (cursors, typing, file locks, CRDT sync)

/workspace namespace           →  Project-wide concerns
                                   (file tree events, presence, team chat,
                                    activity feed, snapshots)

/terminal namespace  (Phase 7) →  One room per interactive execution session
                                   (live stdout/stderr, stdin forwarding,
                                    resize, stop)
```

### 4.6 Execution Subsystem (Docker)

```
        POST /api/execution/run                 socket: terminal:start
                 │                                       │
                 ▼                                       ▼
        execution.service.js                  executionSession.service.js
                 │                                       │
                 └──────────────┬────────────────────────┘
                                 ▼
                    executionQueue.service.js   (shared concurrency cap)
                                 │
                                 ▼
                    languageRunner.service.js   (image + limits per language)
                    tempWorkspace.service.js    (isolated temp dir per run)
                                 │
                                 ▼
                         Docker Engine API (dockerode)
                    one throwaway container, AutoRemove:true,
                    memory/CPU/PID/network limits applied
                                 │
                    ┌────────────┴─────────────┐
                    ▼                          ▼
        buffered result returned      live stdout/stderr + stdin
        (REST response)               streamed over the socket
                                 │
                                 ▼
                    executionMetrics.service.js (outcome recorded)
```

MongoDB, Docker, and the Gemini API are the system's three external dependencies; everything else (the execution queue, live CRDT documents, active terminal sessions) lives in the Node process's own memory, which is an explicit, documented scaling boundary (see §14).

---

## 5. User Workflow

### 5.1 Registration & Login

A new user registers with a username, email, and password. The password is hashed server-side before storage. On successful login, the browser receives a JWT access token (kept in memory/local storage on the client) and a refresh token (`httpOnly` cookie). From this point, every REST request and every Socket.IO connection presents that access token for verification.

### 5.2 Creating a Project

From the Dashboard, the user creates a Project — giving it a name and a default language. The user is automatically its owner. The project immediately appears in their project list and is ready to receive files and collaborators.

### 5.3 Creating Files

Inside the Editor page, the File Explorer lets the user create files and folders. Each creation is a REST call that persists to MongoDB and simultaneously broadcasts a `workspace:file-created` event on the `/workspace` namespace, so any other connected collaborator's Explorer updates instantly.

### 5.4 Opening a File & Collaborating

Clicking a file opens it in Monaco and joins that file's collaboration room (default Socket.IO namespace). The server "hydrates" the room — loading its persisted CRDT state (or seeding it from the file's last saved content on first-ever open) — before the client is allowed to treat the document as trustworthy. Once hydrated, Monaco is bound to the shared Yjs document: every keystroke becomes a CRDT update broadcast to every other collaborator with that file open, and their cursors/selections appear live in the editor. A second user opening the same file sees the exact same live content and can type in it immediately — no merge conflicts, no "someone else is editing this" lockout (a soft lock indicator is shown, but doesn't block editing).

### 5.5 Using the AI Assistant

With a file open, the user can open the AI panel and ask a question, or select code and click Explain / Review / Refactor, or describe something they want generated. The request carries the current file's language, content, and the user's selection (if any) to the backend, which builds a prompt and calls Gemini. The response appears in the chat panel, rendered with Markdown/code formatting.

### 5.6 Running Code

Clicking **Run** starts an interactive execution session: the backend spins up a real, isolated Docker container for the file's language, and the Terminal panel at the bottom of the Editor switches to a live, connected state. Output appears in the terminal as the program produces it — not all at once at the end.

### 5.7 Using the Terminal

If the running program reads from stdin (e.g. Python's `input()`), execution pauses at that point exactly like a real terminal would; the user types their answer directly into the terminal panel and presses Enter, and the program continues. If the program is misbehaving (an infinite loop, for example), the user can click **Stop** (the same button, now relabeled) to kill it immediately. When the program finishes on its own, the terminal shows its exit code and how long it ran.

---

## 6. Technology Stack

### 6.1 Frontend

| Technology | Role | Why chosen |
|---|---|---|
| **React** | UI framework | Component model fits the app's many independent, composable panels (editor, explorer, chat, terminal); huge ecosystem for hooks-based state management. |
| **Vite** | Build tool / dev server | Near-instant dev server start and HMR compared to older bundlers; first-class ESM and proxy support, which the app relies on for routing `/api` and `/socket.io` to the backend in development. |
| **Monaco Editor** | Code editor engine | The actual engine behind VS Code — mature syntax highlighting, per-language modes, and a model system that maps naturally onto "one file = one buffer." Building a competing editor from scratch would be reinventing a solved, extremely hard problem. |
| **Yjs** | CRDT engine | The most mature, production-proven CRDT implementation available for JavaScript, with an existing Monaco binding — gives mathematically correct concurrent editing without writing custom operational-transform logic. |
| **socket.io-client** | Real-time transport | Pairs with the server's Socket.IO, giving automatic reconnection, room support, and namespace multiplexing out of the box. |
| **xterm.js** | Terminal emulator | The industry-standard terminal emulator for the web (also used by VS Code's own integrated terminal) — ANSI color support, scrollback, resizing, and correct keyboard/paste handling come for free instead of being hand-rolled. |
| **Axios** | REST HTTP client | Interceptor support made it straightforward to centralize JWT attachment and global 401 handling in one place. |

### 6.2 Backend

| Technology | Role | Why chosen |
|---|---|---|
| **Node.js / Express** | HTTP server & routing | Non-blocking I/O model is a natural fit for a server that spends most of its time waiting on Docker, MongoDB, or an AI API — none of that blocking work ties up a thread. Express keeps routing/middleware simple and explicit. |
| **Socket.IO** | Real-time transport | Provides namespaces, rooms, and automatic reconnection/fallback on top of WebSockets — exactly the primitives the collaboration, workspace-sync, and terminal features all need, without hand-rolling connection management. |
| **dockerode** | Docker Engine API client | A direct, well-maintained Node client for the Docker Engine's own HTTP API — gives full low-level control (container creation flags, attach streams, resource limits, wait conditions) that a higher-level "run this code" SaaS API would hide. |
| **jsonwebtoken** | Auth tokens | Industry-standard, stateless JWT implementation for access tokens. |
| **bcrypt** | Password hashing | Industry-standard adaptive hashing, resistant to brute-force/rainbow-table attacks. |
| **helmet, cors, express-rate-limit** | HTTP hardening | Standard, well-tested middleware for security headers, cross-origin policy, and basic abuse throttling rather than reinventing them. |
| **@google/genai** | AI provider SDK | Official SDK for Google's Gemini models, wrapped behind an internal provider abstraction so it is a swappable implementation detail, not a hard dependency baked through the codebase. |

### 6.3 Database

| Technology | Role | Why chosen |
|---|---|---|
| **MongoDB (Atlas)** | Primary datastore | The domain data (projects, files, folders, chat, snapshots) is naturally document-shaped and doesn't need multi-table joins or rigid schemas — a good fit for Mongo's flexible document model, and Atlas removes the operational burden of running/backing up a database cluster by hand. |
| **Mongoose** | ODM | Schema validation, typed models, and query ergonomics on top of the MongoDB driver. |

### 6.4 Execution Environment

| Technology | Role | Why chosen |
|---|---|---|
| **Docker Engine** | Sandboxing / isolation | The industry-standard mechanism for process isolation with enforceable resource limits (memory, CPU, PIDs) and network restriction — exactly the guarantees required to run arbitrary, untrusted user code safely. |
| **Six language images** (`node`, `python`, `eclipse-temurin` (Java), `gcc` (C++), `golang`) | Per-language runtimes | Official, well-maintained base images for each supported language, kept as a simple, centralized language→image map so adding a language is a config change, not new execution logic. |

### 6.5 Testing

| Technology | Role | Why chosen |
|---|---|---|
| **Node's built-in `node:test` runner** | Backend test framework | Zero additional dependency, first-class async/await support, and per-file process isolation — sufficient for the project's needs without pulling in Jest/Mocha. |
| **Playwright** | Browser end-to-end testing | Used to drive a real headless Chromium against the running app for scenarios automated backend tests structurally cannot cover (e.g. confirming a live terminal actually renders and accepts keyboard input). |

### 6.6 Development Tools

| Tool | Role |
|---|---|
| **Git** | Version control, with a phase-based commit history documenting the system's incremental build-out. |
| **Docker Desktop** | Local Docker Engine used both by the app itself and by its own test suite (tests run real containers, not mocks). |
| **nodemon** | Backend auto-restart during development. |
| **dotenvx** | Environment variable management/injection. |

---

## 7. Project Structure

The repository is a two-package layout: `backend/` (Node/Express API + Socket.IO + execution engine) and `frontend/` (React/Vite SPA). High-level responsibilities, not an exhaustive file listing:

```
code-ground-partner/
├── backend/
│   └── src/
│       ├── routes/          REST endpoint declarations (thin — wiring only)
│       ├── controllers/     HTTP request/response translation (thin)
│       ├── services/        Business logic: auth, projects, files, folders,
│       │                    invitations, snapshots, chat, activity
│       ├── services/execution/
│       │                    The Docker execution engine: language config,
│       │                    Docker orchestration (batch + interactive),
│       │                    concurrency queue, metrics, health checks,
│       │                    temp workspace management
│       ├── socket/          Socket.IO wiring: default namespace (editor
│       │                    collaboration), /workspace namespace, /terminal
│       │                    namespace, room/presence/lock managers
│       ├── crdt/            Yjs document lifecycle: hydration, persistence,
│       │                    snapshotting, awareness
│       ├── ai/              AI provider abstraction, context/prompt builders,
│       │                    per-capability services (chat/explain/review/
│       │                    refactor/generate)
│       ├── db/               Mongoose connection + models (users, projects,
│       │   models/           files, folders, CRDT documents/snapshots, ...)
│       ├── middleware/       Auth, project authorization, error handling
│       └── utils/            JWT, password hashing, logging, API response
│                             shaping
│
└── frontend/
    └── src/
        ├── pages/            Top-level routed views (Landing, Login/Register,
        │                     Dashboard, Editor, Invitations, Pricing)
        ├── components/       Reusable UI: Navbar, FileExplorer, Terminal,
        │                     AI chat panel, Team chat panel, Presence,
        │                     Snapshot drawer, Activity feed
        ├── hooks/            Cross-cutting client logic: Yjs collaboration,
        │                     AI, team chat, workspace sync, file presence,
        │                     terminal session, resizable panels, editor
        │                     context
        ├── services/         Socket.IO connection wrappers (one per
        │                     namespace) — the only place raw socket.io-client
        │                     usage lives
        └── utils/            Axios client, misc helpers
```

---

## 8. Key Design Decisions

### 8.1 Why Docker (and not a third-party code-execution API)

Running arbitrary user-submitted code is fundamentally a sandboxing problem. Docker was chosen over a hosted "code execution as a service" API because the project's goal was to demonstrate infrastructure engineering directly — container lifecycle, resource limiting, network isolation, and cleanup guarantees are first-class, owned parts of the system rather than hidden behind someone else's API.

### 8.2 Why Socket.IO (and not raw WebSockets)

Three independent real-time surfaces (editor collaboration, workspace sync, terminal sessions) each need rooms, reconnection handling, and namespace isolation. Socket.IO provides all of that as a battle-tested layer over WebSockets (with automatic fallback), rather than requiring that machinery to be reimplemented by hand for three different domains.

### 8.3 Why Yjs (and not a hand-rolled operational transform)

Correct concurrent text editing is a genuinely hard distributed-systems problem (this is what Google Docs and Figma solve internally). Yjs is a mature, widely-deployed CRDT library with an existing Monaco binding — using it means the project gets provably-correct convergence guarantees instead of a custom, likely-subtly-buggy conflict resolution scheme.

### 8.4 Why Monaco (and not a plain `<textarea>` or CodeMirror)

Monaco is the actual VS Code editor engine — full syntax highlighting, bracket matching, and multi-language support come for free, and its "model" concept (one buffer object per open file) maps directly onto the app's multi-file editing requirement.

### 8.5 Why Separate REST Execution and Interactive Execution

These are genuinely different problems wearing the same "run code" label. REST execution is a *request/response* problem: submit code, get back a final buffered result — this is what `execution.service.js` / `dockerRunner.service.js` solve, using a container with no open stdin, waiting once for a final exit status. Interactive execution is a *session* problem: a long-lived container with an open pseudo-TTY, bidirectional streaming, and a socket connection tied to its lifetime. Trying to force both shapes through one code path would have made the simpler REST path more complex for no benefit, and made the interactive path fight the REST path's buffering assumptions. Keeping them as two implementations that *share* their lower-level building blocks (language configuration, temp workspace management, the concurrency queue, metrics) was the design that let both stay simple.

### 8.6 Why an Execution Queue

Docker containers are not free — each one consumes real host memory, CPU, and process table entries. Without a concurrency cap, N simultaneous Run clicks (or a single script hammering the endpoint) could spin up N containers at once with no ceiling, degrading or crashing the host for every user, not just the one making the requests. A simple in-process semaphore, shared by both execution paths, was the minimal mechanism that closes this gap without introducing an external dependency (like a distributed queue) that the project's actual scale doesn't yet need.

### 8.7 Why Execution Metrics

An execution engine that can silently fail, or silently degrade, is worse than one that can't fail at all — because nobody finds out until a user complains. A bounded in-memory ring buffer of recent outcomes (plus running aggregates) was the smallest addition that turns "is the execution engine actually working" from a guess into a question the system can answer for itself.

### 8.8 Why Health Checks

A backend process can be "up" (responding to HTTP) while its one actual job — running code — is completely broken, e.g. because the Docker daemon it depends on isn't reachable. A shallow uptime check would never catch that. The deep health endpoint (and the equivalent startup check that fails the boot fast) exists specifically to make "the API is up" and "code execution actually works" two independently verifiable, and appropriately distinct, facts.

### 8.9 Why CRDT Hydration Needed Its Own Fix

Early on, a collaboration room's Yjs document was considered "active" the instant an in-memory object was created for it — well before the (asynchronous) load-from-storage / recover-from-snapshot / seed-from-file pipeline had actually finished. That gap meant a save landing in that window could flush an empty, not-yet-loaded document over top of a file's real, previously-saved content. The fix made hydration a single atomic pipeline: a room is never considered trustworthy until that pipeline has genuinely completed (and concurrent joins to the same brand-new room correctly share one in-flight attempt rather than each re-seeding the content). See §12 for the full story.

---

## 9. Security

| Concern | How it's addressed |
|---|---|
| **Authentication** | JWT access tokens (short-lived) + server-tracked refresh tokens; passwords hashed with bcrypt, never stored or logged in plaintext. Every REST route and every Socket.IO connection independently re-verifies the token — there is no implicit trust based on prior requests. |
| **Sandboxed execution** | All user code runs inside a throwaway Docker container, never on the host process directly. |
| **Resource limits** | Every execution container is created with an explicit memory cap, CPU cap (`NanoCpus`), and process-count cap (`PidsLimit`), so a single execution cannot exhaust host resources or fork-bomb its way into starving other work. |
| **Network isolation** | Containers run with networking disabled by default (`NetworkMode: none`); the one narrow exception (TypeScript's compiler download) is an explicit, deliberate per-language override, not a blanket relaxation. |
| **Execution isolation** | Each execution gets its own freshly created temp workspace directory and its own container — no state (filesystem or process) is ever shared between two different executions or two different users' sessions. |
| **Container cleanup guarantees** | Containers are created with `AutoRemove: true` and are additionally force-removed in a `finally` block if they were created but never successfully started — covering the normal-exit, timeout, cancellation, and infrastructure-failure paths alike, verified directly by automated tests (no orphaned containers after any test run). |
| **Ownership validation** | Interactive execution sessions are tied to the exact Socket.IO connection that created them; every subsequent input/resize/stop request is checked against that ownership before being honored, so one user's socket can never control another user's running session even if it somehow learned that session's ID. Project-scoped REST actions are similarly checked against project membership and role. |
| **Input validation** | Request bodies are validated (via `express-validator`) before reaching business logic; the execution endpoint additionally validates the requested language against an explicit allowlist rather than trusting arbitrary input as a Docker image name. |
| **HTTP hardening** | `helmet` for standard security headers, `cors` for cross-origin policy, `express-rate-limit` for basic abuse throttling. |

---

## 10. Performance

| Concern | Approach |
|---|---|
| **Bounded concurrency** | The execution queue caps how many Docker containers can be alive at once, so load degrades as a queue wait rather than as host resource exhaustion. |
| **Streaming over buffering** | Interactive execution output is forwarded to the browser the instant it's produced — the server never accumulates a full program's output in memory before sending it, which also means a long-running program's memory footprint on the server stays flat regardless of how much it eventually prints. |
| **Output caps** | Both execution paths still cap total output size (larger for interactive sessions than for one-shot REST runs, since sessions are expected to run longer) — a runaway print loop gets its container killed the moment the cap is crossed, rather than being allowed to grow the response (or the socket buffer) without bound. |
| **CRDT efficiency** | Yjs updates are small, incremental binary diffs, not full-document re-transmission on every keystroke — collaboration stays responsive even on documents with substantial edit history. |
| **Debounced persistence** | Collaborative edits are persisted a couple of seconds after typing pauses (not on every keystroke), avoiding a database write per character while still keeping data loss on crash to a small, bounded window. |
| **Resource limits as a performance guarantee, not just a security one** | Per-container memory/CPU/PID caps mean one heavy execution cannot degrade the responsiveness of every other concurrent user's session. |
| **Metrics-informed operations** | Because outcomes are recorded, degraded conditions (a spike in timeouts, a particular language failing disproportionately) are visible in the health endpoint rather than only showing up as user complaints. |

---

## 11. Testing

Testing is organized by subsystem, using Node's built-in test runner (`node --test`) for the backend, and Playwright for real-browser verification.

| Suite | What it covers |
|---|---|
| **Execution tests** | Every supported language's success path, compile-failure path, and runtime-failure path, run against real Docker containers (not mocks) — because the class of bugs that matter here (Docker API races, container lifecycle edge cases) only exist when a real daemon is involved. |
| **Interactive session tests** | Session creation, live output streaming (explicitly asserted to arrive incrementally, not only after the process exits), stdin forwarding (including a real `input()` round-trip), stop/cancellation (including stopping a session that's still queued, before any container exists), disconnect cleanup, timeout cleanup, and concurrent multi-user sessions verified not to cross-talk. |
| **API tests** | The REST execution endpoint end-to-end (validation errors, and a real successful run) via a real HTTP server bound to an ephemeral port. |
| **CRDT tests** | The room hydration pipeline: first-open seeding, idempotent re-hydration, concurrent-open safety, reconnect/recovery behavior, and the save-path fix that prevents a stale in-memory document from overwriting a fresh save. |
| **Browser (end-to-end) testing** | Playwright driving a real headless Chromium against the actual running app — used specifically for the interactive terminal, because some classes of bugs (a UI element that never actually mounts due to a conditional-rendering timing issue) are invisible to any backend-only test, however thorough. This is precisely how one real frontend bug was caught before shipping (see §12). |

**Philosophy:** execution-adjacent tests deliberately run against a real Docker daemon rather than mocking the Docker API, because the bugs that matter in this subsystem — timing races between container lifecycle events, cleanup guarantees under failure — are exactly the bugs that a mock would define away.

---

## 12. Challenges Faced

### 12.1 The CRDT Hydration Race

**Problem:** A collaboration room's Yjs document was treated as "live" the moment an in-memory object existed for it — before the asynchronous pipeline that loads its persisted state (or seeds it from the file's last save) had actually finished. A REST save landing in that narrow window could force-flush that still-empty document over a file's real content, silently destroying it.

**Solution:** Hydration became a single, explicit, atomic pipeline with its own success/failure signal — a room is only ever considered trustworthy once that pipeline has genuinely completed, concurrent first-opens of the same brand-new room share one in-flight attempt (so content is never duplicated), and a failed hydration is never cached as if it succeeded (so the next attempt gets a clean retry rather than being stuck behind a permanently broken cached result).

### 12.2 The Docker AutoRemove Race

**Problem:** Containers are created with `AutoRemove: true` so Docker deletes them the instant their process exits — but for a fast-enough script (a one-line `console.log`, or a compiler that fails before a runtime even starts), the container could be fully reaped by Docker *before* the server's own code got around to asking for its exit status, producing a `404 no such container` error on what should have been a completely successful run.

**Solution:** This took three iterations to close correctly:
1. Moving the "ask for exit status" call earlier relative to other work narrowed the race but didn't close it.
2. Registering that call *before* the container was even started closed the race for exit-status correctness — but required using the right Docker API "condition" (`next-exit`, not the default), since the default condition treats a not-yet-started container as trivially "already stopped."
3. That fix then exposed a second, previously-masked race: the exit-status confirmation could now arrive *before* the last chunk of the program's own output had finished streaming in over its separate connection — closed by giving trailing output a small, strictly bounded grace window to arrive before declaring an execution finished.

### 12.3 Implementing Interactive stdin

**Problem:** The original execution container had no open stdin and no pseudo-TTY at all — by design, for a one-shot buffered runner. Making `input()`/`Scanner`/`cin`/`fmt.Scan` genuinely work required a different container shape entirely (an allocated TTY with `OpenStdin` left open, plus a live, bidirectional attach stream), without disturbing the one-shot runner that already worked correctly and was already fully tested.

**Solution:** Rather than retrofitting the existing one-shot runner to conditionally support two different container shapes, interactive execution got its own dedicated orchestration module that *reuses* the shared building blocks (language configuration, workspace management, the concurrency queue, metrics) but owns its own Docker container lifecycle — keeping the well-tested one-shot path completely untouched.

### 12.4 Designing the Execution Queue Correctly for Long-Lived Sessions

**Problem:** A simple concurrency semaphore is easy to write for short-lived work, but an interactive session can run for minutes, not seconds — and needs to hold its concurrency slot for that entire time, not just while its container is being created.

**Solution:** The queue's "run this work, then release the slot" wrapper was used to wrap a session's *entire* lifetime as a single unit of work — the slot isn't released until the session fully ends (naturally, by timeout, or by explicit stop) — so interactive sessions and one-shot batch runs correctly compete for the same bounded pool of containers instead of interactive sessions silently bypassing the cap.

### 12.5 Multi-User Isolation for Interactive Sessions

**Problem:** With sessions now living in shared server-side memory, something had to guarantee that one user's socket could never send input to, resize, or stop a session that belonged to a different user — especially since session identifiers are, by necessity, sent over the wire and could in principle be guessed or leaked.

**Solution:** Every session is tied at creation time to the exact Socket.IO connection that started it; every subsequent action against a session ID is checked against that recorded ownership before being honored. This was directly verified with automated tests, including a test simulating an "intruder" socket attempting to write input into another user's session and confirming it has no effect.

### 12.6 A Frontend Bug Only Real Browser Testing Could Catch

**Problem:** After building the interactive terminal, every backend test passed — sessions started, streamed output, accepted stdin, and stopped correctly, all verified against a real Docker daemon. But the terminal component itself had a subtle bug: its client-side setup ran once when the component first mounted, at a point where the terminal's container element didn't exist yet in the page (it only appeared once the panel was first opened) — so the terminal library never actually initialized itself at all, even though every underlying session mechanism was working perfectly.

**Solution:** This was invisible to any test that only exercised the backend or only checked that the frontend *compiled* — it required actually launching the app in a real browser, opening a file, clicking Run, and looking at what appeared on screen. Once found, the fix was to always keep the terminal's container element present in the page and toggle its visibility rather than its existence. This is a concrete illustration of why the project's testing strategy explicitly includes real browser verification, not just unit and integration tests.

---

## 13. Final Outcome

Code Ground, as it stands, is a working, end-to-end cloud IDE with:

- Full user authentication and project/team management.
- A real, Monaco-powered multi-file editor.
- Mathematically correct real-time multi-user collaborative editing (CRDT-based), with presence, cursors, typing indicators, and soft file locking.
- Team chat, an activity feed, and full-project point-in-time snapshots with restore.
- An AI assistant integrated directly into the editing context, across five distinct capabilities.
- A sandboxed, resource-limited, multi-language (six languages) Docker execution engine, with both a batch REST mode and a fully interactive terminal mode supporting live stdin.
- Production-minded operational scaffolding around that execution engine: bounded concurrency, execution metrics, deep health checks, startup validation, and rigorously verified container cleanup under every exit path (success, failure, timeout, cancellation, disconnect).

Taken together, this project demonstrates:

- **Full-stack engineering** — a coherent system spanning a React/Vite frontend, a layered Node/Express backend, MongoDB persistence, and real infrastructure (Docker) integration.
- **Distributed-systems thinking** — CRDT-based conflict-free replication, concurrency control under shared resource constraints, and race-condition analysis and remediation (the CRDT hydration fix and the Docker AutoRemove fix are both, at heart, distributed-systems bugs correctly diagnosed and closed).
- **Real-time collaborative systems** — three independently-managed real-time domains (editor collaboration, workspace sync, interactive terminals) built on a shared real-time transport without their concerns bleeding into each other.
- **Containerization & infrastructure engineering** — direct use of the Docker Engine API for sandboxing, resource limiting, and lifecycle management, rather than a third-party abstraction over it.
- **AI integration done properly** — an AI assistant with real editor context, built behind a swappable provider abstraction, rather than a hard-coded call to one vendor's API scattered through the codebase.
- **Cloud IDE architecture** — the specific, hard combination of the above that a real product in this space (Replit, CodeSandbox-class tooling) has to solve, implemented from first principles as a learning and portfolio exercise.

---

## 14. Future Scope

Realistic, well-scoped directions for continued development:

| Area | Description |
|---|---|
| **Persistent workspaces** | Currently, execution workspaces are ephemeral temp directories that exist only for the lifetime of a single run/session. A persistent per-project filesystem (so installed packages, build artifacts, etc. survive between runs) would move the product closer to a full cloud dev environment. |
| **Git integration** | Native clone/commit/push/pull support against a real Git remote, so a project in Code Ground can be a first-class participant in a team's existing version-control workflow rather than an isolated snapshot-based history. |
| **Production deployment** | Containerized deployment (the app deploying itself, not just executing user code) behind a reverse proxy/CDN, with proper environment separation and secrets management. |
| **Kubernetes-based execution scaling** | The execution engine's concurrency queue and session registry currently live in one Node process's memory — a deliberate, documented boundary. Moving container orchestration to Kubernetes (or a managed container-execution service) would allow horizontal scaling across many hosts, with the queue/session-tracking state moved to a shared store (e.g. Redis). |
| **Language servers (LSP)** | Wiring real Language Server Protocol backends per language would upgrade the editor from syntax highlighting to true autocomplete, go-to-definition, and inline diagnostics. |
| **Package manager support inside execution containers** | Letting a project declare dependencies (a `requirements.txt`, `package.json`, `go.mod`) that get installed into its execution environment, rather than every run being a single self-contained file. |
| **Additional languages** | The language configuration is already a simple, centralized map — extending it to Rust, Ruby, PHP, C#, etc. is a config addition, not new execution engine logic. |
| **Session persistence across reconnects** | Interactive terminal sessions currently end if the client's socket disconnects; a reconnect-and-resume model (rather than "the session is gone") would improve resilience to brief network drops. |
| **Deeper observability** | Exporting the existing execution metrics to a real time-series backend (Prometheus/Grafana) instead of an in-memory ring buffer, for historical trend analysis rather than only "recent" visibility. |
| **Expanded AI capabilities** | Multi-turn conversational memory across sessions, project-wide (not just single-file) context, and streaming token-by-token responses rather than single-shot JSON replies. |

---

*This document describes the system as of the completion of Phase 7 (Interactive Execution Terminal). It should be revisited and updated as future phases land.*
