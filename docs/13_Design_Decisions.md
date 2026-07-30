# Code Ground — Design Decisions (Architecture Decision Records)

> **Scope of this document:** The major engineering and architectural decisions made while building Code Ground, recorded in Architecture Decision Record (ADR) format — the reasoning, the alternatives genuinely weighed, the trade-offs knowingly accepted, and what was actually learned. This document does not re-explain *how* any subsystem works (every companion document in this series already does that in depth); it explains *why* it was built that way instead of another way.
>
> Every decision below reflects a real choice made during this project's development, not a retrospective justification invented for this document. Where a decision changed during implementation, §4 records that honestly — including what was tried first and what was learned from it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Decision Record Format](#2-decision-record-format)
3. [Major Design Decisions](#3-major-design-decisions)
4. [Decisions Revisited During Development](#4-decisions-revisited-during-development)
5. [Trade-off Summary](#5-trade-off-summary)
6. [Lessons Learned](#6-lessons-learned)
7. [Future Re-evaluation](#7-future-re-evaluation)
8. [Conclusion](#8-conclusion)

---

## 1. Introduction

### 1.1 Purpose of Documenting Design Decisions

Every other document in this series explains a subsystem as it exists. This one exists to answer a different, equally important question: **why does it exist in this particular shape, and not one of the other shapes that were genuinely available?** Code, once written, tends to look inevitable in hindsight — this document is a deliberate record against that illusion, capturing the alternatives that were real options at the time, not just the one that was ultimately chosen.

### 1.2 Why Architectural Rationale Matters

A future contributor (including a future version of the person who built this) reading only the implementation will never know that Firecracker was considered and rejected for a specific reason, or that a shared execution queue was chosen over per-user queues because it solves a different problem more directly. Without that rationale recorded, a well-intentioned future change risks re-opening a question that was already carefully settled — or, just as costly, risks *not* reopening a decision that genuinely should be revisited now that circumstances have changed (§7).

### 1.3 How This Document Complements the Rest of the Series

| Document | Answers |
|---|---|
| Docs 00–12 | *What* was built, and *how* it works |
| **This document** | *Why* it was built that way, what else was considered, and what was learned by building it |

Read together, the series gives both the finished shape of the system and the reasoning trail that produced it.

---

## 2. Decision Record Format

Each decision in §3 follows the same structure:

| Field | Meaning |
|---|---|
| **Context** | The problem or requirement that forced a decision to be made |
| **Decision** | What was actually chosen |
| **Alternatives Considered** | Other real options, and specifically why each was not chosen |
| **Benefits** | What the chosen option provides that mattered |
| **Trade-offs** | What was knowingly given up |
| **Lessons Learned** | What building with this decision actually taught, where applicable |

---

## 3. Major Design Decisions

### ADR-001 — The MERN Stack (MongoDB, Express, React, Node)

**Context:** A collaborative cloud IDE needs a frontend, a backend capable of both REST and sustained real-time connections, and a data layer — all built by a small team (effectively one engineer) that benefits enormously from minimizing context-switching between languages and paradigms.

**Decision:** Node.js/Express for the backend, React for the frontend, MongoDB for persistence — one language (JavaScript) end-to-end.

**Alternatives Considered:**
- **Django (Python):** Mature, batteries-included, an excellent ORM — but real-time support (Django Channels) is a materially heavier addition on top of a request/response-first framework than Socket.IO is on top of Node, and it would have split the stack across two languages for no corresponding benefit to this project's actual needs.
- **Spring Boot (Java):** Enterprise-grade and well-suited to large teams and long-lived services, but carries more configuration ceremony and JVM startup overhead than this project's scope justified; its WebSocket story (STOMP over SockJS) is capable but noticeably more involved to wire up than Socket.IO.
- **ASP.NET (C#/.NET):** SignalR is genuinely a strong, comparable real-time story — the strongest alternative of the three considered — but still means a backend language split from a JavaScript frontend, and less natural alignment with the Node-native tooling (`dockerode`, `socket.io`) this project builds on directly.

**Benefits:** One language across the entire stack; Node's non-blocking I/O model is a strong fit for a backend that spends most of its time waiting on Docker, MongoDB, or the Gemini API rather than doing CPU-bound work itself; the largest and most immediately relevant ecosystem (Socket.IO, Mongoose, Express) for exactly the primitives this project needed.

**Trade-offs:** Node's single-threaded event loop means genuinely CPU-bound work must be pushed out-of-process — which the execution engine already does by design (docs/07), so this cost was paid deliberately, not incidentally.

---

### ADR-002 — MongoDB (Document Database)

**Context:** The application's core entities — a project's member list, a snapshot's embedded file tree, a chat message stream — are naturally variable-shaped and nested, not naturally tabular.

**Decision:** MongoDB, accessed via Mongoose, hosted on Atlas.

**Alternatives Considered:**
- **PostgreSQL:** A genuinely strong alternative — its JSONB columns could approximate document flexibility while retaining relational guarantees. Rejected specifically because this project's dominant access pattern (Database Design document §9) is project-scoped document retrieval, not multi-table joins, and modeling a project's member array or a snapshot's embedded tree relationally would have meant either normalizing them into join tables (adding query complexity this project's read patterns don't need) or leaning on JSONB anyway (giving up the relational guarantees that would have been Postgres's main advantage in the first place).
- **MySQL:** Similar reasoning to Postgres, with a comparatively weaker native JSON story at the time this decision was made.

**Benefits:** Schema flexibility matching the data's actual shape (Database Design document §12); a managed cluster (Atlas) removes database operations entirely from this project's engineering burden.

**Trade-offs:** Referential integrity (a `File.projectId` actually pointing at a real Project) is an application-level discipline, not a database-enforced constraint (Database Design document §8.2) — a real, accepted cost, not an oversight.

---

### ADR-003 — Socket.IO for Real-Time Communication

**Context:** Three genuinely different real-time domains — editor collaboration, workspace/presence/chat, and interactive terminal I/O — all need persistent, bidirectional, low-latency connections with room-like scoping.

**Decision:** Socket.IO, split across three independent namespaces (System Architecture document §14.2).

**Alternatives Considered:**
- **Native WebSockets:** Would have required hand-building room membership, reconnection/backoff logic, and namespace-equivalent isolation from scratch, for all three real-time domains independently — exactly the machinery Socket.IO already provides as a first-class primitive.
- **Server-Sent Events (SSE):** Immediately disqualifying for two of the three domains — SSE is one-directional (server → client only), and both the collaboration layer (client-originated CRDT updates, cursor moves) and the interactive terminal (client-originated keystrokes) fundamentally require the client to push data to the server, not just receive it.

**Benefits:** Rooms, namespaces, and reconnection handling as built-in primitives, directly matching this project's actual shape (System Architecture document §14.3); one consistent reconnection/backoff model across all three real-time domains instead of three hand-rolled ones.

**Trade-offs:** A thin abstraction layer over raw WebSockets, accepted for the machinery it removes the need to build three times over.

---

### ADR-004 — Yjs and CRDT-Based Collaboration

**Context:** Multiple users must be able to edit the same file simultaneously with correct, conflict-free merging, regardless of network timing.

**Decision:** Yjs, a mature CRDT implementation with an existing Monaco binding (Collaboration System document §5–§6).

**Alternatives Considered:**
- **Operational Transformation (OT):** The historically dominant approach (early Google Docs). Rejected because OT's correctness burden is per-operation-pair — every new kind of concurrent operation needs its own proven transform function — versus a CRDT's convergence guarantee holding by construction for any commutative operation, with no central sequencing authority required (Collaboration System document §5.7).
- **A custom synchronization protocol:** Rejected outright as unjustifiable engineering risk — correct concurrent text editing is a well-studied, genuinely hard distributed-systems problem, and building a bespoke solution would mean re-deriving guarantees mature libraries already provide, with a real risk of subtle, hard-to-detect merge bugs.

**Benefits:** Mathematically guaranteed convergence with no manual conflict resolution ever required (Collaboration System document §11.5); offline editing is supported *conceptually* by the same guarantee even though not yet exposed as a feature (Collaboration System document §5.6).

**Trade-offs:** Requires the team to reason in CRDT terms rather than a perhaps more intuitive OT model; some CRDT implementations (Yjs included) carry more per-character bookkeeping overhead than a leaner OT log would.

**Lessons Learned:** Choosing a CRDT did not eliminate every distributed-systems bug this subsystem could have — it eliminated *merge conflicts* specifically. The hydration race (§4, Collaboration System document §7.3) was a completely different, real bug in the boundary between the persisted and in-memory representations — a reminder that a strong guarantee in one place doesn't imply correctness everywhere adjacent to it.

---

### ADR-005 — Monaco Editor

**Context:** The editing experience needed to feel like a real IDE, not a glorified text area, across six languages.

**Decision:** Monaco, the editor engine that powers VS Code (Frontend Architecture document §9).

**Alternatives Considered:**
- **CodeMirror (v6):** A genuinely strong, modern, lighter-weight alternative with excellent extensibility. Not chosen because achieving VS-Code-equivalent language intelligence and familiarity would have required assembling more of that experience by hand, versus Monaco providing it natively — and the specific product goal was for the editor to feel immediately familiar to anyone who has used VS Code.
- **Ace Editor:** A well-established, older editor library. Passed over as visibly less state-of-the-art than either Monaco or CodeMirror by the time this decision was made, with a less active ecosystem around it.

**Benefits:** Professional-grade syntax highlighting, bracket matching, and per-language modes with effectively zero need to build an editor core from scratch; a "model per open file" concept that maps directly onto this project's multi-file editing requirement (Frontend Architecture document §9.1).

**Trade-offs:** A materially heavier client dependency than CodeMirror — mitigated by lazy-loading it rather than bundling it into the initial page load (Frontend Architecture document §16).

---

### ADR-006 — Docker-Based Code Execution

**Context:** Running arbitrary, untrusted, user-submitted code requires genuine isolation — a compromised or resource-abusive submission must never affect the host, another execution, or another user.

**Decision:** Direct Docker Engine API access via `dockerode` (Docker Execution Engine document §1.2).

**Alternatives Considered:**
- **Local (unsandboxed) execution:** Immediately disqualifying — running submitted code as a plain host process provides no isolation whatsoever and was never seriously on the table.
- **Full VM-per-execution:** Would provide the strongest possible isolation, but at a startup-latency and resource cost fundamentally incompatible with the interactive terminal's low-latency requirement (Interactive Terminal document §1.4) and with running many concurrent executions on modest infrastructure.
- **Firecracker (microVMs):** A genuinely compelling middle ground — the technology underlying AWS Lambda's own isolation model, offering VM-grade isolation at container-like speed. Not chosen because it requires a Linux/KVM host and materially more operational complexity to self-host correctly than Docker, for a project whose actual development happened on a mix of platforms (including Windows, where Docker Desktop is a first-class, well-supported path and Firecracker is not) and whose team size didn't justify that operational investment at this stage.
- **Sandboxed processes** (e.g. seccomp/chroot/gVisor without full containers): Lighter-weight than Docker in principle, but would require manually assembling filesystem isolation, resource limiting, and network restriction from lower-level primitives — exactly what Docker already provides as a coherent, well-tested API surface (`HostConfig`'s memory/CPU/PID/network fields, used directly — docs/07 §6).

**Benefits:** Real OS-level isolation with direct, low-level control over every resource limit and lifecycle event via the Docker Engine API — no third-party "run this code for me" black box involved (Docker Execution Engine document §1.2).

**Trade-offs:** An external daemon dependency the backend must actively health-check (docs/07 §9) and can fail independently of the API process itself.

---

### ADR-007 — A Single, Shared Execution Queue

**Context:** Docker containers consume real host memory, CPU, and process-table entries — unbounded concurrent executions could exhaust the host under load or abuse.

**Decision:** One shared, in-process concurrency semaphore, used identically by both one-shot REST executions and long-lived interactive sessions (Docker Execution Engine document §7.3).

**Alternatives Considered:**
- **Unlimited parallel execution:** Rejected outright — the entire point of this decision was closing exactly the resource-exhaustion risk this alternative leaves wide open.
- **Per-user queues:** A tempting fairness model (no single user can be starved by another's usage) — but it solves a *different* problem than the one that mattered most at this project's scale. A per-user cap does nothing to bound the *aggregate*, host-wide number of simultaneous containers if many users are each within their own individual limit at the same time; only a single, shared cap actually protects the host itself. Per-user fairness *within* a global cap remains a legitimate future refinement (§7), not something this decision rejected as a concept — only as a *replacement* for a global cap.

**Benefits:** Graceful degradation (a queue wait) instead of host-level failure under load; one mechanism, shared correctly by both execution modes, rather than two independently-implemented caps that could silently drift out of agreement with each other (Docker Execution Engine document §18).

**Trade-offs:** Added latency under contention — a request arriving when the cap is already reached waits rather than running immediately, an accepted cost against the alternative of no cap at all.

---

### ADR-008 — Session-Based Interactive Execution

**Context:** Programs using `input()`/`Scanner`/`cin`/`fmt.Scan`/`readline` need to receive input *after* execution has already begun, based on output the program itself hasn't produced until that point.

**Decision:** A persistent execution session — one container, one Socket.IO connection, for the session's entire lifetime (Interactive Terminal document §3).

**Alternatives Considered:**
- **Stateless (request/response) execution:** The engine's original, and still-existing, execution model (Docker Execution Engine document) — structurally incapable of supplying input the client hasn't sent yet at the moment a single request was made (Interactive Terminal document §1.3).
- **Polling:** Repeatedly asking "any new output, and is there an open input prompt?" on a timer. Rejected because it reintroduces latency proportional to the poll interval, wastes requests while a program is simply thinking, and still doesn't cleanly solve *sending* input mid-execution without inventing a separate, session-identified endpoint for it — at which point the design has quietly reinvented a session model, but with strictly worse latency characteristics and no natural server-to-client push mechanism.

**Benefits:** Real-time, bidirectional interaction indistinguishable from a local terminal, uniformly across all six supported languages with zero per-language special-casing (Interactive Terminal document §8.4).

**Trade-offs:** A materially more complex lifecycle to implement correctly (container TTY/stdin setup, connection-scoped ownership, streaming) than the batch model — deliberately kept as a second, separate implementation rather than complicating the already-proven batch path (docs/07 §18).

---

### ADR-009 — Gemini as the AI Provider

**Context:** The AI Assistant needed a capable, low-latency model reachable through a straightforward backend integration.

**Decision:** Google's Gemini, via the official `@google/genai` SDK, accessed through an internal provider abstraction (AI Assistant document §2, §6.6).

**Alternatives Considered:**
- **OpenAI:** A very strong, mature alternative with an equally capable SDK — a close call, not a clear-cut rejection. Gemini was chosen for this project's specific combination of a fast, cost-efficient model tier well-suited to an interactive, in-editor assistant, and straightforward SDK integration at the time this decision was made.
- **Anthropic (Claude):** Similarly a strong, seriously considered option for coding-specific quality — the provider abstraction built alongside this decision (rather than a hard-coded, scattered dependency on one vendor's API) exists specifically so a choice like this remains reversible rather than structural (AI Assistant document §12).
- **Self-hosted/local models:** Would remove third-party data-sharing considerations (AI Assistant document §9) and per-request cost entirely, but at this project's scope, operating model-serving infrastructure and accepting the quality/latency ceiling of currently-practical self-hostable models was judged a worse trade than using a hosted frontier-model API for a genuinely useful assistant.

**Benefits:** A mature API and SDK; a fast model tier appropriate to an interactive assistant rather than a slower, quality-maximizing one; the provider abstraction means this specific choice is not architecturally load-bearing.

**Trade-offs:** Ties current behavior and pricing to one vendor's models and terms — directly mitigated, not left as an unaddressed risk, by the provider factory pattern (AI Assistant document §2).

---

### ADR-010 — JWT-Based Authentication

**Context:** Identity needed to be verifiable uniformly across a REST API and three independent Socket.IO namespaces, without requiring a shared, stateful session store from day one.

**Decision:** JWT access tokens (stateless, short-lived) paired with database-tracked, revocable refresh tokens (Authentication document §5).

**Alternatives Considered:**
- **Server-side sessions:** Would require a shared session store the moment more than one backend instance exists, and awkward, repeated reconciliation across REST and three separate socket connections that don't naturally share server-side session state the way sequential HTTP requests to the same server might.
- **OAuth-only** (no local username/password at all): Would remove password storage/hashing entirely, but ties account creation to a third-party identity provider from day one — a real, deliberate future addition (Authentication document §15), not a replacement for local accounts as the starting point of a project needing simple, fast registration first.
- **Plain session cookies** (a cookie holding a session ID, without a JWT): Doesn't naturally extend to a Socket.IO handshake's `auth` payload the same uniform way a bearer token does, and carries the same stateful-lookup-per-request cost as server sessions without JWT's cross-transport uniformity benefit.

**Benefits:** No database round-trip to verify an access token; the identical token verifies REST calls and all three socket namespaces' handshakes uniformly (Authentication document §5.5).

**Trade-offs:** An access token cannot be individually revoked before its natural expiry — mitigated, not ignored, by keeping it short-lived and pairing it with a genuinely revocable, rotating refresh token (Authentication document §5.3–5.4).

---

### ADR-011 — A Modular, Layered Backend (Routes / Controllers / Services / Middleware)

**Context:** The same business logic (creating a file, running code, joining a collaboration room) is often reachable from more than one entry point — a REST controller and a Socket.IO handler both sometimes need to trigger identical behavior.

**Decision:** A strict layering where routes and controllers stay thin, and **all** business logic lives in services, reused identically by every entry point that needs it (Backend Architecture document §1.3, §9).

**Alternatives Considered:** A more conventional MVC-style split where controllers carry meaningful logic directly was the realistic alternative — rejected because it would have meant either duplicating logic between a REST controller and a Socket.IO handler needing the same behavior, or one of them awkwardly reaching into the other's controller (which depends on `req`/`res`, meaningless to a socket handler).

**Benefits:** Exactly one source of truth per capability; both entry points call the same service, so they can never silently drift apart in behavior (Backend Architecture document §1.3).

**Trade-offs:** An extra layer of indirection for very simple endpoints where a controller and its service would otherwise be nearly identical in length — accepted for the consistency guarantee across the codebase as a whole.

---

### ADR-012 — A Documentation-First Approach to This Project's Engineering Record

**Context:** A project of this technical depth — real distributed-systems bugs found and fixed, several genuinely load-bearing architectural decisions, a multi-phase build history — risks becoming illegible to anyone (including its own author, later) without a deliberate, written record of *why* it looks the way it does.

**Decision:** Produce this documentation series itself: a project overview, whole-system and per-subsystem architecture documents, an authentication deep dive, a collaboration deep dive, an AI deep dive, a Docker execution deep dive (the flagship document), an interactive terminal deep dive, an API reference, a database design document, a testing strategy document, a deployment guide, and this ADR record.

**Benefits:**
- **Onboarding:** a future contributor can build an accurate mental model without reverse-engineering intent from source alone.
- **Maintainability:** the reasoning behind a non-obvious choice (why REST execution and interactive sessions are two separate implementations, why hydration needed to become atomic) is preserved independent of whoever wrote the original code remembering it.
- **Interviews and recruiting:** this series is itself a demonstration of the ability to reason about, and clearly communicate, complex engineering trade-offs — arguably as significant a signal as the code itself.
- **Long-term project sustainability:** documentation this thorough is what allows a project to be picked back up confidently after time away, rather than requiring a full, slow re-familiarization with the codebase from scratch.

**Trade-offs:** A real, non-trivial time investment that could otherwise have gone toward new features — judged worthwhile specifically because this project's value, as both a working system and a portfolio artifact, depends on its reasoning being legible, not just its code being functional.

---

## 4. Decisions Revisited During Development

Not every decision was correct on the first attempt. These are the ones that materially changed shape during implementation, told honestly — what was tried first, what broke, and what replaced it.

### 4.1 CRDT Room Hydration

- **Original approach:** A room's document was considered active the instant an in-memory `Y.Doc` object existed for it, with load/recover/seed handled as a looser sequence in the socket event handler itself.
- **Problem discovered:** A REST save landing in the gap between "object exists" and "content actually loaded" could flush an empty, not-yet-loaded document over a file's real, previously-saved content (Collaboration System document §7.3).
- **Final approach:** An atomic hydration pipeline with its own explicit "trustworthy" flag, a cached in-flight promise for concurrent joins, and eviction of failed attempts so a retry is always possible (Collaboration System document §7.4–7.5).
- **Lesson learned:** "An object exists" and "that object's state is trustworthy" are different claims — conflating them is a specific, recurring category of bug, not a one-off mistake (a very similar shape reappears in §4.3 below).

### 4.2 The Docker Container Exit-Status Sequencing

- **Original approach:** Retrieve a container's exit status and a memory sample *after* `container.start()` had already resolved.
- **Problem discovered:** For fast-exiting containers, Docker's own `AutoRemove` could reap the container before the code asking about it ever got there — surfacing as a 404 that correlated specifically with how fast a submission exited (Docker Execution Engine document §14.1).
- **Final approach:** Register the exit-status wait *before* starting the container, using the correct wait condition, then separately wait for the output stream's own close signal (bounded by a short grace period) before reading final output.
- **Lesson learned:** When an event might happen arbitrarily fast, the only race-free approach is to register interest in it *before* the action that could trigger it — asking about it afterward is a structural race, not a timing tuning problem.

### 4.3 The Health Endpoint

- **Original approach:** A bare `GET /health` reporting only process uptime and environment — enough to know the API process itself was running.
- **Problem discovered:** "The API process answers HTTP" and "code execution actually works" are different facts a shallow check conflates — a backend could report healthy while its one core capability was completely non-functional.
- **Final approach:** A deep health check reporting Docker reachability, per-image availability, execution queue depth, and metrics — plus a corresponding fail-fast startup check that refuses to boot at all if Docker is entirely unreachable (Docker Execution Engine document §9).
- **Lesson learned:** A health check's value is entirely a function of *what* it actually verifies — a check that can only ever say "the process is alive" is close to useless for a system whose real value depends on an external dependency it doesn't inspect.

### 4.4 The Interactive Terminal's Frontend Mounting Strategy

- **Original approach:** The terminal's xterm.js instance was created once, in a mount effect, targeting a container `<div>` that was only rendered in the DOM while the terminal panel was expanded.
- **Problem discovered:** The panel starts collapsed by default — so the mount effect ran before its target element existed, silently failed to find it, and xterm.js never actually initialized, despite the entire session/streaming backend working correctly underneath it (Interactive Terminal document §14.2).
- **Final approach:** The container element is always present in the DOM; visibility is toggled with CSS instead of conditional mounting.
- **Lesson learned:** This was found only by actually opening the running application in a real browser — no automated backend test, however thorough, could have caught a defect in *when* a UI library initializes relative to conditional rendering (Testing document §11.4).

### 4.5 Testing Against a Reachable vs. Unreachable Docker Daemon

- **Original approach:** Early in development, automated execution tests were run in an environment where Docker was simply unreachable, producing a uniform, expected-looking failure across every test.
- **Problem discovered:** That uniform failure pattern was masking the completely different, real race condition described in §4.2 — it was invisible until the exact same suite was run against a Docker daemon that actually worked.
- **Final approach:** Testing philosophy shifted explicitly to insist on a real, reachable Docker daemon specifically for this subsystem's tests, precisely because "unreachable" and "reachable but racing" produce very different failure signatures that matter to distinguish (Testing document §1.2).
- **Lesson learned:** A passing (or uniformly failing) test suite is only as informative as the conditions it actually ran under — a test environment that differs from production in the wrong dimension can hide exactly the bug you're relying on tests to catch.

### 4.6 Execution Queue Ownership for Long-Lived Interactive Sessions

- **Original consideration:** Whether an interactive session should only hold its queue slot briefly, at startup, the same way a one-shot execution's queue involvement is naturally short-lived.
- **Problem identified (by design reasoning, before it shipped incorrectly):** A session that only "borrows" a slot at startup would let a long-running interactive session silently bypass the concurrency cap for the remainder of its life — defeating the queue's entire purpose for exactly the execution mode most likely to run for minutes.
- **Final approach:** A session's *entire* lifetime is submitted as a single unit of queued work, with the slot released only once the session fully ends (Docker Execution Engine document §7.4).
- **Lesson learned:** Reusing a shared mechanism correctly sometimes requires reasoning through a subtly different usage pattern *before* implementing it, not only after a bug surfaces — this is recorded here specifically because it's a case where the right answer was reached through design review rather than a failure, and that distinction matters (Testing document §11.5).

---

## 5. Trade-off Summary

| Decision | Benefit | Trade-off | Future Consideration |
|---|---|---|---|
| MERN stack (ADR-001) | One language end-to-end; strong async I/O fit | CPU-bound work must be pushed out-of-process | Revisit only if a genuinely CPU-bound backend workload emerges |
| MongoDB (ADR-002) | Flexible, document-shaped modeling | No database-enforced referential integrity | Acceptable indefinitely at current relationship complexity (§7) |
| Socket.IO (ADR-003) | Rooms/namespaces/reconnection built in | Abstraction overhead vs. raw WebSockets | Revisit only if per-connection overhead becomes measurably limiting |
| Yjs/CRDT (ADR-004) | Provable convergence, no manual merges | Per-character bookkeeping overhead; team must reason in CRDT terms | Stable — the underlying guarantee doesn't degrade with scale |
| Monaco (ADR-005) | VS-Code-grade editing experience | Heavy client dependency (mitigated by lazy loading) | Stable |
| Docker execution (ADR-006) | Real OS-level isolation, full API control | External daemon dependency to health-check | Revisit if execution needs to span multiple hosts (§7) |
| Shared execution queue (ADR-007) | Host-wide resource protection | Latency under contention; no per-user fairness sub-model yet | Add per-user fairness within the global cap if usage patterns demand it |
| Session-based execution (ADR-008) | Real interactivity, uniform across languages | More complex lifecycle than the batch model | Stable — the two-model split already isolates this complexity |
| Gemini (ADR-009) | Fast, capable, cost-appropriate model | Single-vendor dependency (mitigated by the provider abstraction) | Revisit if cost, quality, or policy needs change (§7) |
| JWT auth (ADR-010) | Stateless, uniform across REST + 3 socket namespaces | Access tokens not individually revocable before expiry | Stable — refresh-token revocation already covers the practical need |
| Layered backend (ADR-011) | One source of truth per capability, reused everywhere | Extra indirection for trivially simple endpoints | Stable |
| Documentation-first (ADR-012) | Legible reasoning, strong onboarding/interview artifact | Real time cost against new features | Maintain as the project continues to grow |

---

## 6. Lessons Learned

| Theme | What this project taught, concretely |
|---|---|
| **Concurrency** | The most dangerous bugs in this codebase were never logic errors — they were timing assumptions that happened to hold in every manual test and broke under real, fast-enough conditions (§4.2, §4.6) |
| **Distributed systems** | A guarantee proven at one layer (Yjs's CRDT convergence) does not extend automatically to an adjacent layer (the hydration boundary between persisted and in-memory state) — each boundary needs its own reasoning, not inherited confidence |
| **Real-time collaboration** | Choosing a proven CRDT library was necessary but not sufficient — the surrounding lifecycle (when a room becomes trustworthy, how a save reconciles against live state) carried as much real risk as the synchronization algorithm itself |
| **Testing** | A test environment that differs from production in the wrong dimension (Docker unreachable vs. Docker reachable-but-racing) can produce a uniformly-passing or uniformly-failing suite that hides the exact bug testing exists to catch (§4.5) |
| **Debugging race conditions** | The reliable method that worked repeatedly: correlate a failure with a *specific, measurable variable* (here, how fast a container's process exits), not just "sometimes it fails" — that correlation is what turns a flaky bug into a diagnosable one |
| **Documentation** | Writing this series surfaced real, previously-undocumented facts about the system itself (an unused duplicate model file, an inconsistent error-response shape, a wiring gap in a "logout all devices" endpoint) — the act of writing precisely enough to be checked is itself a form of review |
| **Maintainability** | Every place this project deliberately kept two things separate that could have been merged (REST execution vs. interactive sessions; three socket namespaces instead of one) paid for itself specifically when one side needed to change without risking the other |

---

## 7. Future Re-evaluation

Decisions that are correct *today*, at this project's current scale, but carry an identifiable condition under which they should be revisited:

| Decision | Re-evaluate when… | What would likely replace it |
|---|---|---|
| **In-process execution queue & session registry** | Running more than one backend instance becomes necessary (traffic, availability) | A Redis-backed (or similarly shared) queue/session store (System Architecture document §19, Docker Execution Engine document §19) |
| **A single Docker host** | Execution demand exceeds what one host can safely run concurrently | Kubernetes or a managed execution cluster, with the API submitting work to it rather than talking to a local daemon directly (docs/07 §19) |
| **Gemini as the sole AI provider** | Cost, quality, policy, or availability considerations change | A second provider added behind the existing provider factory (AI Assistant document §2, §12) — the abstraction already exists specifically so this is additive, not a rewrite |
| **Single-region MongoDB Atlas deployment** | Latency or availability requirements demand geographic distribution | Multi-region replication (Database Design document §13) |
| **A flat, global concurrency cap (no per-user fairness)** | One user's heavy usage begins measurably starving others under normal (non-abusive) load | Per-user sub-limits layered within the existing global cap (§4.6, §5) |
| **No formal CI/CD pipeline** | The project moves beyond solo/occasional-contributor development toward routine, frequent changes | Automated test execution and deployment on every change (Deployment document §12) |

None of these are wrong today — each is the right decision *for the scale and team size this project currently has*. The value of naming them here is that a future decision to change one of them can be made deliberately, against a known trigger, rather than reactively under pressure.

---

## 8. Conclusion

Code Ground's architecture is the product of a consistent decision-making pattern, visible across every ADR in this document: identify the alternatives that were genuinely available, weigh them against this project's actual scale and constraints (not a hypothetical larger one), choose deliberately, and — critically — revisit a decision honestly when building against it revealed something the original reasoning hadn't accounted for. Four of this project's decisions were materially revised during development (§4), and every one of those revisions came from a specific, identifiable signal (a race condition's failure pattern, a browser screenshot, a design review) rather than a vague sense that something might be wrong.

That combination — principled initial decisions, and the willingness to correct them precisely when evidence demanded it — is what this document is ultimately a record of, and it is as much a description of how this project was engineered as any of the systems it produced.

---

*This document should be revisited whenever a decision listed in §7 is actually re-evaluated — moving it from "future consideration" to a new, dated ADR entry recording what changed and why.*
