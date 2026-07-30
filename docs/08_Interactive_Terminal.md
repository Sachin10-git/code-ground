# Code Ground — Interactive Terminal Subsystem

> **Scope of this document:** This document explains the Interactive Terminal — the subsystem that turns code execution from a single buffered request/response into a live, typeable, real-time terminal session. It complements, and deliberately does not repeat, [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md), which is the authoritative reference for container creation mechanics, resource limits, the shared execution queue's general design, and the exit-status race condition this subsystem's container orchestration also had to solve. Where this document needs that context, it cross-references the Docker Execution Engine document by section rather than re-explaining it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminal Architecture](#2-terminal-architecture)
3. [Interactive Session Model](#3-interactive-session-model)
4. [Session Lifecycle](#4-session-lifecycle)
5. [Frontend Terminal Architecture](#5-frontend-terminal-architecture)
6. [Backend Terminal Architecture](#6-backend-terminal-architecture)
7. [Streaming Architecture](#7-streaming-architecture)
8. [stdin Handling](#8-stdin-handling)
9. [Socket Event Protocol](#9-socket-event-protocol)
10. [Ownership Validation](#10-ownership-validation)
11. [Multi-User Isolation](#11-multi-user-isolation)
12. [Browser Lifecycle](#12-browser-lifecycle)
13. [User Experience](#13-user-experience)
14. [Engineering Challenges](#14-engineering-challenges)
15. [Testing Strategy](#15-testing-strategy)
16. [Performance](#16-performance)
17. [Design Decisions](#17-design-decisions)
18. [Future Improvements](#18-future-improvements)
19. [Conclusion](#19-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the Interactive Terminal

The Interactive Terminal is what lets a program running inside Code Ground's execution engine **talk back and forth with the user while it runs** — reading input the user hasn't typed yet at the moment execution started, and showing output the instant it's produced, exactly like a real terminal on a real machine. It sits directly on top of the Docker Execution Engine (docs/07) but solves a problem that engine's original, one-shot design could not: interactivity.

### 1.2 One-Shot Execution vs. Interactive Execution

| | One-shot (REST) execution — docs/07 | Interactive execution — this document |
|---|---|---|
| **Shape** | Submit code, receive one final result | Start a session, exchange data with it live, for as long as it runs |
| **stdin** | None — the container has no open input stream | Open, and forwarded from the user's actual keystrokes |
| **Output delivery** | Buffered, returned once, at the end | Streamed, chunk by chunk, as it's produced |
| **Transport** | A single HTTP request/response | A persistent Socket.IO connection, for the session's whole lifetime |
| **What it's for** | Code with no interactive input requirement | Any program that reads from stdin, or where a user wants to watch output arrive live and be able to stop it mid-run |

### 1.3 Why a Terminal Was Necessary

A huge share of real programs — anything using Python's `input()`, Java's `Scanner`, C++'s `cin`, Go's `fmt.Scan`, or Node's `readline` — simply do not work under a request/response model at all: the program blocks waiting for input that was never going to arrive, and the one-shot engine's timeout (docs/07 §11.3) is the only thing that would ever end it. Without an interactive terminal, an entire, extremely common category of code was effectively unsupported.

### 1.4 Design Goals

| Goal | What it means concretely |
|---|---|
| **Real-time interaction** | A keystroke typed by the user reaches the running program's stdin with no perceptible delay, and the program's output appears in the terminal the instant it's produced |
| **Language independence** | The same mechanism supports `input()`, `Scanner`, `cin`, `fmt.Scan`, and `readline` uniformly, with zero per-language special-casing (§8) |
| **Low latency** | Both directions of I/O flow directly over an open socket connection — no polling, no buffering-and-flushing on a timer |
| **Reliability** | A session's container is guaranteed to be cleaned up under every way it can end — completion, explicit stop, timeout, or the client disconnecting (§12) |
| **Multi-user safety** | Two users' sessions can run concurrently with zero shared state and zero ability for one to affect the other (§10, §11) |

---

## 2. Terminal Architecture

```
                              ┌───────────────┐
                              │    Browser        │
                              └───────┬───────┘
                                      ▼
                         ┌─────────────────────────┐
                         │        xterm.js               │
                         │  renders output, captures         │
                         │  every keystroke                     │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │      Terminal Hook             │
                         │  (useTerminalSession)              │
                         │  owns the session's state and        │
                         │  the socket connection                  │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │        Socket.IO               │
                         │  (client transport)                │
                         └───────────┬─────────────┘
                                      │  WebSocket
                                      ▼
                         ┌─────────────────────────┐
                         │     Terminal Namespace         │
                         │        (`/terminal`)                │
                         │  its own handshake auth,             │
                         │  its own event handlers                │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │     Execution Session          │
                         │  (executionSession.service.js)     │
                         │  one session = one socket +           │
                         │  one container, for the                │
                         │  session's entire lifetime                │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │     Docker Container            │
                         │  TTY-enabled, open stdin            │
                         │  (see docs/07 for container            │
                         │   creation mechanics, resource            │
                         │   limits, and the exit-status               │
                         │   race fix this reuses — §14.3)             │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   stdin / stdout / stderr        │
                         │  one combined, bidirectional          │
                         │  stream (a single TTY merges             │
                         │  stdout+stderr — §7)                        │
                         └─────────────────────────┘
```

Every layer in this diagram exists **specifically because of interactivity** — the batch execution path (docs/07) needs none of them: no xterm.js, no dedicated namespace, no long-lived session object, no open stdin.

---

## 3. Interactive Session Model

### 3.1 Why Execution Became Session-Based

A request/response model has exactly one moment where the client can supply input: the initial request. A program that calls `input()` partway through its execution needs input *after* that moment, based on output it has already produced — which a single request/response exchange structurally cannot express. The only model that fits is a **session**: a standing, addressable, long-lived unit that both sides (client and container) can send data to and receive data from for as long as it exists.

### 3.2 What a Session Is

A session is a single in-memory record binding together, for its entire lifetime:

| Element | Role |
|---|---|
| **Session ID** | A randomly generated identifier, the one handle both sides use to refer to this specific session in every subsequent event |
| **Socket ownership** | The exact Socket.IO connection that created the session — the sole basis for every later authorization check (§10) |
| **Language** | Resolved once, at creation, and never re-validated mid-session |
| **Workspace** | A dedicated temporary directory for this session alone (created and destroyed exactly as docs/07 §5 describes for one-shot execution) |
| **Container** | One TTY-enabled Docker container, created once, for this session's whole lifetime |
| **Lifecycle state** | `starting` → `running` → `exited`, plus a `stopReason` (`stopped`, `timeout`, `output-limit`, or `disconnect`) recorded once, by whichever cause reaches it first |
| **Status/output plumbing** | The live attach stream, forwarded to the owning socket as it produces data |

### 3.3 Why This Model Is Superior to Request-Response for Interactive Programs

- **It has a *duration*, not just a *moment*.** A request/response pair has no concept of "still going" between the request and the response; a session's entire reason for existing is to represent exactly that in-progress state.
- **It has an *identity* other actions can reference.** Sending input, resizing the terminal, or stopping execution are all *later* actions, referring back to something already in progress — impossible to express against a request/response pair that has already completed.
- **It has an owner.** Because a session is a standing object, it can be bound to the connection that created it once, at creation time, and checked against that binding on every subsequent action (§10) — a property a stateless request/response model has no natural place to hang authorization off of at all.

---

## 4. Session Lifecycle

### 4.1 Stages

```
 1. Session creation
      client emits terminal:start; a session ID is generated and
      returned to the caller synchronously — the actual Docker work
      happens asynchronously from this point on
                    │
                    ▼
 2. Queue acquisition
      the session's ENTIRE lifetime (not just its startup) is
      submitted as one unit of work to the shared execution queue
      (docs/07 §7) — held until the session fully ends
                    │
                    ▼
 3. Container creation
      a TTY-enabled, open-stdin container is created for this
      session's workspace (container mechanics: docs/07 §6)
                    │
                    ▼
 4. Terminal ready
      once the container has started, terminal:ready is emitted —
      this is the signal the frontend uses to mark the session live
      and start accepting keyboard input
                    │
                    ▼
 5. Streaming begins
      every chunk the container's attach stream produces is
      forwarded immediately as terminal:output (§7)
                    │
                    ▼
 6. User input
      keystrokes typed into xterm.js are forwarded as terminal:input
      and written directly into the container's stdin (§8)
                    │
                    ▼
 7. Program execution
      the program runs, reads input, produces output, exactly as it
      would attached to a real terminal
                    │
                    ▼
 8. Completion / Cancellation
      the process exits naturally, OR an explicit stop is received,
      OR the session's timeout elapses — all three converge on the
      same underlying action (kill the container)
                    │
                    ▼
 9. Cleanup
      container removal, workspace deletion, metrics recording, and
      queue-slot release — all guaranteed regardless of which of the
      three endings above occurred
                    │
                    ▼
 10. terminal:exit
      the final event, reporting exit code and the specific reason
      the session ended
```

### 4.2 Sequence Diagram

```
 xterm.js (Browser)        useTerminalSession        /terminal namespace       ExecutionSession        Container
        │                          │                          │                       │                    │
        │  click Run                  │                          │                       │                    │
        │ ───────────────────────▶  │                          │                       │                    │
        │                          │  (connect socket if           │                       │                    │
        │                          │   not already connected)         │                       │                    │
        │                          │  terminal:start                    │                       │                    │
        │                          │ ───────────────────────▶  │                       │                    │
        │                          │                          │  createSession()          │                    │
        │                          │                          │ ───────────────────▶  │                    │
        │                          │                          │  (sessionId returned         │                    │
        │                          │                          │   synchronously — Docker        │                    │
        │                          │                          │   work continues async)           │                    │
        │                          │                          │                       │  acquire queue slot    │
        │                          │                          │                       │  create + start           │
        │                          │                          │                       │  container                  │
        │                          │                          │                       │ ─────────────────▶ │
        │                          │  terminal:ready              │                       │                    │
        │                          │ ◀───────────────────────  │ ◀─────────────────── │                    │
        │  (editor becomes an          │                          │                       │                    │
        │   active terminal)              │                          │                       │                    │
        │                          │                          │                       │  stdout/stderr chunk    │
        │  terminal:output              │                          │                       │ ◀───────────────── │
        │ ◀───────────────────────  │ ◀───────────────────────  │ ◀─────────────────── │                    │
        │  written into xterm.js         │                          │                       │                    │
        │                          │                          │                       │                    │
        │  user types + Enter            │                          │                       │                    │
        │  terminal:input                │                          │                       │                    │
        │ ───────────────────────▶  │ ───────────────────────▶  │  ownership check ──▶     │                    │
        │                          │                          │  writeInput()                │ ─────────────────▶ │
        │                          │                          │                       │                    │  (program reads it)
        │  more output                   │                          │                       │                    │
        │ ◀───────────────────────  │ ◀───────────────────────  │ ◀─────────────────── │ ◀───────────────── │
        │                          │                          │                       │                    │
        │  (program exits, or Stop        │                          │                       │                    │
        │   clicked, or timeout)              │                          │                       │                    │
        │  terminal:exit                 │                          │                       │  cleanup: remove        │
        │ ◀───────────────────────  │ ◀───────────────────────  │ ◀─────────────────── │  container, workspace,   │
        │  Run button reverts             │                          │                       │  release queue slot        │
```

---

## 5. Frontend Terminal Architecture

### 5.1 xterm.js

The terminal emulator itself — renders ANSI-colored output, maintains scrollback, and captures every keystroke (including control sequences) as raw input data. It is mounted **once**, for the lifetime of the Editor page, not recreated per execution.

### 5.2 React Integration — the Terminal Component

The Terminal component bridges React's declarative model to xterm.js's imperative instance API: it creates and owns the xterm.js instance directly (via a ref to a DOM container), and exposes `run()`/`stop()` imperatively via a `ref` handle rather than rendering its own Run/Stop buttons — the Navbar remains the single, unambiguous place those actions are triggered from (see the Frontend Architecture document §10.5).

### 5.3 The Terminal Hook (`useTerminalSession`)

Owns everything about the session's *state* and *transport*, independent of rendering: connecting (or reusing) the `/terminal` socket, tracking whether a session is currently running, and exposing `run`/`stop`/`sendInput`/`resize` actions. Output is **not** routed through this hook's React state — it is delivered via a plain callback the Terminal component uses to write directly into xterm.js (§7.4 explains why).

### 5.4 The Socket Service

A thin wrapper (`services/terminalSocket.js`) that is the *only* code touching `socket.io-client` for this namespace — opening the connection with the stored JWT attached, and exposing small, typed emit helpers for each event in §9. It deliberately disables Socket.IO's automatic reconnection (see §12.4).

### 5.5 Run Button / Stop Button

A single button in the Navbar, driving the Terminal component's imperative `run()`/`stop()` handle, and relabeling itself based on the `running` boolean the Terminal component reports upward — never two separate, independently-stateful controls.

### 5.6 Clear Terminal

A small icon button in the terminal panel's header that clears xterm.js's own buffer directly (`term.clear()`) — a purely local, client-side action with no backend interaction at all.

### 5.7 Resize

The terminal is kept fitted to its container via a resize observer (using xterm.js's fit addon); every resize is also propagated to the backend (`terminal:resize`) so the container's own TTY dimensions stay correct — relevant to any program that behaves differently based on terminal width/height (e.g. wrapping long lines, or a full-screen interactive CLI tool).

### 5.8 Scrollback

xterm.js is configured with a generous scrollback buffer, so output from earlier in a long-running session remains reviewable by scrolling up, without the frontend needing to manage that history itself.

### 5.9 Connection Status

The hook tracks `connecting`/`running`/`error` states and reports them upward for the header's status dot and badge (Frontend Architecture document §5.1's component categorization) — the user always has a visible, current answer to "is anything actually happening right now."

---

## 6. Backend Terminal Architecture

### 6.1 The Terminal Namespace

A dedicated Socket.IO namespace (`/terminal`), isolated from both the default namespace (editor collaboration) and `/workspace` (files, presence, chat) — its own connection, its own handshake authentication, its own disconnect handling. See the Backend Architecture document §10 for why namespace isolation is used throughout the backend generally; here specifically, it means a terminal session's cleanup logic only ever has to reason about terminal sessions, never about collaboration rooms or workspace state.

### 6.2 `executionSession.service.js`

The service that owns everything about a session's actual existence: creating it, forwarding input into it, resizing its TTY, stopping it, and cleaning up every session owned by a disconnecting socket. It is a **new, self-contained module**, not built on top of the one-shot Docker Runner (docs/07 §6) — a session's container needs a fundamentally different shape (a real TTY, open stdin, no single final buffered result), so it has its own container-orchestration code, while still reusing the *language configuration*, *temporary workspace management*, *execution queue*, and *metrics* modules completely unchanged (docs/07 §3, §5, §7, §8).

### 6.3 Socket Handlers

The namespace's connection handler is thin: each incoming event (`terminal:start`/`input`/`resize`/`stop`) is routed to a matching call into `executionSession.service.js`, with an ownership check (§10) gating every one of them except the initial `start`. The handler itself contains no session logic of its own — it is a routing layer, consistent with the platform's general controller-stays-thin discipline (Backend Architecture document §8).

### 6.4 Container Streams

A session's container is attached with a single hijacked, bidirectional stream (stdin + combined stdout/stderr over one TTY) — every `data` event on that stream is forwarded to the owning socket as `terminal:output`; every `terminal:input` event received is written directly into that same stream.

### 6.5 Cleanup

Cleanup is triggered from three independent places — natural process exit, an explicit stop, or the namespace's disconnect handler — and always converges on the same underlying sequence: kill the container (if not already exited), record metrics, remove the temporary workspace, and release the execution queue slot. This convergence is deliberate: there is exactly one cleanup implementation, reached from every ending, rather than three separate ones that could drift out of sync with each other.

### 6.6 Ownership Validation

Covered in full in §10 — implemented as a single, small check (`isOwnedBy`) consulted by the namespace's socket handlers before honoring any input/resize/stop event.

### 6.7 Separation of Responsibilities

```
 terminalSocket.js (namespace)     →  transport + routing + ownership gate
 executionSession.service.js       →  session state, Docker orchestration, cleanup
 languageRunner / tempWorkspace /
 executionQueue / executionMetrics →  shared infrastructure, reused unchanged (docs/07)
```

---

## 7. Streaming Architecture

### 7.1 stdout and stderr — One Combined Stream

Unlike the one-shot execution engine (which demultiplexes a container's stdout and stderr into two separate buffers — docs/07 §6.1), an interactive session's container is allocated a **single pseudo-TTY**, which inherently combines stdout and stderr into one stream — exactly how a real terminal works, where a user never sees "which stream" a line of output came from, only its position in the combined output.

### 7.2 Chunk Forwarding

Every `data` event the container's attach stream emits is forwarded to the client **immediately**, as its own `terminal:output` event — there is no buffering, no batching, and no waiting for a natural boundary (like a newline) before forwarding.

### 7.3 Why Output Is Streamed Instead of Buffered

Buffering until completion (the one-shot model) is fundamentally incompatible with interactivity: a program waiting on `input()` after printing a prompt would never have that prompt shown to the user at all under a buffer-until-done model, since "done" never arrives until the input it's waiting for is provided — a deadlock the one-shot model has no way out of. Streaming is not an optimization here; it is the property that makes interactive programs possible at all.

### 7.4 Bypassing React State — Latency and Ordering

On the frontend, output chunks are written directly into the xterm.js instance via a plain callback — deliberately **not** routed through React state (Frontend Architecture document §16). A chatty program can produce many small chunks per second; funneling each one through `setState` would introduce unnecessary re-renders and visible input lag. Because chunks are applied to xterm.js in the exact order they're received over the socket (a single ordered connection, not multiple parallel channels), output ordering is preserved automatically — there is no reordering risk to guard against on the client side.

### 7.5 Streaming Diagram

```
 Container attach stream        executionSession.service.js         Socket (per session)         xterm.js
        │                                │                                  │                        │
        │  data chunk 1                     │                                  │                        │
        │ ─────────────────────────────▶ │                                  │                        │
        │                                │  terminal:output (chunk 1)             │                        │
        │                                │ ───────────────────────────────▶ │                        │
        │                                │                                  │  term.write(chunk 1)       │
        │                                │                                  │ ─────────────────────▶ │
        │  data chunk 2                     │                                  │                        │
        │ ─────────────────────────────▶ │                                  │                        │
        │                                │  terminal:output (chunk 2)             │                        │
        │                                │ ───────────────────────────────▶ │                        │
        │                                │                                  │  term.write(chunk 2)       │
        │                                │                                  │ ─────────────────────▶ │
```

Each chunk is forwarded and rendered as its own discrete event — no accumulation step anywhere in this path.

---

## 8. stdin Handling

### 8.1 Keyboard Input Capture

xterm.js exposes every keystroke typed into it — including control sequences (arrow keys, Ctrl+C, etc.), which it already encodes correctly as raw terminal input bytes — through a single data callback.

### 8.2 Socket Transmission

That raw input data is forwarded, verbatim, as a `terminal:input` event, carrying the owning session's ID and the exact bytes typed — no interpretation, filtering, or "is this an answer to a prompt" logic happens on the frontend.

### 8.3 Container stdin

On arrival, the backend writes that data directly into the session's container attach stream (the same stream carrying output, since it's a single hijacked, bidirectional connection) — from the container's perspective, this is indistinguishable from a real user typing at a real terminal attached to it.

### 8.4 Why No Language-Specific Implementation Is Required

```
 Python  input()      ┐
 Java    Scanner       │
 C++     cin           ├──▶  all just read from the process's own stdin file descriptor
 Go      fmt.Scan      │      — which is exactly what this mechanism provides, uniformly
 Node    readline      ┘
```

Every one of these is a language's own standard mechanism for reading from stdin — none of them are aware of, or care about, what's on the other end of that stream. Because the execution engine forwards raw bytes into a real, OS-level stdin the process reads from, **every language's own native input mechanism works automatically**, with zero per-language code in the terminal subsystem itself. This is a direct, deliberate consequence of choosing a real TTY + open stdin as the container shape (§3.1) rather than attempting to special-case "detect an input prompt" for each language — an approach that would be fragile, incomplete, and require constant per-language maintenance.

---

## 9. Socket Event Protocol

| Event | Direction | Payload | Typical lifecycle position |
|---|---|---|---|
| `terminal:start` | Client → Server | `{ language, code, projectId? }` | Sent once, when Run is clicked |
| `terminal:ready` | Server → Client | `{ sessionId, language }` | After the container has started successfully — the frontend's signal to treat the terminal as live |
| `terminal:output` | Server → Client | `{ sessionId, data }` | Any number of times, for the session's entire running duration |
| `terminal:input` | Client → Server | `{ sessionId, data }` | Any number of times, whenever the user types |
| `terminal:resize` | Client → Server | `{ sessionId, cols, rows }` | Whenever the terminal panel's size changes |
| `terminal:stop` | Client → Server | `{ sessionId }` | At most once, when the user clicks Stop |
| `terminal:exit` | Server → Client | `{ sessionId, exitCode, reason, truncated }` | Exactly once, ending the session |
| `terminal:error` | Server → Client | `{ sessionId, message }` | On a validation failure (e.g. unsupported language) or an infrastructure failure |

### 9.1 Event Flow Diagram

```
 terminal:start ──▶ [queue + container startup] ──▶ terminal:ready
                                                          │
                          ┌───────────────────────────────┼────────────────────┐
                          ▼                               ▼                    ▼
                 terminal:output (×N)           terminal:input (×N)   terminal:resize (×N)
                          │                               │                    │
                          └───────────────┬───────────────┴────────────────────┘
                                          ▼
                     (natural exit) or terminal:stop or (timeout elapses)
                                          │
                                          ▼
                                  terminal:exit
```

`terminal:error` can occur instead of `terminal:ready` (a request that never becomes a valid session) or alongside `terminal:exit` (an infrastructure failure mid-session) — it is the one event not tied to a single fixed position in the lifecycle.

---

## 10. Ownership Validation

### 10.1 What Ownership Means Here

A session is recorded, at creation, against the **exact Socket.IO connection** that created it — not a user ID, not a project ID, but the literal connection object. Every subsequent `terminal:input`, `terminal:resize`, and `terminal:stop` event is checked against that recorded connection before being honored (§6.3).

### 10.2 Why the Connection, Not Just the User

A session ID is, by necessity, sent over the wire to the client that owns it — and in principle could be observed, guessed, or replayed by another connection. Checking against the *user* alone would still allow one of that same user's *other* connections (a second tab, for instance) to interfere with a session it didn't create. Checking against the exact connection is the tightest possible scope: only the literal socket that started a session can ever act on it.

### 10.3 Unauthorized Actions

An event referencing a session ID the sending socket does not own is simply dropped — no error is returned to the sender, and no action is taken against the session. This is a deliberate "fail silently, fail closed" choice: there is no useful information to give an unauthorized sender, and no reason to acknowledge that a given session ID even exists to them.

### 10.4 Security Implications

Ownership validation is the one property that makes it safe for session IDs to exist on the wire at all — without it, any connection that learned another session's ID (through a bug, a leaked log, or simple guessing given a predictable ID scheme) could inject input into, resize, or kill a completely different user's running program. With it, knowledge of a session ID alone confers no capability whatsoever.

---

## 11. Multi-User Isolation

### 11.1 Concurrent Users, Concurrent Sessions

Every session is independent, in-memory state, keyed by its own session ID — there is no shared session state between two different users' sessions, and no limit on how many different users can each have an active session at the same time (beyond the shared queue's overall concurrency cap, below).

### 11.2 Queue Interaction

All sessions — regardless of which user owns them — draw from the **same** shared execution queue that also gates one-shot REST executions (docs/07 §7.3). This is deliberate: two users' sessions consume the identical host resource (a running Docker container), so they must compete fairly for the same bounded pool, not have some separate, un-capped allowance for interactive use.

### 11.3 Separate Containers, Independent Streams

Every session gets its own container and its own temporary workspace (§3.2) — there is no scenario in which two sessions' filesystems, processes, or I/O streams are shared, regardless of how many sessions are concurrently active or which users own them.

### 11.4 Room Isolation

Unlike the default and `/workspace` namespaces (which use Socket.IO rooms to broadcast to multiple members at once), `/terminal` has no concept of a shared room at all — a session's output is only ever sent to the one connection that owns it, never broadcast to any other socket, because a terminal session inherently has exactly one legitimate audience.

### 11.5 Security Considerations

The combination of per-connection ownership (§10) and zero shared session/container/stream state means the *only* way one user could observe or affect another user's session is a bug in the ownership check itself — there is no secondary path (a shared room, a shared container, a shared buffer) that could leak isolation even if a specific check were somehow bypassed.

---

## 12. Browser Lifecycle

| Event | What happens |
|---|---|
| **Open terminal** | The Terminal component mounts once with the Editor page; its xterm.js instance is created immediately (container element always present in the DOM — see §14.2's mounting bug), independent of whether the panel is currently expanded |
| **Refresh** | The entire page (and its socket connection) is torn down and recreated from scratch — any session that was running is lost from the frontend's perspective, and the backend's disconnect handler (below) cleans it up server-side |
| **Disconnect** (network drop, tab close) | The `/terminal` namespace's disconnect handler runs, stopping every session owned by that socket (§6.5) — no container is ever left running for a client that's no longer there |
| **Reconnect** | Because `/terminal` deliberately does not auto-reconnect (§12.4), there is no "resume" — a fresh connection means a fresh socket identity, and any previous session (already cleaned up by the disconnect handler) is simply gone; the user starts a new Run if they want one |
| **Stop execution** | An explicit `terminal:stop`, ownership-checked, kills the container immediately — the same cleanup path as any other ending |
| **Browser close** | Identical to a disconnect — the backend has no way to distinguish "the tab closed" from "the network dropped," and doesn't need to; both are handled by the same disconnect cleanup |
| **Backend restart** | Every session is lost along with the process (no in-memory session state persists across a restart); any container still running at that moment continues independently of the backend process, exactly as docs/07 §15 describes for the batch execution engine, until its own timeout eventually ends it |
| **Timeout** | The session's absolute maximum duration (independent of user activity) elapses; the container is killed and `terminal:exit` reports `reason: "timeout"` |

### 12.1 Why Cleanup Is Guaranteed Regardless of Cause

As in §6.5, every one of the endings above funnels through the exact same cleanup sequence — there is no "special case" cleanup path for a disconnect versus a timeout versus an explicit stop. This uniformity is what makes the cleanup guarantee something that can actually be tested exhaustively (§15) rather than needing to be separately verified for every possible way a session can end.

### 12.2 Why `/terminal` Does Not Auto-Reconnect

A reconnected Socket.IO connection has a **new** connection identity — and because session ownership is tied to the exact connection that created a session (§10.2), a transparently reconnected socket could no longer act on the session it thinks it still owns anyway. Rather than papering over this with a reconnect that couldn't actually resume anything, the frontend treats a `/terminal` disconnect as "this run is over," which matches exactly what happens server-side.

---

## 13. User Experience

| Feature | How it improves usability |
|---|---|
| **Interactive typing** | Keystrokes reach the running program with no perceptible delay — a `Scanner`/`input()` prompt behaves exactly as it would locally |
| **Immediate output** | Nothing is withheld until "the program is done" — output appears the moment it's produced (§7) |
| **ANSI colors** | Programs that colorize their own output (a common pattern for CLI tools) render correctly, since xterm.js interprets the same ANSI escape sequences a real terminal would |
| **Copy & paste** | Native browser copy/paste works against the terminal's rendered content and input field, without any custom clipboard handling in this subsystem |
| **Terminal resizing** | The panel is user-resizable, and the container's own TTY dimensions are kept in sync (§5.7), so line-wrapping stays correct |
| **Auto-scroll** | New output keeps the view scrolled to the latest line unless the user has manually scrolled up to review earlier output |
| **Execution status** | A status dot and badge (§5.9) always show connecting/running/succeeded/failed at a glance |
| **Loading indicators** | A spinner accompanies the running state, distinguishing "actively executing" from "idle, showing a past result" |
| **Stop workflow** | A single, always-in-the-same-place button (§5.5) that relabels itself rather than requiring the user to find a separate control once something is running |
| **Error messages** | Validation and infrastructure failures (`terminal:error`) are shown directly in the terminal panel's status area, distinct from the program's own output |

---

## 14. Engineering Challenges

### 14.1 Persistent Sessions vs. a Purely Ephemeral Model

**Challenge:** Docker's execution engine (docs/07) is built around ephemeral, single-use containers by design (docs/07 §6.6) — but a session needs to *persist* across multiple round trips of input/output, not exit after a single command. **Resolution:** the container itself is still single-use and ephemeral (created once per session, destroyed once the session ends) — what persists is the *session record* and its *open connection* to that one container, not the container's own reusability. The ephemeral-container guarantee from docs/07 is preserved unchanged; only the *duration* of a single container's life is longer and interactive rather than fixed and short.

### 14.2 The xterm.js Mounting Race — A Terminal-Specific Bug

**Problem:** Every backend test (session creation, streaming, stdin, stop, disconnect, timeout, concurrency) passed cleanly against a real Docker daemon — but the terminal, when actually opened in a browser, showed nothing at all, despite the backend session running and streaming correctly underneath it.

**Investigation:** The terminal panel starts collapsed by default; its container `<div>` was conditionally rendered only when the panel was open. The xterm.js instance, however, was created in a one-time mount effect that ran when the Terminal component first mounted — at which point the panel was still collapsed, so the container element didn't exist yet in the DOM. The mount effect checked for the element, found nothing, and silently gave up — xterm.js never actually initialized, even though every session mechanism above it worked perfectly.

**Root cause:** A mismatch between *when* a one-time setup effect runs (once, at mount) and *when* the DOM element it depends on actually exists (only once the panel is first opened, which could be arbitrarily later, or never, before a Run is attempted).

**Solution:** The container element is now always present in the DOM regardless of the panel's open/collapsed state; visibility is toggled with CSS (height/overflow) instead of conditional mounting — so the one-time xterm.js setup effect always finds its target element immediately, the very first time it runs.

**How it was found:** Not by any backend test — by driving the actual, running application in a real browser (registering a user, opening a file, clicking Run) and observing that the terminal area was empty despite the session clearly running (confirmed via the panel's own "running" status indicator). This is the concrete justification for §15's inclusion of real browser end-to-end testing as part of this subsystem's verification strategy, not an optional extra.

### 14.3 Streaming Synchronization and Race Conditions Inherited from the Execution Engine

The interactive session's container orchestration reuses the **identical** exit-status race-condition fix documented in full in docs/07 §14: `container.wait({ condition: "next-exit" })` registered *before* `container.start()`, because AutoRemove can reap a fast-exiting container faster than a wait registered afterward could ever catch up to it. This subsystem did not need to independently rediscover that race — it was applied proactively, on the basis of the investigation already completed for the batch execution path, the moment this session orchestrator's container lifecycle was built. See docs/07 §14 for the full investigation; it is not repeated here.

### 14.4 stdin Forwarding — Getting the Container Shape Right

**Challenge:** The batch execution engine's containers are created with no open stdin at all (`Tty: false`, no `OpenStdin`) — necessary changes were required to get a genuinely bidirectional, TTY-backed attach stream, not merely "also read stdout." **Resolution:** `Tty: true` plus `OpenStdin: true`/`StdinOnce: false` on container creation, and attaching with `hijack: true` to obtain a real duplex stream rather than a read-only one — the specific combination that makes writing into the attach stream actually reach the container's stdin.

### 14.5 Socket and Container Cleanup Ordering

**Challenge:** Three independent triggers (natural exit, explicit stop, disconnect) all need to result in the *same* cleanup, without any of them racing each other into a double-cleanup or a missed one. **Resolution:** `stopReason` is set at most once (first writer wins, via a null-coalescing assignment) regardless of which trigger reaches it first, and the actual teardown (container removal, workspace deletion, metrics, queue release) lives in exactly one `finally` block reached by every path — there is structurally only one place cleanup can happen, so ordering between triggers cannot produce inconsistent results (§4.1, §6.5).

### 14.6 Queue Ownership for Long-Lived Work

**Challenge:** The shared execution queue (docs/07 §7) was originally designed around short-lived, one-shot work — holding a slot for a session that might run for minutes required deliberate handling, not an incidental side effect. **Resolution:** a session's entire lifetime, from container creation through final cleanup, is submitted as a **single unit of queued work** — the queue slot is acquired once and released only in that same terminal `finally` block, so a long-running interactive session correctly occupies its slot for as long as it is genuinely alive (docs/07 §7.4).

### 14.7 Lessons Learned

| Lesson | Applies beyond this subsystem |
|---|---|
| A race condition fixed once, in one execution path, should be applied proactively to a second, related path — not rediscovered independently | Any place two implementations share an underlying dependency (here: the Docker Engine's AutoRemove behavior) |
| Backend correctness (verified by a thorough, real-Docker-backed test suite) does not guarantee frontend correctness | A UI element's mounting/rendering lifecycle needs its own verification, distinct from the data/session logic feeding it |
| Real, browser-driven end-to-end testing catches a category of bug that no amount of backend testing can | Justifies including E2E verification as a standing part of this subsystem's testing strategy, not a one-off debugging step |

---

## 15. Testing Strategy

### 15.1 Automated Coverage

| Suite | What it verifies |
|---|---|
| **Session tests** | Session creation returns a usable session ID; `terminal:ready` and `terminal:exit` fire with correct payloads; an unsupported language is rejected before any container is created |
| **Streaming tests** | Output is explicitly asserted to arrive incrementally — a check that at least one output event has arrived well before the full program would have finished, proving this isn't secretly buffered end-to-end |
| **stdin tests** | A real round trip: a program that calls `input()`, told to write a value via `terminal:input`, and asserting the program's subsequent output reflects that value — plus a companion test confirming input sent by a *non-owning* connection has no effect |
| **Cancellation tests** | Explicit stop of a running session; idempotent double-stop; and — a specifically important case — stopping a session that is still waiting in the queue, before any container has even been created yet, confirming no container is started at all in that case |
| **Timeout tests** | A deliberately short, overridden session timeout confirms a never-exiting program is killed and reported with `reason: "timeout"` well within a bounded test window |
| **Disconnect cleanup** | Simulating a socket disconnect confirms every session owned by that connection is stopped, and that a socket with no sessions at all is a harmless no-op |
| **Concurrent session tests** | Multiple sessions, across multiple simulated users/connections, running at the same time, explicitly asserted not to cross-talk (each session's output contains only its own program's output, never another's) |
| **Browser E2E (Playwright)** | The one verification layer that actually exercises the real, rendered frontend — registering a user, opening a real file, clicking Run, confirming live streaming output actually appears on screen, typing a real answer into the terminal for a real `input()` prompt and confirming the program continues correctly, and clicking Stop and confirming the exit code reflects a real kill (`137`, i.e. SIGKILL) |

### 15.2 The xterm.js Mounting Issue, Specifically

The bug described in §14.2 is the single clearest justification for including browser-driven E2E testing as a first-class part of this subsystem's test strategy: every one of the automated suites above passed completely, because they all verify the *session and streaming logic*, which was entirely correct — the defect was purely in *when a UI library initializes relative to a conditionally-rendered DOM element*, a category of bug that is, by construction, invisible to any test that doesn't render the actual component tree in an actual browser and look at what appears on screen.

### 15.3 Why This Combination

Automated, real-Docker-backed tests are the right tool for the session/streaming/cleanup logic's correctness (the same reasoning docs/07 §17.2 applies to the batch engine). Real browser E2E testing is the right tool for confirming that correctness is actually *visible and usable* to a real user — neither replaces the other, and this subsystem specifically needed both to reach genuine confidence.

---

## 16. Performance

| Concern | Approach |
|---|---|
| **Streaming efficiency** | Output is forwarded chunk-by-chunk with no intermediate buffering step — latency between a program producing output and a user seeing it is bounded only by network/socket overhead, not by any accumulation logic |
| **Memory usage** | Because output is streamed and never accumulated server-side (unlike the batch engine's buffered result), a long-running, chatty session's memory footprint on the backend stays flat regardless of total output volume — bounded additionally by the output-size cap (§3.2, matching the pattern in docs/07 §11.4, at a more generous threshold appropriate to longer interactive use) |
| **Session cleanup** | A single, uniformly-reached cleanup path (§14.5) with no cleanup-ordering overhead beyond one `finally` block |
| **Socket scalability** | Namespace isolation (§6.1) means terminal traffic never contends with collaboration or workspace-sync traffic on the same connection — a busy session cannot introduce latency into an unrelated real-time feature |
| **Queue interaction** | Sessions and one-shot executions share one concurrency budget (§11.2); a long-lived session occupying a slot for minutes is the expected, correctly-modeled cost of interactivity, not an oversight |
| **Latency** | Dominated by real network/container round-trip time for each direction of I/O — there is no artificial delay (polling interval, debounce, batching window) anywhere in this subsystem's own logic |
| **Future optimization opportunities** | See §18 — persistent/resumable sessions and terminal history are the most performance-relevant future directions, since today a dropped connection means a fully restarted session rather than a cheaper "reattach" |

---

## 17. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why xterm.js** | The de facto standard web terminal emulator, also used by VS Code's own integrated terminal | ANSI/scrollback/resize/keyboard handling built in, rather than hand-rolled | Requires deliberate care around DOM-mounting timing (§14.2) — a real cost that was paid once, and is now a documented, closed issue |
| **Why Socket.IO (for this subsystem specifically)** | A session needs a persistent, bidirectional connection for its whole lifetime — not a fit for request/response at all | Built-in connection lifecycle events (connect/disconnect) map directly onto session start/cleanup triggers | An abstraction layer over raw WebSockets, accepted for the same reasons given platform-wide (Backend Architecture document §19) |
| **Why execution sessions (a new abstraction, not reusing the one-shot runner)** | One-shot execution and interactive execution are different problems (§1.2) wearing the same "run code" label | Neither implementation carries the other's complexity; the well-tested batch path was never put at risk while building this one | Some concepts (language config, resource limits, the exit-status race fix) must be deliberately kept in sync across two call sites — mitigated by both pulling from the same shared modules (§6.2) |
| **Why streaming (not buffering, ever, for this path)** | Buffering is fundamentally incompatible with a program that pauses mid-execution waiting on stdin (§7.3) | The only model that makes interactive programs possible at all | None accepted as a genuine trade — this isn't an optimization choice, it's a correctness requirement for the feature to exist |
| **Why ownership validation** | Session IDs necessarily travel over the wire and cannot be assumed secret | The tightest possible authorization scope (the exact connection, not just the user — §10.2), closing the one realistic vector for cross-user interference | A small amount of bookkeeping (recording and checking a socket identity) per session |
| **Why a dedicated `/terminal` namespace** | Terminal sessions' disconnect/cleanup semantics are entirely different from collaboration rooms' or workspace sync's | Each namespace's cleanup logic only ever reasons about its own domain — no risk of one domain's teardown misinterpreting another's state | One more physical connection per browser tab with an active terminal, accepted the same way it is for `/workspace` (Backend Architecture document §10.2) |
| **Why explicit session lifecycle management (a formal state + reasons, not just "is the container alive")** | Multiple distinct endings (completion, stop, timeout, output-limit, disconnect) all need to be distinguishable in the final result the user sees | `terminal:exit`'s `reason` field lets the UI (and metrics — docs/07 §8.1) tell these apart precisely, rather than collapsing them into one generic "it stopped" | A small amount of additional state (`stopReason`, set at most once) tracked per session |

---

## 18. Future Improvements

| Improvement | What it would add |
|---|---|
| **Session resume / reconnect** | Decoupling "the container is alive" from "a specific socket is currently attached to it" would let a client that briefly disconnects re-attach to a still-running session instead of it being unconditionally lost (§12.2's current, deliberate trade-off) |
| **Persistent terminals** | A terminal that survives navigating away from the Editor page entirely (not just a network blip), analogous to a real terminal multiplexer's detach/reattach model |
| **Multiple tabs / split terminals** | Today, one Editor page has exactly one terminal; supporting several concurrent sessions side-by-side in the same page would extend the existing per-session isolation model (§11) to a multi-session-per-user UI, rather than requiring new backend isolation work |
| **Terminal history (persisted across sessions)** | Currently, scrollback (§5.8) lives only in the current xterm.js instance's memory; persisting a session's output for later review would need a durable store, distinct from the live streaming path |
| **File uploads into a session's workspace** | Letting a running session read files beyond the single submitted source file — a natural extension of the temporary workspace model (docs/07 §5) rather than a new mechanism |
| **Clipboard synchronization beyond native browser copy/paste** | Explicit "copy last output block" or "copy command" affordances, beyond what native OS-level copy/paste from the rendered terminal already provides |
| **Terminal themes** | User-selectable xterm.js color schemes, alongside the broader theming work noted in the Frontend Architecture document §19 |
| **SSH-style external access** | Exposing a running session over a standard protocol (rather than only through the Code Ground browser UI) — a substantial extension with its own authentication and exposure considerations well beyond today's browser-only model |
| **Persistent (non-ephemeral) containers for specific workflows** | As in docs/07 §19, a more constrained, opt-in persistent-container mode could coexist with today's ephemeral-by-default sessions without weakening the isolation guarantee general-purpose execution relies on |

---

## 19. Conclusion

The Interactive Terminal is what turns the Docker Execution Engine (docs/07) from a code runner into an actual development environment: the same rigorously isolated, resource-limited, cleanly-cleaned-up containers that engine already provides are now addressable as a live, two-way conversation rather than a single buffered answer. Its architecture — a dedicated namespace, a purpose-built session abstraction with connection-level ownership, and output streamed the instant it's produced — exists entirely in service of one property the batch engine could never offer: a program can pause, ask the user something, and continue, exactly as it would on a real machine, for any of the platform's six supported languages, with zero per-language code required to make that true.

Its most instructive engineering moment was not a backend defect at all, but the mounting-timing bug described in §14.2 — a complete, correctly-functioning session and streaming pipeline, verified thoroughly by a real-Docker-backed automated suite, that nonetheless rendered nothing to a real user until it was actually opened in a real browser and looked at. That is the concrete argument, made once and now permanently learned, for why this subsystem's testing strategy treats browser-driven end-to-end verification as a required complement to automated backend tests, not an optional extra — and it is exactly the kind of gap that separates code which is merely *tested* from a system that has actually been *used*.

---

*This document should be revisited if any of the Future Improvements in §18 are implemented — in particular, session resume/reconnect would change the ownership model described in §10 and the disconnect-handling story in §12.*
