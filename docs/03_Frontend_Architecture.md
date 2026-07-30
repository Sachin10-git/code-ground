# Code Ground — Frontend Architecture

> **Scope of this document:** This document explains the Code Ground frontend as an independent software system — its layering, rendering model, state flow, real-time integration, and the reasoning behind its structure. Backend behavior is discussed only at the boundary the frontend actually touches (a REST contract, a socket event) — never its internal implementation.
>
> Companion documents: [`00_Project_Overview.md`](./00_Project_Overview.md) (product view), [`01_System_Architecture.md`](./01_System_Architecture.md) (whole-system view), [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) (backend-internal view). Concepts already covered there — the shared JWT model, CRDT theory, the Docker execution engine's internals — are referenced, not re-derived, except where a frontend-specific angle is needed.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Frontend Overview](#2-frontend-overview)
3. [Frontend Folder Structure](#3-frontend-folder-structure)
4. [Routing Architecture](#4-routing-architecture)
5. [Component Architecture](#5-component-architecture)
6. [State Management](#6-state-management)
7. [API Layer](#7-api-layer)
8. [Socket.IO Integration](#8-socketio-integration)
9. [Monaco Editor Architecture](#9-monaco-editor-architecture)
10. [Interactive Terminal](#10-interactive-terminal)
11. [AI Interface](#11-ai-interface)
12. [Collaboration Interface](#12-collaboration-interface)
13. [Authentication Flow](#13-authentication-flow)
14. [User Workflow](#14-user-workflow)
15. [Error Handling](#15-error-handling)
16. [Performance](#16-performance)
17. [Responsive Design](#17-responsive-design)
18. [Design Decisions](#18-design-decisions)
19. [Future Frontend Improvements](#19-future-frontend-improvements)
20. [Conclusion](#20-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the Frontend

The frontend is the single surface through which every Code Ground capability — authentication, project management, collaborative editing, AI assistance, and live code execution — is actually experienced. Its job is not merely to render data the backend hands it; it is to hold together **five simultaneously-live data sources** (REST responses, and three independent Socket.IO connections carrying editor collaboration, workspace/presence/chat events, and terminal I/O) into one coherent, responsive editing surface, without any of those sources' failure or latency freezing the other four.

### 1.2 Design Philosophy

The frontend is built around a strict **dependency direction** — Pages depend on Components and Hooks; Components depend on Hooks; Hooks depend on Services; only Services touch a network transport directly — enforced consistently enough that a contributor can predict, from a file's location alone, what it is and is not allowed to reach into.

### 1.3 Architectural Goals

| Goal | Concrete meaning in this frontend |
|---|---|
| **Component Reusability** | Presentational components (Navbar, FileExplorer, Terminal, chat panels) accept data and callbacks as props and hold no knowledge of *where* that data came from — the same component works whether its data flows from a hook backed by a socket or a hook backed by REST |
| **Separation of Concerns** | Rendering (components), cross-cutting client logic (hooks), and transport (services) are three distinct layers that never collapse into each other |
| **Maintainability** | Each cross-cutting concern (collaboration, AI, terminal sessions, workspace sync) has exactly one hook that owns it — a bug in "how AI chat state updates" has exactly one place to look |
| **Scalability** *(of the codebase, not infrastructure)* | Adding a new real-time feature means adding a new hook + a thin service wrapper, following an established pattern, not restructuring the Editor page |
| **Responsiveness** | The UI never blocks on a network round trip for anything that can be reflected optimistically or streamed incrementally (see §16) |
| **User Experience** | Collaboration, AI, and execution are presented as one continuous workspace, not as separate tools bolted together |
| **Performance** | Heavy client libraries (Monaco, Yjs, `socket.io-client`, xterm.js) are lazy-loaded; state updates that don't need to trigger a re-render (e.g. streaming terminal output) deliberately don't go through React state at all |

---

## 2. Frontend Overview

```
                              ┌───────────────┐
                              │    Browser       │
                              └───────┬───────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   React Application         │
                         │  (Vite build, BrowserRouter,│
                         │   AuthProvider at the root)  │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │           Pages              │
                         │  Landing, Login/Register,     │
                         │  Dashboard, Editor,             │
                         │  Invitations, Pricing             │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │        Components             │
                         │  Navbar, FileExplorer,          │
                         │  Terminal, AI/Team chat panels,   │
                         │  Presence, Snapshot drawer,         │
                         │  Activity feed                       │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │           Hooks               │
                         │  useYjs, useAI, useTeamChat,     │
                         │  useWorkspaceSync,                │
                         │  useTerminalSession,                 │
                         │  useFilePresence, useEditorContext,   │
                         │  useAuth, useResizablePanel             │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │          Services              │
                         │  api.js (REST/Axios),            │
                         │  workspaceSocket.js,                │
                         │  terminalSocket.js                     │
                         │  (the ONLY layer touching a            │
                         │   raw transport)                        │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   REST API   /   Socket.IO      │
                         │      (backend boundary)             │
                         └─────────────────────────┘
```

Every layer above only ever calls downward — a Page never reaches past a Hook into a Service directly if a Hook already owns that concern, and a Component never imports `axios` or `socket.io-client`. This one-directional dependency graph is what keeps five simultaneously-live data sources from turning the Editor page into an unmanageable tangle.

---

## 3. Frontend Folder Structure

The actual `src/` layout is intentionally shallow and role-based — there is no separate `contexts/`, `assets/`, or `styles/` directory, because those concerns are handled differently than a typical scaffold might suggest (explained below).

| Folder | Responsibility |
|---|---|
| **`pages/`** | Top-level, router-mounted views. Each page composes components and hooks and owns only page-scoped state (e.g. which file is currently selected in the Editor) |
| **`components/`** | Reusable, mostly presentational units — the Navbar, the File Explorer, the Terminal, the AI and Team Chat panels, Presence, the Snapshot drawer, the Activity feed. A `components/markdown/` subfolder holds the lightweight Markdown renderer used to display AI responses |
| **`hooks/`** | Cross-cutting client logic — one hook per concern (collaboration, AI, chat, workspace sync, file presence, terminal sessions, resizable panels, editor context) plus the one global Context provider in the codebase, `useAuth` |
| **`services/`** | Thin transport wrappers — one per Socket.IO namespace (`workspaceSocket.js`, `terminalSocket.js`) plus the single configured REST client (`api.js` and its real/mock implementations, resolved at build time) |
| **`utils/`** | Small, dependency-free helpers: collaborator cursor color assignment, workspace-tree manipulation helpers, invitation formatting |

**Where styling lives:** Code Ground uses **CSS Modules co-located with each component** (`ComponentName.jsx` next to `ComponentName.module.css`) rather than a centralized `styles/` directory — a component's styles are exactly as easy to find as the component itself, and CSS Modules' automatic class-name scoping means no component's styles can leak into another's by accident.

**Where global state lives:** there is no separate `contexts/` directory because the codebase deliberately uses **exactly one** React Context — authentication (`useAuth.jsx`) — and every other cross-cutting concern is a custom hook instead (see §6 for why).

---

## 4. Routing Architecture

### 4.1 Route Organization

Routing is handled by `react-router-dom`, with the router mounted once at the application root (`BrowserRouter` in the entry file) and every route declared in one central route table. Routes fall into three categories:

| Category | Routes | Access rule |
|---|---|---|
| **Public** | Landing, Pricing | Always renderable |
| **Public-only** | Login, Register | Renderable only when **not** authenticated — an already-signed-in user is redirected to the Dashboard |
| **Protected** | Dashboard, Editor, Invitations | Renderable only when authenticated — an unauthenticated user is redirected to Login |

### 4.2 Route Guards

Two small wrapper components implement the access rule, both reading from the single `useAuth()` source of truth:

- A **protected-route wrapper** renders its children only if a user is present; otherwise it redirects to `/login`.
- A **public-only-route wrapper** does the inverse — redirects an already-authenticated user away from Login/Register to the Dashboard.

Neither wrapper contains any logic of its own beyond that one check — the actual "is this user authenticated" state is computed exactly once, in `useAuth`, and every guard simply reads it.

### 4.3 Navigation Flow

```
                         ┌───────────┐
                         │  Landing    │
                         └─────┬─────┘
                    ┌───────────┼───────────┐
                    ▼                       ▼
              ┌───────────┐           ┌───────────┐
              │   Login     │◀────────▶│  Register   │
              └─────┬─────┘           └─────┬─────┘
                    │  (successful auth)      │
                    └───────────┬───────────┘
                                ▼
                         ┌───────────┐
                         │  Dashboard  │◀──────────────┐
                         └─────┬─────┘                 │
                                │ open a project           │ back
                                ▼                       │
                         ┌───────────┐                 │
                         │   Editor    │─────────────────┘
                         └─────┬─────┘
                                │ accept/manage invites
                                ▼
                         ┌───────────┐
                         │Invitations │
                         └───────────┘
```

### 4.4 Layout Structure

There is no separate persistent app "shell" layout wrapping every route — each page is self-contained and renders its own top-level structure (the Editor page, for instance, owns its own Navbar/sidebar/panel layout entirely, since no other page shares that structure). This reflects that Code Ground's pages are few and structurally very different from each other (a marketing Landing page and the dense, panel-heavy Editor page share almost nothing layout-wise) — a shared shell would have added indirection without reducing duplication.

---

## 5. Component Architecture

### 5.1 Component Categories

| Category | Examples | Characteristics |
|---|---|---|
| **Layout / page-level** | The Editor page's own top-level structure (Navbar + sidebar + main panel + right panel) | Owns page-scoped layout state (panel widths, which right-panel tab is active) |
| **Shared UI components** | Navbar, Presence indicator, resizable panel dividers | Reusable, prop-driven, no knowledge of any specific feature's data source |
| **Feature components** | FileExplorer, SnapshotDrawer, ActivityFeed, InviteModal | Feature-specific rendering, but data/actions are still supplied via props from a hook, not fetched internally |
| **Editor components** | The Monaco wrapper embedded directly in the Editor page | Bridges React's declarative model to Monaco's imperative editor instance API (see §9) |
| **AI components** | AIChatPanel, AIChatMessage, the Markdown renderer | Render chat history and loading/error states; all AI request logic lives in the `useAI` hook, not in these components |
| **Terminal components** | Terminal (the xterm.js wrapper) | Bridges React's declarative model to xterm.js's imperative terminal instance API (see §10); exposes an imperative `run`/`stop` handle via `ref` rather than owning its own Run/Stop UI, so the Navbar remains the single Run/Stop control |

### 5.2 Component Composition Principle

A component either **renders data + calls callbacks** (the large majority — Navbar, FileExplorer, chat panels, Presence) or **bridges to an imperative third-party instance** (Monaco, xterm.js — a small, deliberately contained minority). No component does both — the components that own an imperative instance (Editor's Monaco integration, the Terminal component) still receive their *data* (file content to load, output chunks to write) via the same hook-driven prop/callback pattern every other component uses; only the *rendering mechanism* underneath differs.

### 5.3 Component Hierarchy (Editor Page — the Densest Case)

```
 Editor (page)
   │
   ├── Navbar
   │     ├── EditableTitle
   │     ├── LanguageSelector
   │     ├── Presence
   │     └── Run/Stop button  (imperatively drives the Terminal ref)
   │
   ├── FileExplorer            (left sidebar, resizable)
   │
   ├── Monaco editor instance  (center — one instance, one model per open file)
   │     └── bound to the active file's live Yjs document
   │
   ├── Right panel (tabbed)
   │     ├── AIChatPanel
   │     │     └── AIChatMessage × N  (each rendering via MarkdownLite)
   │     └── TeamChatPanel
   │           └── TeamChatMessage × N
   │
   ├── FilePresenceBar          (who else has this file open)
   │
   ├── Terminal                 (bottom panel, collapsible/resizable)
   │     └── xterm.js instance
   │
   └── SnapshotDrawer           (overlay, opened on demand)
```

---

## 6. State Management

### 6.1 The Layers of State

| Layer | Used for | Example |
|---|---|---|
| **Local component state** (`useState` inside a component) | Purely presentational, component-scoped concerns | Whether a dropdown is open, a form's input value before submit |
| **Custom hooks** | Any state that is cross-cutting, backed by a live data source, or needs to be shared by more than one component on the same page | Collaboration state, chat history, presence, terminal session state, resizable-panel width |
| **React Context** (`useAuth`) | State that is genuinely global to the whole application, needed by pages that share nothing else | The current authenticated user and login/register/logout actions |
| **No global state library** | — | Deliberately absent — see §6.3 |

### 6.2 Why Hooks, Not a Global Store, Are the Primary State Mechanism

Most of this application's "shared" state is not actually *global* — it is scoped to exactly one page (the Editor) and exists only because several components on that page need to read or react to it (e.g. both the Navbar's Run button and the Terminal component need to agree on whether a session is currently running). A custom hook, owned by the page and passed down as props/refs, gives that sharing without promoting the state to a true application-wide store — which would be the wrong scope for state that has no meaning outside a single page's lifetime.

### 6.3 Why No Redux/Zustand/Global Store

The application has exactly one genuinely global piece of state — the authenticated user — which a single Context comfortably handles. Every other piece of "shared" state described throughout this document is either page-scoped (owned by a hook, instantiated fresh each time the Editor mounts) or naturally owned by whichever component holds the relevant live connection (e.g. the Terminal component owning its own socket-backed session hook). Introducing a global state management library would have added indirection to solve a sharing problem this codebase doesn't actually have.

### 6.4 State Flow Example — Running Code

```
 User clicks Run (Navbar)
        │
        ▼
 Editor page's handleRun() calls terminalRef.current.run()
        │
        ▼
 Terminal component resolves the current file's language/content/
 project (via the Editor Context hook) and calls its OWN
 useTerminalSession hook's run()
        │
        ▼
 useTerminalSession emits a socket event and updates its internal
 `running` state
        │
        ▼
 Terminal reports that `running` boolean back UP to the Editor page
 via a callback prop, so the Navbar's single Run/Stop button reflects
 it — without the Editor page needing to know anything about sockets
 or sessions itself
```

This illustrates the general pattern: **state is owned as close as possible to the thing that produces it**, and surfaced upward only as far as another component actually needs to react to it.

---

## 7. API Layer

### 7.1 Structure

A single, centrally configured Axios instance is the only object in the codebase that constructs an HTTP request. It is configured once with:

- A base URL of `/api` (resolved to the real backend via the dev server's proxy, or a production reverse proxy — the frontend never hard-codes a backend host).
- A request interceptor that attaches the stored JWT as an `Authorization` header to every outgoing request.
- A response interceptor that, on a `401`, clears stored auth state and redirects to `/login` — globally, once, rather than every call site needing its own 401 handling.

### 7.2 Error Handling at the API Layer

Every other error (4xx business errors, 5xx failures) is left to propagate to the calling hook, which is responsible for translating it into whatever UI state (an inline error message, a toast, a retry affordance) is appropriate for that specific feature — the API layer's job is to normalize *transport*, not to decide what every feature should do when a request fails.

### 7.3 Loading States

There is no global "is a request in flight" indicator — each hook that performs a request tracks its own loading state relevant to its own feature (e.g. `useAI`'s per-message `streaming` flag, the Editor's own `saving` flag for the Save button). This keeps loading UI precise (only the thing actually waiting shows a spinner) rather than a single global spinner that would be a poor proxy for "is *this* particular action still pending."

### 7.4 Why API Logic Is Isolated From UI

No component and no page constructs a request directly. This means: the REST contract can change (a URL, a payload shape) with edits confined to the hook that owns that feature; a request can be swapped for a mock implementation (as the codebase's `api.mock.js`/`api.real.js` split demonstrates — resolved at build time via an alias) without touching a single component; and every request automatically gets the same auth-attachment and 401-handling behavior with zero per-feature boilerplate.

---

## 8. Socket.IO Integration

### 8.1 Three Independent Connections

The frontend opens **up to three separate Socket.IO connections**, mirroring the backend's namespace split (see the System and Backend Architecture documents for the server-side rationale):

| Connection | Owned by | Purpose |
|---|---|---|
| **Default namespace** | `useYjs` hook | Per-file editor collaboration: CRDT sync, cursors, typing, file locks |
| **`/workspace`** | `useWorkspaceSync` / `useTeamChat` (a shared, ref-counted connection) | File tree events, presence, team chat, activity feed, snapshots |
| **`/terminal`** | `useTerminalSession` (via the Terminal component) | One execution session's live I/O |

### 8.2 Connection Lifecycle

Each service module (`workspaceSocket.js`, `terminalSocket.js`) is responsible for opening its own connection, attaching the stored JWT to the handshake, and exposing a small, typed set of emit/listen helpers — hooks never call `socket.io-client` directly. The `/workspace` connection is **ref-counted**: multiple hooks on the same page (workspace sync and team chat) need the *same* connection and the same project room, so the first consumer opens it and the last consumer to unmount closes it, rather than each hook opening a redundant connection. The `/terminal` connection, by contrast, is owned by exactly one component (the Terminal) for exactly as long as that page's terminal panel exists — no ref-counting needed, since there is only ever one consumer.

### 8.3 Reconnection

The default namespace and `/workspace` use Socket.IO's built-in reconnection where appropriate (a brief network drop should transparently resume collaboration/presence). The `/terminal` connection deliberately does **not** auto-reconnect: because the backend ties a running execution session to the exact socket connection that created it, a transparently reconnected socket would have a new identity the backend would no longer recognize as owning that session — so a terminal disconnect is treated as "this run's session is over," consistent with what actually happens server-side, rather than papered over with a reconnect that couldn't actually resume the same session anyway.

### 8.4 Room Management

Joining a room (a file's collaboration room, a project's workspace room) is an explicit action taken by the owning hook when its corresponding UI context becomes active (a file is opened; the Editor page mounts) and explicitly reversed when that context goes away (switching files, unmounting) — rooms are never joined implicitly or left implicitly to expire.

### 8.5 Cleanup

Every hook that opens a connection or joins a room also owns tearing it down on unmount — leaving a file (or the whole page) always triggers an explicit leave/disconnect from the client side, which is what allows the backend's own disconnect-cleanup logic (releasing locks, stopping an owned session) to run promptly rather than waiting for a connection timeout.

### 8.6 Streaming

The `/terminal` connection is architecturally different from the other two in one respect: it is the one connection where the **backend is a sustained source of a high-frequency event stream** (terminal output), not primarily a relay between peer clients. This is why terminal output is deliberately **not** routed through React state (see §16) — every other socket-driven update in the app is comparatively low-frequency (a cursor move, a chat message) and fits naturally into React's render cycle.

### 8.7 Event Flow Diagram — Collaboration (Representative)

```
 This client                    Server                    Other clients
     │                             │                              │
     │  editor:file-change           │                              │
     │  (local Yjs update)            │                              │
     │ ───────────────────────────▶ │                              │
     │                             │  applies + re-broadcasts         │
     │                             │       editor:file-updated          │
     │                             │ ───────────────────────────────▶ │
     │                             │                              │  applies to local
     │                             │                              │  Yjs replica →
     │                             │                              │  Monaco updates
```

---

## 9. Monaco Editor Architecture

### 9.1 Integration Model

Monaco is mounted **once** for the Editor page's lifetime. Each open file is represented as its own Monaco **model** — an independent in-memory buffer with its own undo/redo stack, scroll position, and language mode. Switching between open files re-attaches a different model to the single visible editor instance rather than tearing down and recreating Monaco itself, which is what makes switching files instantaneous and preserves per-file editing state exactly like a desktop IDE's tab strip.

### 9.2 Loading a File

Opening a file: if a Monaco model for it doesn't yet exist, one is created and seeded with the file's content; if it already exists (the user is switching back to a previously opened file), the existing model — with all of its preserved state — is simply re-attached.

### 9.3 Saving and Auto-Save

An explicit Save action persists the active model's current content via the API layer. Beyond that, the collaboration layer (§12) maintains its own **debounced auto-persistence** of live collaborative edits, independent of the user explicitly clicking Save — so collaborative content is durably saved on a short delay after typing pauses, while an explicit Save remains the user-visible, intentional action.

### 9.4 Collaboration Binding

When a file's collaboration room is ready (see §12's hydration discussion), the active Monaco model is bound to that file's shared Yjs document via a Monaco/Yjs binding — from that point, local keystrokes become CRDT updates broadcast to collaborators, and incoming remote updates are applied directly into the Monaco buffer. Until that binding is confirmed attached, the editor is deliberately kept read-only, closing a narrow window where a keystroke typed before the binding exists could otherwise be silently overwritten once collaboration sync catches up.

### 9.5 Language Detection

A file's language is resolved primarily from its stored `language` field, falling back to an extension-based lookup table when that field is unset (e.g. `plaintext`, the default for a newly created file) — ensuring syntax highlighting is correct even for files created without an explicit language choice.

### 9.6 Editor Lifecycle Summary

```
 Editor page mounts
        │
        ▼
 Monaco instance created (once)
        │
        ▼
 User selects a file  ──▶  model exists? ──yes──▶ re-attach existing model
        │                        │
        │                        no
        │                        ▼
        │                create + seed a new model
        ▼
 Collaboration room hydration completes ──▶ bind model to live Yjs document
        │                                          (editor becomes writable)
        ▼
 User types  ──▶  local model updates + CRDT broadcast (if bound)
        │
        ▼
 User switches file / closes page  ──▶  model detached (not destroyed) /
                                          Monaco instance unmounts with the page
```

### 9.7 Why Monaco Was Chosen

Monaco is the actual editor engine behind VS Code — production-grade syntax highlighting, bracket matching, and per-language modes for every supported language come built-in, and its model concept maps directly onto this application's "one file, one independently-stateful buffer" requirement. Building a comparable editing experience from a plain text area or a lighter-weight editor library would have meant reimplementing a large, already-solved problem.

---

## 10. Interactive Terminal

### 10.1 Why xterm.js

xterm.js is the terminal emulator used by VS Code's own integrated terminal — ANSI color rendering, scrollback, resizing, and correct keyboard/paste handling are built in, rather than needing to be hand-implemented on top of a plain scrolling text view.

### 10.2 Session Management (Frontend Side)

The Terminal component owns a dedicated hook (`useTerminalSession`) that manages exactly one `/terminal` socket connection and the lifecycle of whatever execution session is currently running on it: starting a session, tracking whether one is currently running, and exposing `run`/`stop`/`sendInput`/`resize` actions. The connection itself is opened once and reused across multiple Run clicks within the same page visit — it is not reopened per run.

### 10.3 stdin / stdout / stderr

Every keystroke typed into the mounted xterm.js instance is forwarded, verbatim, as terminal input over the socket — there is no client-side interpretation of what's being typed (no attempt to distinguish "this looks like an answer to a prompt" from ordinary output); the container on the other end handles it exactly as a real terminal's stdin would. Output arriving from the socket (combined stdout/stderr, since the execution container allocates a single TTY) is written directly into the terminal's buffer as it arrives.

### 10.4 Streaming, Not Buffering

Output is **never accumulated into React state** — each chunk is written straight into the xterm.js instance imperatively via a callback, bypassing React's render cycle entirely for what can be a very high-frequency event stream. This is a deliberate performance decision (see §16): routing potentially hundreds of small updates a second through `setState` would create visible input lag and unnecessary re-renders of everything else on the page.

### 10.5 Run/Stop Workflow

The Terminal component does not render its own Run/Stop control. Instead, it exposes an **imperative handle** (`run()`/`stop()`) via `ref`, and reports its `running` boolean upward via a callback — the Navbar's single Run/Stop button is the only control the user sees, and it drives the Terminal component's session imperatively rather than the two maintaining separate, potentially-inconsistent state.

### 10.6 Terminal Lifecycle Diagram

```
 Terminal component mounts (once, with the Editor page)
        │
        ▼
 xterm.js instance created immediately — its container element is
 ALWAYS present in the DOM (visibility toggled via CSS, not
 conditional mounting), so initialization never races the panel
 being opened for the first time
        │
        ▼
 User clicks Run (Navbar)  ──▶  Terminal.run() imperative call
        │
        ▼
 useTerminalSession opens (or reuses) the /terminal socket,
 emits a start event
        │
        ▼
 Session ready  ──▶  running = true  ──▶  reported to Navbar
        │
        ▼
 Output streamed in, written directly into xterm.js
 User input typed  ──▶  forwarded as session input
        │
        ▼
 Session ends (naturally, Stop clicked, or timeout)
        │
        ▼
 running = false  ──▶  Navbar reverts to "Run"; exit status shown
```

---

## 11. AI Interface

### 11.1 The Five Capabilities, Frontend Side

Each of Chat, Explain, Review, Refactor, and Generate is exposed as its own action in the AI panel, but all five share one hook (`useAI`) and one request/response lifecycle — they differ only in which REST endpoint is called and what context is attached (the whole file for Explain/Review, a natural-language instruction for Generate, the ongoing conversation for Chat).

### 11.2 Prompt/Context Handling

Whatever context a given capability needs — the current file's language and content, the user's active selection — is read at the moment the action is triggered from the shared **Editor Context hook**, the same source both the AI features and the Run action use, so neither independently re-derives "what is the user currently looking at."

### 11.3 Response Rendering

Responses are rendered through a small, purpose-built Markdown renderer (rather than a full general-purpose Markdown library), sized to exactly what AI responses need: code blocks, basic emphasis, and lists.

### 11.4 Loading and Error States

Because AI responses are single, non-streaming JSON round trips (see the System Architecture document, §9), the UI shows a lightweight "thinking" placeholder message for the duration of the request, replaced by the real content on success or an inline error message on failure — there is no partial/token-by-token rendering today.

### 11.5 Why Stateless Interactions

Each AI request carries whatever conversational context it needs at call time; the frontend (not the backend) is the party responsible for holding conversation history, since the backend deliberately holds none between requests (see the Backend Architecture document, §12.3). This means a page refresh naturally resets AI conversation state — an accepted, simple trade-off rather than an oversight — and a slow or failed AI call can never corrupt any other in-flight request's context.

---

## 12. Collaboration Interface

### 12.1 What the User Sees

- **Presence** — who is online in the project (navbar-level) and who specifically has the current file open (a dedicated presence bar).
- **Live edits** — remote keystrokes appear in the Monaco buffer in real time, via the CRDT binding described in §9.4.
- **Cursor synchronization** — collaborators' cursor positions and selections are rendered as live overlays, driven by Yjs awareness state (ephemeral, never persisted) rather than the document itself.
- **File locking** — a soft, advisory "locked by X" indicator shown when another user is actively editing the same file — informational, not a hard block (Yjs would merge concurrent edits correctly regardless).
- **Snapshots** — a drawer listing a project's point-in-time checkpoints, with restore/rename/delete actions.
- **Team chat** — a persistent, project-scoped chat panel, with history replayed to a client the moment it joins.

### 12.2 Conflict Handling — Deliberately Not the Frontend's Job

The frontend does not implement any merge or conflict-resolution logic of its own. Concurrent edits are resolved entirely by Yjs's CRDT guarantees (explained architecturally in the System Architecture document, §8) — the frontend's only responsibility is applying incoming updates to its local replica and letting Monaco reflect whatever the replica now contains. This is a direct consequence of choosing a CRDT: the UI layer is freed from ever needing to ask "whose edit wins."

### 12.3 Real-Time UI Update Pattern

Every collaboration-adjacent piece of UI (presence, cursors, locks, chat, activity feed) follows the same shape: a hook subscribes to the relevant socket event(s) on mount, updates its own local state when an event arrives, and unsubscribes/leaves on unmount — there is no polling anywhere in the collaboration interface; every update is push-driven.

---

## 13. Authentication Flow

### 13.1 Frontend Lifecycle

```
 App boots
    │
    ▼
 useAuth checks localStorage for a previously stored token
    │
    ├── none found ──▶ render signed-out UI (Landing/Login/Register reachable)
    │
    └── found ──▶ optimistically show the cached user immediately,
                   then confirm the token is still valid in the
                   background (a "who am I" check) — refreshing the
                   user object if the server-side state changed
                          │
                          ▼
                  invalid/expired? ──▶ clear stored auth, fall back
                                        to signed-out UI
```

### 13.2 Login / Register

Both forms call `useAuth`'s corresponding action, which performs the REST call, and — on success — stores the returned token and user object, making the authenticated state available to the entire app instantly (every consumer of `useAuth` re-renders with the new user).

### 13.3 JWT Storage

The access token is kept in `localStorage`, read by the API layer's request interceptor on every outgoing call (§7.1) and attached to every Socket.IO connection's handshake (§8) — one stored token serves both transports uniformly.

### 13.4 Session Restoration

A page refresh does not lose the session: the token persists in `localStorage`, and the boot-time check described in §13.1 re-establishes the authenticated UI state (optimistically, then confirmed) without requiring the user to log in again.

### 13.5 Protected Routes & Logout

Route guards (§4.2) read the same `useAuth` state to decide what's renderable. Logout clears the stored token and user object and resets `useAuth`'s state to signed-out, which every guard immediately reflects, and which the API layer's response interceptor also triggers automatically on any subsequent `401`.

### 13.6 Sequence Diagram

```
 Browser                    useAuth                    REST API
    │                          │                            │
    │  submit login form         │                            │
    │ ───────────────────────▶ │                            │
    │                          │  POST /api/auth/login          │
    │                          │ ───────────────────────────▶ │
    │                          │  { accessToken, user }           │
    │                          │ ◀───────────────────────────  │
    │                          │  store token + user               │
    │                          │  (localStorage)                     │
    │  re-render as signed-in     │                            │
    │ ◀───────────────────────  │                            │
    │                          │                            │
    │  (later) any protected      │                            │
    │  REST call                    │                            │
    │ ─────────────────────────────────────────────────────▶ │
    │                          │        Authorization: Bearer <token>│
    │                          │        (attached by the API layer's  │
    │                          │         interceptor, reading the       │
    │                          │         same stored token)               │
```

---

## 14. User Workflow

```
   Login / Register
          │
          ▼
      Dashboard  ── list / create Projects
          │
          ▼
        Editor
          │
   ┌──────┼──────────────┬──────────────┐
   ▼      ▼              ▼              ▼
 Edit    AI Assistant   Run Code    Collaborate
 files   (chat/explain/  (Docker      (live cursors,
 (Monaco) review/refactor/ execution)   chat, presence)
          generate)         │
                             ▼
                    Interactive Terminal
                    (stdin/stdout, Stop)
```

**Narrative:** a user authenticates, lands on the Dashboard, opens (or creates) a Project, and enters the Editor — the page where the remaining four activities (editing, AI assistance, running code, and collaborating) all happen concurrently and independently of each other. None of the four blocks any of the others: a user can be mid-conversation with the AI assistant while a long-running terminal session is still streaming output, while a collaborator's cursor moves live in the same file.

---

## 15. Error Handling

| Source | Frontend handling |
|---|---|
| **API (REST) errors** | Surfaced by the hook that made the call, as an inline message specific to that feature (e.g. a save failure banner in the Editor); a global `401` is the one case handled centrally (redirect to Login) |
| **Socket errors** | A failed/rejected connection handshake (e.g. an expired token) is surfaced by the owning hook as a connection-status/error state, rather than crashing the page |
| **Terminal errors** | A session-creation failure (e.g. an unsupported language) or an unexpected disconnect is shown directly in the terminal panel's status area, distinct from normal program output |
| **Editor (Monaco) errors** | A failure to establish the collaboration binding is shown as an explicit banner, and the editor is kept read-only rather than allowing edits that can't currently sync |
| **AI failures** | Rendered as an inline error state on the specific chat message that failed, with the rest of the conversation history unaffected |
| **Loading states** | Local to whichever feature is in flight (§7.3) — no global loading overlay |
| **Fallback UI** | Route guards double as a coarse fallback (an invalid/expired session cleanly falls back to the signed-out experience rather than a broken authenticated page) |
| **Retry mechanisms** | Handled per-feature where it makes sense (e.g. a failed AI message can be retried individually); there is no generic automatic retry wrapper applied uniformly across every request |

---

## 16. Performance

| Technique | Applied where | Effect |
|---|---|---|
| **Lazy loading** | Monaco, Yjs, `socket.io-client`, xterm.js, and its fit addon are all dynamically imported rather than bundled into the initial page load | Faster first paint; these libraries are only fetched once the Editor page (and, for xterm.js, the Terminal specifically) actually needs them |
| **Bypassing React state for high-frequency streams** | Terminal output is written directly into the xterm.js instance via a callback, never through `setState` | Avoids potentially hundreds of re-renders per second during a chatty program's output |
| **Per-file Monaco models instead of remounting** | Switching between open files | Instant tab switching; no re-parsing or re-initializing the editor per file |
| **Component reuse** | Shared presentational components (Presence, chat message rendering) used identically across contexts | Less code, and consistent behavior wherever they appear |
| **Ref-counted shared socket connections** | `/workspace` namespace, shared by workspace sync and team chat | Avoids opening a redundant second connection (and redundant room-join traffic) for two features that need the same room |
| **Debounced/local-first interaction** | Typing in the collaborative editor updates the local Monaco buffer instantly; the CRDT broadcast and eventual persistence happen asynchronously alongside it | Typing never waits on a network round trip |
| **Socket namespace separation** | Three independent connections rather than one shared firehose | A busy terminal session's event volume cannot create head-of-line delay for an unrelated cursor-movement broadcast |

**Note on bundle size:** the production build does produce a few large chunks (notably the Yjs/Monaco collaboration binding), flagged by the build tooling itself — an acknowledged, not yet fully addressed, optimization opportunity (see §19).

---

## 17. Responsive Design

### 17.1 Desktop-First Approach

Code Ground is built desktop-first: its core experience — a multi-panel IDE with a file tree, an editor, a terminal, and chat/AI panels simultaneously visible — assumes a viewport wide enough to show several of those panels at once, mirroring how real desktop IDEs are used. This is a deliberate scope decision, not an oversight; a meaningfully different, simplified layout would be needed for a genuinely mobile-first experience (see §19).

### 17.2 Layout Responsiveness

- **Panels** (the left file-explorer sidebar, the right AI/Team-chat panel, the bottom terminal panel) are independently resizable via drag handles, each remembering its last size.
- **Navigation** collapses to its essential elements (back, project title, language, Run/Stop) rather than a responsive hamburger-menu pattern, since the target viewport is desktop-scale.
- **Editor resizing**: Monaco is told to remeasure itself whenever its container's size changes (sidebar/panel resize, window resize), so text never renders against a stale layout.
- **Terminal resizing**: the xterm.js instance is kept fitted to its container via a resize observer, and a resize is also propagated to the backend so the executing program's own notion of terminal size (relevant to some interactive/full-screen CLI programs) stays correct.

### 17.3 Accessibility Considerations

Baseline accessibility practices are applied where they don't conflict with the IDE metaphor: semantic control roles and ARIA labels on icon-only buttons (Run/Stop, panel toggles, the resize handles), keyboard-operable resize handles (arrow-key resizing as an alternative to dragging), and visible focus states on interactive elements. A full accessibility audit (screen-reader flows through Monaco/xterm.js specifically, which are themselves third-party components with their own accessibility characteristics) is a documented future improvement rather than a completed guarantee (§19).

---

## 18. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why React** | A component model that fits an application made of many independent, composable panels (editor, explorer, chat, terminal) | Enormous ecosystem; hooks make cross-cutting client logic easy to isolate and reuse | Requires discipline (enforced here by convention, not tooling) to keep the component/hook/service layering from collapsing over time |
| **Why Vite** | Fast dev server start and hot module replacement, plus first-class ESM and dev-server proxy support the app relies on for routing `/api` and `/socket.io` to the backend | Near-instant local iteration; simple, explicit proxy configuration | Less mature plugin ecosystem than older bundlers for some edge-case needs (not encountered here) |
| **Why Monaco** | The actual VS Code editor engine | Professional editing experience with zero need to build one from scratch | A heavy dependency — mitigated by lazy loading |
| **Why xterm.js** | The de facto standard web terminal emulator, also used by VS Code | ANSI/scrollback/resize/keyboard handling built in | Requires deliberate care around DOM mounting timing (a real issue found and fixed — see the Backend/Project Overview documents' Challenges sections) |
| **Why Context API (and only for auth)** | Authentication is the one truly application-wide piece of state | Zero extra dependency for the one case that actually needs global reach | Would not scale well as the *only* mechanism if more truly-global state emerged — which is exactly why every other concern uses a page-scoped hook instead, not Context |
| **Why custom hooks over a global store** | Nearly all "shared" state in this app is actually page-scoped, not application-global | No indirection from a state library solving a sharing problem the app doesn't have; each concern's logic is testable/reasoned-about in isolation | Cross-page state sharing (if ever needed) would require deliberate design, since hooks are typically instantiated fresh per page |
| **Why modular, prop-driven components** | Enables reuse and keeps data-source concerns out of rendering code | The same component works regardless of what hook/data source feeds it; easy to test in isolation | Slightly more prop-drilling in a few deeply nested cases, accepted in exchange for components that don't assume where their data comes from |
| **Why Socket.IO (frontend-specific reasoning)** | Three independent real-time domains, each needing rooms and reconnection handling, consumed from the same client | Rooms/namespaces/reconnection as built-in client primitives rather than hand-rolled per domain | Marginally heavier client than a raw WebSocket wrapper, in exchange for far less custom connection-management code across three domains |

---

## 19. Future Frontend Improvements

| Improvement | Addresses |
|---|---|
| **Theme customization** | Currently one fixed dark theme across the app; a light theme / user-selectable theming would broaden accessibility and preference support |
| **Deeper accessibility work** | A full audit of keyboard/screen-reader flows specifically through Monaco and xterm.js, both third-party components with their own accessibility surfaces to account for |
| **Offline support / Progressive Web App** | The app currently assumes a live connection for essentially everything (auth, collaboration, execution); a PWA shell with meaningful offline behavior (e.g. read-only viewing of a last-synced file) is unexplored |
| **Virtualized file explorer** | The File Explorer currently renders its full tree; a very large project's tree would benefit from list virtualization to keep rendering cost bounded |
| **Further performance work** | Addressing the large collaboration-related bundle chunk flagged by the build tool (§16), likely via more aggressive code-splitting |
| **Animation/motion polish** | Panel open/close and presence changes are currently instant/CSS-transition-only; deliberate motion design is unexplored |
| **A plugin architecture** | Currently, every editor feature (AI actions, execution) is a first-class, hard-wired part of the Editor page; a more extensible action/plugin registry would let new capabilities be added without editing the Editor page itself |
| **Mobile/responsive-down scope** | A deliberately simplified mobile experience (likely read-only or chat/AI-only, given the IDE metaphor's reliance on multiple simultaneous panels) rather than attempting to fit the full desktop layout down |

---

## 20. Conclusion

The Code Ground frontend holds together five simultaneously-live data sources — REST, and three independent Socket.IO connections — behind a strict, one-directional layering: pages compose components and hooks, hooks own cross-cutting logic and are the only consumers of services, and services are the only code that touches a network transport. That discipline is what makes it possible for a single page (the Editor) to host collaborative editing, AI assistance, and a live execution terminal at once without any one of them destabilizing the others — each is a self-contained hook with its own connection, its own state, and its own failure handling.

Two deliberate, non-default choices carry a disproportionate amount of the application's responsiveness: keeping high-frequency terminal output entirely out of React's render cycle, and using CRDT-based collaboration so the UI never has to reason about merge conflicts itself. Combined with lazy-loaded heavy dependencies (Monaco, Yjs, xterm.js) and a component layer that stays agnostic to *where* its data comes from, the result is a frontend that reads, to a new contributor, as a small number of consistently applied patterns repeated across many features — rather than one distinct, memorized special case per feature.

---

*This document should be revisited if state-sharing needs ever outgrow the current page-scoped-hooks approach (§6.3), or if any of the Future Frontend Improvements in §19 are implemented.*
