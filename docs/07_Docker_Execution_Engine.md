# Code Ground — Docker Execution Engine

> **This is the flagship technical document of the Code Ground repository.** The execution engine is the subsystem that actually runs untrusted, user-submitted code — safely, across six languages, under real resource limits, with production-grade concurrency control, observability, and a rigorously verified cleanup guarantee. This document explains it as a complete distributed subsystem: its architecture, its full execution lifecycle, its queueing and metrics infrastructure, the real race conditions found and fixed during its development, and the engineering reasoning behind every major decision.
>
> Companion documents: [`01_System_Architecture.md`](./01_System_Architecture.md) §10 and [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) §11 introduced this subsystem at the whole-system level. This document is the authoritative, detailed reference for it — nothing in those two documents should be treated as more complete than what is written here.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Execution Engine Architecture](#2-execution-engine-architecture)
3. [Supported Languages](#3-supported-languages)
4. [Execution Lifecycle](#4-execution-lifecycle)
5. [Temporary Workspace System](#5-temporary-workspace-system)
6. [Docker Runner](#6-docker-runner)
7. [Execution Queue](#7-execution-queue)
8. [Metrics System](#8-metrics-system)
9. [Docker Health Monitoring](#9-docker-health-monitoring)
10. [Cancellation](#10-cancellation)
11. [Resource Limits](#11-resource-limits)
12. [Security](#12-security)
13. [Production Hardening](#13-production-hardening)
14. [Race Conditions](#14-race-conditions)
15. [Failure Handling](#15-failure-handling)
16. [Performance](#16-performance)
17. [Testing Strategy](#17-testing-strategy)
18. [Design Decisions](#18-design-decisions)
19. [Future Improvements](#19-future-improvements)
20. [Conclusion](#20-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the Execution Engine

The execution engine is the one subsystem in Code Ground that runs code the platform does not control or trust — arbitrary, user-submitted source in six different languages — and returns its real output, safely, every time, without ever letting that code touch the host machine, another user's execution, or run unbounded in time, memory, or CPU.

### 1.2 Why Docker Was Chosen

Running untrusted code requires genuine OS-level isolation: a separate filesystem, a separate process namespace, and enforceable resource ceilings — properties a plain child process on the host cannot provide. Docker (via the Docker Engine API, accessed through `dockerode`) gives direct, low-level control over exactly those properties — container creation flags, resource limits, network isolation, and lifecycle events — without depending on a third-party "run this code for me" API that would hide all of this control behind someone else's black box.

### 1.3 Problems Solved Compared to Local Execution

| Local execution (what this engine avoids) | This engine's approach |
|---|---|
| Requires every supported language's toolchain installed on the user's machine | Zero local installation — every language runtime lives in a container image, provisioned on demand |
| A user's code can access, modify, or crash the host it runs on | Every execution is isolated inside a throwaway container with no access to the host filesystem or network by default |
| No natural ceiling on CPU/memory/runtime a script can consume | Explicit memory, CPU, process-count, output-size, and time limits on every single execution |
| "Works on my machine" — inconsistent environments across users | Every execution of a given language runs the identical, versioned base image, regardless of who submitted it |
| No visibility into how many executions are happening, or how they're performing | A dedicated concurrency queue, execution metrics, and health monitoring — this engine is built to be observed, not just used |

### 1.4 Engineering Goals

| Goal | What it means concretely |
|---|---|
| **Isolation** | Every execution — whether a one-shot batch run or a long-lived interactive session — gets its own container and its own temporary filesystem; nothing is ever shared between two executions |
| **Security** | No network access by default, hard resource caps, and a rigorously verified guarantee that no container is ever left running or orphaned |
| **Multi-language execution** | One uniform pipeline for six languages (three interpreted, three compiled), driven by a single centralized configuration map rather than per-language execution code |
| **Scalability (of the engine's design, not yet its infrastructure)** | A concurrency queue that bounds host load explicitly, with the exact same mechanism already shared by both execution modes this engine supports |
| **Reliability** | Fail-fast health checks, exception-safe cleanup under every exit path, and — as described in detail in §14 — real, previously-existing race conditions found and closed rather than left latent |

---

## 2. Execution Engine Architecture

```
                         ┌───────────────┐
                         │    Browser       │
                         └───────┬───────┘
                                 ▼
                    ┌─────────────────────────┐
                    │        Frontend               │
                    │  (Run button / Terminal          │
                    │   component — see the Frontend      │
                    │   Architecture document §10)          │
                    └───────────┬─────────────┘
                                 │  REST (one-shot)  or  Socket.IO (interactive — Phase 7)
                                 ▼
                    ┌─────────────────────────┐
                    │         REST API               │
                    │   POST /api/execution/run         │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │     Execution Service          │
                    │  validate → delegate to the       │
                    │  shared queue (this is the             │
                    │  ONE-SHOT, buffered orchestrator)      │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │     Execution Queue            │
                    │  acquire a concurrency slot        │
                    │  (shared with interactive              │
                    │   sessions — see §7)                     │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │      Language Runner            │
                    │  resolve image, filename,           │
                    │  compile/run commands, and             │
                    │  resource limits for the                 │
                    │  requested language                        │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │    Temporary Workspace          │
                    │  create an isolated temp             │
                    │  directory, write the                    │
                    │  submitted source into it                  │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │       Docker Runner             │
                    │  build the container spec,            │
                    │  attach I/O, apply the race-              │
                    │  free wait-before-start                     │
                    │  sequencing (§14)                             │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │       Docker Engine             │
                    │  (via dockerode, over the local       │
                    │   Unix socket / Windows named            │
                    │   pipe)                                      │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │        Container                │
                    │  one throwaway, resource-             │
                    │  capped, network-restricted             │
                    │  process sandbox                          │
                    └───────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │          Output                 │
                    │  stdout/stderr captured (or         │
                    │  streamed live, for interactive         │
                    │  sessions), exit code recorded,           │
                    │  metrics logged, workspace and              │
                    │  container cleaned up, queue slot            │
                    │  released                                      │
                    └─────────────────────────┘
```

Every box below "Execution Queue" is **shared infrastructure** between the two execution modes this engine supports (REST batch execution and interactive sessions — see §7's diagram for how they diverge only at the container-orchestration step itself).

---

## 3. Supported Languages

| Language | Base image | Execution shape |
|---|---|---|
| **JavaScript** | A current Node.js image | Interpreted — no compile step |
| **Python** | A current Python image | Interpreted — no compile step |
| **Java** | An Eclipse Temurin JDK image | Compiled (`javac`) then run (`java`) |
| **TypeScript** | The same Node.js image | Compiled (via the TypeScript compiler, fetched on demand) then run as JavaScript |
| **C++** | A GCC image | Compiled (`g++`) then run the produced binary |
| **Go** | A current Go image | Compiled (`go build`) then run the produced binary |

### 3.1 The Language Runner Abstraction

Every one of the six languages above is described by **one entry in a single, centralized configuration map** — its image, its source filename, its optional compile command, its run command, and any resource-limit overrides it needs. Nothing else in the execution engine contains language-specific branching: the Docker Runner (§6) takes a fully-resolved configuration object and has no idea whether it's running Python or compiling Go — it only knows "run this command, using this image, with these limits."

### 3.2 Why This Abstraction Was Chosen

| Without it | With it (as built) |
|---|---|
| Adding a language means touching container-creation logic, resource-limit logic, and execution-flow logic, all at once | Adding a language means adding one entry to one configuration map — everything downstream already knows how to consume it |
| Language-specific quirks (like TypeScript needing network access to fetch its compiler) risk leaking into shared, general-purpose code | A language's quirk is expressed as a resource-limit *override* on its own config entry (§11.3) — the shared Docker Runner code stays completely generic |
| Testing a new language requires exercising the whole execution pipeline in a bespoke way | The same generic test harness (§17) exercises every language identically, since they all flow through the same generic runner |

---

## 4. Execution Lifecycle

### 4.1 Stages

```
 1. Validation
      language present + supported? code present and non-empty?
      → reject immediately (400) if not — BEFORE touching the queue,
        so a malformed request never occupies a concurrency slot
                    │
                    ▼
 2. Queue
      acquire a concurrency slot (§7) — waits in FIFO order if the
      shared cap is already reached
                    │
                    ▼
 3. Workspace creation
      a fresh, uniquely-named temporary directory is created (§5)
                    │
                    ▼
 4. Code generation (workspace population)
      the submitted source is written into that directory under the
      filename the Language Runner config specifies
                    │
                    ▼
 5. Container creation
      a throwaway container is created against the resolved image,
      bound to the workspace directory, with resource limits applied
                    │
                    ▼
 6. Execution
      the container runs the language's compile command (if any)
      and then its run command; the exit-status wait is registered
      BEFORE the container is even started (§14) to close a real
      race condition
                    │
                    ▼
 7. Output collection
      stdout/stderr are captured (buffered for REST execution;
      streamed live for an interactive session), capped at a
      maximum size (§11.4)
                    │
                    ▼
 8. Metrics
      the outcome — language, exit code, duration, timeout flag,
      owning user/project where known — is recorded (§8)
                    │
                    ▼
 9. Cleanup
      the container is guaranteed removed (via AutoRemove plus an
      explicit safety net); the temporary workspace directory is
      deleted; the queue slot is released
                    │
                    ▼
 10. Response
      the final result is returned to the REST caller, or (for an
      interactive session) a final exit event is emitted over the
      socket
```

### 4.2 Sequence Diagram

```
 Client          ExecutionService      ExecutionQueue     LanguageRunner/Workspace     DockerRunner        Docker Engine
   │                     │                    │                       │                      │                    │
   │  submit code           │                    │                       │                      │                    │
   │ ─────────────────────▶ │                    │                       │                      │                    │
   │                     │  validate                │                       │                      │                    │
   │                     │  (400 if invalid,           │                       │                      │                    │
   │                     │   stop here)                  │                       │                      │                    │
   │                     │  acquire a slot                 │                       │                      │                    │
   │                     │ ─────────────────────▶ │                       │                      │                    │
   │                     │                    │  (FIFO wait if at cap)      │                      │                    │
   │                     │                    │  slot granted                 │                      │                    │
   │                     │ ◀───────────────────  │                       │                      │                    │
   │                     │  create workspace, resolve      │                       │                      │                    │
   │                     │  language config, write source     │                       │                      │                    │
   │                     │ ─────────────────────────────────────────────▶ │                      │                    │
   │                     │  ready                       │                       │                      │                    │
   │                     │ ◀───────────────────────────────────────────── │                      │                    │
   │                     │  runCode(config)                  │                       │                      │                    │
   │                     │ ─────────────────────────────────────────────────────────────────────▶ │                    │
   │                     │                    │                       │                      │  create container       │
   │                     │                    │                       │                      │ ───────────────────▶  │
   │                     │                    │                       │                      │  register exit-wait        │
   │                     │                    │                       │                      │  BEFORE start (§14)          │
   │                     │                    │                       │                      │  start                        │
   │                     │                    │                       │                      │ ───────────────────▶  │
   │                     │                    │                       │                      │  run, produce output           │
   │                     │                    │                       │                      │ ◀───────────────────  │
   │                     │                    │                       │                      │  exit status                     │
   │                     │                    │                       │                      │ ◀───────────────────  │
   │                     │  { exitCode, stdout,          │                       │                      │                    │
   │                     │    stderr, timedOut }              │                       │                      │                    │
   │                     │ ◀───────────────────────────────────────────────────────────────── │                    │
   │                     │  record metrics                     │                       │                      │                    │
   │                     │  cleanup workspace, release slot        │                       │                      │                    │
   │                     │ ─────────────────────▶ │                       │                      │                    │
   │  final response          │                    │                       │                      │                    │
   │ ◀───────────────────── │                    │                       │                      │                    │
```

---

## 5. Temporary Workspace System

### 5.1 Workspace Creation

Every execution — one-shot or interactive — gets a **brand-new temporary directory**, named with a randomly generated, collision-resistant identifier, created immediately before that execution's container is even resolved. Nothing about this directory's name or location is derived from user input.

### 5.2 Isolation

A workspace is used by exactly one execution and is never reused across two different executions or two different users, even in the failure path — meaning there is no scenario where one user's leftover files could be visible to a later, unrelated execution.

### 5.3 File Management

The workspace holds exactly one file: the submitted source, written under the exact filename the Language Runner's configuration specifies for that language (e.g. a fixed entry-point name per language) — the execution engine does not support multi-file submissions today (see §19).

### 5.4 Cleanup

The workspace directory is deleted unconditionally once an execution finishes — success, failure, or timeout alike — inside a `finally` block that runs regardless of how the execution concluded, so a crashed or errored execution never leaves its temporary files behind.

### 5.5 Security Considerations

- The workspace directory is **bind-mounted** into the container at a fixed working directory — the container can read/write within it, but has no visibility into any other path on the host.
- Because the directory name is randomly generated rather than derived from any request data, there is no path-traversal or predictable-location concern in how it's created.

### 5.6 Lifecycle Summary

```
 createWorkspace() → writeFile(source) → [container runs against it] → cleanup()
        (unique, random name)                                          (always, in a finally block)
```

---

## 6. Docker Runner

### 6.1 Container Creation

For every execution, the Docker Runner builds a container specification from the Language Runner's resolved configuration: the image, the command (a compile-then-run shell chain for compiled languages, or a direct run command for interpreted ones), a fixed working directory, and the workspace bind mount.

### 6.2 Images

Each supported language resolves to a specific, versioned base image (§3) — the same image is used for every execution of that language, guaranteeing consistent behavior regardless of who submitted the code or when.

### 6.3 Resource Limits

Every container is created with explicit limits, resolved per-language with sensible defaults and per-language overrides where needed (full detail in §11):

| Limit | Default | Purpose |
|---|---|---|
| Memory | 512 MB | Bounds how much RAM a single execution can consume |
| CPU | 1 CPU (via `NanoCpus`) | Bounds how much CPU a single execution can consume |
| Process count (`PidsLimit`) | 128 | Bounds fork-bomb-style resource exhaustion |
| Network | Disabled (`none`) | No outbound network access by default |

### 6.4 Networking

Network access is disabled by default for every language — the one deliberate exception is TypeScript, whose compiler is fetched on demand at compile time and therefore needs outbound network access; this is expressed as a per-language override in the Language Runner configuration (§3.1), not a general relaxation of the default.

### 6.5 Volumes

The only volume ever bound into an execution container is that single execution's own temporary workspace directory (§5) — read/write, and nothing else from the host filesystem is ever exposed.

### 6.6 Lifecycle and Why Containers Are Ephemeral

Every container is created with `AutoRemove: true` — Docker itself deletes the container the instant its process exits, with no separate cleanup call needed for the common case. Containers are **single-use and throwaway by design**, not pooled or reused, because:

- **Isolation correctness** — reusing a container across executions would mean one execution's filesystem state, environment, or leftover processes could leak into the next one.
- **Simplicity of the cleanup guarantee** — "this container is destroyed the moment it exits" is a much easier property to reason about and verify than "this container is returned to a pool in a guaranteed-clean state."
- **Consistency** — every execution starts from the exact same, known-clean image state, with no drift from a previous execution's side effects.

### 6.7 Container Removal Safety Net

`AutoRemove` alone only covers a container that actually *starts*. If container creation succeeds but something fails before the container is ever started (an attach failure, for instance), that container would otherwise leak indefinitely in the "Created" state — Docker only auto-removes on exit, and a container that never started never exits. The Docker Runner closes this gap with an explicit, unconditional force-removal in a `finally` block, guarded by a `started` flag: if the container was never successfully started, it is force-removed regardless of what else went wrong.

---

## 7. Execution Queue

### 7.1 Purpose

Docker containers are not free — each one consumes real host memory, CPU, and process-table entries. Without a cap, a burst of simultaneous Run clicks (or one abusive/malfunctioning client hammering the endpoint) could spin up an unbounded number of containers at once, degrading or crashing the host for every user, not just the one making the requests. The execution queue is a single, shared in-process concurrency semaphore that caps how many containers may be alive at any given moment.

### 7.2 Concurrency Limits and Fair Scheduling

The cap is a configurable maximum (a small, sensible default), and any request beyond that cap waits in a **strict FIFO queue** — the first request to arrive and find the cap already reached is the first one granted a slot once one frees up. There is no priority scheme; every execution, regardless of its source or requester, queues fairly in arrival order.

### 7.3 A Shared Queue, Not Two Separate Ones

```
                REST batch execution         Interactive execution session
                (execution.service.js)         (executionSession.service.js)
                          │                              │
                          └───────────────┬──────────────┘
                                          ▼
                             ┌─────────────────────┐
                             │   Execution Queue         │
                             │   ONE shared semaphore,      │
                             │   ONE shared cap                │
                             └─────────────────────┘
```

Both execution modes acquire a slot from the **exact same queue instance** — a batch execution and an interactive terminal session compete for the same bounded pool of concurrently-alive containers, because they consume the identical host resource (a running Docker container) regardless of which mode produced it.

### 7.4 Interactive Sessions Hold Their Slot for Their Entire Lifetime

This is the one point where the queue's usage differs meaningfully between the two modes: a REST execution holds its slot only for the duration of one bounded run (typically seconds). An interactive session — which can run for minutes, waiting on user input — holds its slot for its **entire lifetime**, released only when the session fully ends (naturally, by timeout, or by explicit stop). This is achieved by wrapping the session's *entire* lifecycle as a single unit of work submitted to the queue, not merely its container-creation step — ensuring a long-lived interactive session correctly counts against the same concurrency budget a batch execution would, rather than silently bypassing the cap by only "borrowing" a slot briefly at startup.

### 7.5 Benefits

- **Graceful degradation under load** — excess demand manifests as a queue wait, not host-level resource exhaustion or a crash.
- **One mechanism, two consumers** — no risk of the two execution modes independently implementing (and potentially disagreeing on) their own concurrency caps.
- **Predictable, fair ordering** — FIFO scheduling means no execution is starved indefinitely by later arrivals.

### 7.6 Trade-offs

- **Added latency under contention** — a request arriving when the cap is already reached waits, rather than running immediately; this is an accepted, deliberate trade against the alternative (no cap at all).
- **In-process only** — the queue's state (who's active, who's waiting) lives in one Node process's memory; running more than one backend instance would require this state to move to a shared store (see §19, and the System Architecture document §19).

---

## 8. Metrics System

### 8.1 What Is Recorded

Every completed execution — from either mode, whether it succeeded, failed, or timed out — is recorded as one entry: language, exit code, whether it timed out, total duration, the owning user/project where known, the container ID, and (best-effort) peak memory usage sampled during the run. A distinct `infrastructureFailure` flag distinguishes "the container ran and the submitted code itself exited non-zero" from "the container never produced a usable result at all" (e.g. Docker was unreachable) — these are fundamentally different failure categories, and metrics keep them distinguishable rather than collapsing both into a generic "failed" count.

### 8.2 Execution Time and Queue Time

Total execution duration is measured from the moment an execution begins its actual work (after acquiring a queue slot) to completion — capturing exactly the cost the container itself incurred, separate from however long a request may have additionally waited in the queue beforehand.

### 8.3 Failures and Successes

A running set of aggregate counters — total executions, successes, failures, timeouts, and a per-language breakdown — is maintained alongside the raw recent-history records, so both "what happened in the last N executions, specifically" and "what's the overall health picture" are available without recomputing either from scratch.

### 8.4 Resource Usage

Where obtainable, a single memory-usage sample is captured per execution (best-effort — a container that exits before the sample can be taken simply reports no data, which is treated as "unavailable," not a failure).

### 8.5 Storage Model

Metrics are held in a **bounded, in-memory ring buffer** — capped at a fixed maximum number of recent records, with older entries evicted as new ones arrive — plus the separately-maintained running aggregate totals, which are never evicted. Every recorded entry is also emitted as a structured log line, so the ring buffer is a convenience for fast, synchronous reads (consumed by the health endpoint, §9), not the only copy of this data.

### 8.6 How Metrics Improve Observability

Without this subsystem, the execution engine could degrade — a spike in timeouts, a specific language starting to fail disproportionately, memory usage creeping upward — with the first sign of trouble being user complaints. Metrics turn the engine from a black box into something that can answer, on demand, "is this actually healthy right now, and what does 'healthy' even mean quantitatively" — which is precisely what the health endpoint in §9 exposes to an operator or monitoring system.

---

## 9. Docker Health Monitoring

### 9.1 Startup Validation

Before the backend ever begins accepting traffic, it checks Docker daemon reachability directly. If the daemon is unreachable, the process logs a clear, specific error and **exits immediately** rather than starting in a state where every execution request would fail confusingly at request time. This is a deliberate fail-fast choice: a backend that "starts successfully" but cannot run any submitted code is strictly worse than one that refuses to start with an obvious, actionable reason.

### 9.2 Image Validation

Startup additionally checks that every language's required image is actually present locally. Unlike daemon unreachability, a missing image is treated as **non-fatal** — logged as a clear warning naming exactly which images are missing, while the server still starts and every language whose image *is* present remains fully usable. This distinction matters: Docker being unreachable means the entire execution engine is non-functional; a single missing image means one language is degraded, not the whole platform.

### 9.3 The Health Endpoint

A deep health endpoint exposes, on demand, in one machine-readable response: Docker daemon reachability, the presence/absence of every required language image, the execution queue's current active/waiting counts, and the metrics summary from §8 — alongside standard process uptime and memory. This endpoint deliberately never throws even when Docker itself is down; every sub-check independently reports its own status, so a health check being consulted *because* something might be wrong can never itself crash and make diagnosis harder.

### 9.4 Failure Detection

Both the startup check and the on-demand health endpoint use the same underlying reachability/image-check logic — there is exactly one implementation of "is Docker actually working," consulted at two different times for two different purposes (refuse-to-boot vs. report-current-status).

### 9.5 Recovery

There is no automatic recovery action taken if Docker becomes unreachable after the server has already started (e.g. the daemon crashes mid-operation) — the health endpoint will begin reporting the outage on its next call, and any in-flight execution against the now-unreachable daemon will fail and be recorded as an infrastructure failure (§8.1), but the backend process itself does not attempt to restart Docker or take any corrective action beyond reporting the true state accurately.

### 9.6 Monitoring Strategy

The health endpoint is designed to be polled externally (by an operator, a monitoring system, or a deployment platform's own health-check mechanism) — its machine-readable, always-non-throwing shape is what makes it suitable for exactly that kind of automated consumption, distinct from a debugging tool a human reads manually.

---

## 10. Cancellation

### 10.1 Two Cancellation Paths, One Underlying Mechanism

| Execution mode | How cancellation is triggered | Underlying action |
|---|---|---|
| **REST batch execution** | The HTTP client disconnects before the response completes (tab closed, request aborted client-side) — detected server-side via an `AbortController` tied to the response's close event | Kill the container |
| **Interactive session** | An explicit Stop action from the owning connection (verified against session ownership — see the Backend Architecture document §17), or a session timeout elapsing | Kill the container |

Both paths converge on the exact same underlying action — killing the container — which is what lets both share the same downstream cleanup guarantees (§6.7) rather than needing separate cancellation-specific cleanup logic.

### 10.2 AbortController and Signal Propagation (REST Path)

The REST controller creates an `AbortController` and listens for the response's close event; if the client disconnects before a response was ever sent, the controller's signal is aborted. That signal is threaded all the way down through the execution service into the Docker Runner's container-execution call — if the signal is already aborted before a container would even be created, the Docker Runner skips container creation entirely rather than starting one just to immediately kill it; if it fires after the container is already running, the same kill mechanism the timeout path uses is invoked.

### 10.3 Cancellation Flow

```
 Client disconnects            AbortController          Docker Runner              Container
       │                             │                        │                        │
       │  connection closed              │                        │                        │
       │ ───────────────────────────▶  │                        │                        │
       │                             │  signal aborted             │                        │
       │                             │ ───────────────────────▶  │                        │
       │                             │                        │  already aborted BEFORE     │
       │                             │                        │  container creation?           │
       │                             │                        │  → skip creation entirely,        │
       │                             │                        │    return a "cancelled"              │
       │                             │                        │    result immediately                   │
       │                             │                        │                        │
       │                             │                        │  already running?           │
       │                             │                        │  → container.kill()            │
       │                             │                        │ ───────────────────────▶  │
       │                             │                        │                        │  exits, AutoRemove
       │                             │                        │                        │  fires, cleanup
       │                             │                        │                        │  guarantee applies
       │                             │                        │                        │  identically to any
       │                             │                        │                        │  other exit path
```

### 10.4 Failure Cases

- A cancellation signal firing in the narrow window **during** container creation (after creation starts, before it resolves) is handled by checking the signal again immediately after creation completes, and killing the just-created container if it fired in that window — closing the gap rather than leaving a brief period where cancellation would silently have no effect.
- A `kill()` call against a container that has already exited (e.g. cancellation racing a natural completion) is a caught, harmless no-op — cancellation is never assumed to be the *only* possible reason a container stops.

---

## 11. Resource Limits

### 11.1 CPU

Every container is capped at a fixed CPU allocation via Docker's `NanoCpus` setting (defaulting to the equivalent of one full CPU core) — a single execution cannot monopolize the host's CPU at the expense of other concurrent executions or the backend process itself.

### 11.2 Memory

Every container is capped at a fixed memory ceiling (defaulting to 512 MB) — a runaway allocation inside the executed code is killed by the container's own memory limit rather than being able to exhaust host memory.

### 11.3 Timeout

Independent of resource limits, every execution has a maximum wall-clock duration, after which the container is killed regardless of its resource usage — this specifically covers code that isn't resource-heavy but simply never terminates (an infinite loop with no allocation growth, for instance), which memory/CPU caps alone would never catch. Interactive sessions use a materially longer default timeout than one-shot REST runs, appropriate to genuinely interactive use where a user may legitimately be composing input for some time.

### 11.4 Output Limits

Total accumulated stdout+stderr is capped at a maximum byte count. Crossing it stops appending further output **and** kills the container immediately — there is no reason to let a container keep burning CPU producing output that is being discarded anyway. Interactive sessions use a more generous cap than one-shot REST runs, reflecting that a legitimate interactive session is expected to run longer and print more over its lifetime.

### 11.5 Workspace Limits

There is no explicit disk-quota limit on a workspace directory's size beyond what the host filesystem itself enforces — the temporary, single-use, always-cleaned-up nature of each workspace (§5) is the primary mitigation here rather than an explicit quota; a submitted source file is bounded implicitly by the same input-size considerations applied at the API layer.

### 11.6 Security Implications of These Limits

Every limit in this section exists specifically to prevent one execution from degrading the host, other concurrent executions, or the backend process itself — resource limits are a security control here as much as a performance one: an attacker's goal in submitting a deliberately resource-abusive script is denial of service, and every limit above closes a specific avenue toward that goal (unbounded CPU, unbounded memory, unbounded runtime, unbounded output, unbounded process count via `PidsLimit`).

---

## 12. Security

| Concern | Mechanism |
|---|---|
| **Sandboxing** | Every execution runs inside a Docker container — a real OS-level isolation boundary, never the backend's own process |
| **Filesystem isolation** | Only that execution's own single-use temporary workspace directory is bind-mounted in; nothing else on the host is visible to the container |
| **Container isolation** | Every execution gets its own container; nothing (filesystem, process, memory) is ever shared between two executions |
| **Execution limits** | CPU, memory, process count, output size, and wall-clock time are all explicitly bounded (§11) |
| **Network restrictions** | No network access by default; the one exception (TypeScript's compiler fetch) is a narrow, deliberate, per-language override, not a general relaxation |
| **Command validation** | The requested language is checked against an explicit allowlist before it is ever used to resolve a Docker image or command — user input is never used directly as an image reference or shell command |
| **Temporary workspaces** | Randomly named, single-use, never derived from user-controlled paths |
| **Cleanup** | Every container is guaranteed removed (AutoRemove plus an explicit safety net — §6.7) and every workspace is guaranteed deleted (§5.4), under every exit path, verified directly by automated tests leaving zero orphaned containers |

---

## 13. Production Hardening

The execution engine went through a deliberate hardening pass beyond a working happy-path implementation, adding exactly the properties real production infrastructure needs:

| Hardening addition | Why it matters |
|---|---|
| **Execution Queue (§7)** | Without it, unbounded concurrent containers can take down the host under load or abuse — this closes that gap entirely |
| **Metrics (§8)** | Without it, degradation is invisible until users complain — this makes the engine's health a queryable fact, not a guess |
| **Health monitoring (§9)** | Without it, "the API is up" and "code execution actually works" are conflated — this makes them independently, explicitly verifiable |
| **Cancellation (§10)** | Without it, an abandoned request (a closed tab, a stopped session) keeps consuming a container and a queue slot for no reason until its full timeout elapses |
| **Cleanup guarantees (§6.7, §5.4)** | Without a `started`-flag safety net and an unconditional workspace cleanup, a specific class of partial failure (created-but-never-started containers, or an errored execution) would leak resources silently over time |
| **Lifecycle management under every exit path** | Success, failure, timeout, and cancellation all funnel through the same guaranteed cleanup — verified, not assumed |

### 13.1 Why These Specifically

Each addition above targets a **specific, concrete failure mode** that a pure happy-path implementation would have left open — none of them are generic "best practice" additions for their own sake. This is what "production readiness" means concretely for this subsystem: not a checklist, but a set of gaps that were identified and deliberately closed, several of which (§14) were found only because they were actually triggered.

---

## 14. Race Conditions

This section documents, in full engineering detail, the most significant defects found and fixed during this engine's development — all in the container lifecycle's exit-status handling, and all invisible until tested against a real Docker daemon rather than a mock.

### 14.1 The Docker AutoRemove Race

**Problem statement:** Containers are created with `AutoRemove: true`, so the Docker daemon deletes a container the instant its process exits — the daemon does not wait to be asked. The original implementation called `container.stats()` (a best-effort memory sample) and then `container.wait()` (to retrieve the final exit status) *after* `container.start()` had already resolved.

**Investigation:** Testing this against a real Docker daemon (rather than a scenario where Docker was simply unreachable and every call failed identically) revealed a very specific failure pattern: every fast-exiting execution — a one-line `console.log`, a `print()` statement, a `javac` compile error that fails before the JVM ever starts — failed with an HTTP 404 "no such container" error on the `wait()` call. Slower executions (a real JVM boot-and-run, a real C++ compile-and-link) consistently succeeded. This pattern — failure correlated specifically with *how fast the container's process exits* — was the key diagnostic signal.

**Root cause:** For a container fast enough, the daemon can fully reap it (process exit → AutoRemove fires → container gone) in less wall-clock time than it takes the calling Node process to make two more sequential HTTP round-trips to the daemon (the `stats()` call, then the `wait()` call) — especially with the added latency of a named-pipe transport. By the time `wait()` was finally called, the container the caller was asking about no longer existed.

**Solution — iteration 1:** Move the exit-status `wait()` call earlier, ahead of the `stats()` call, narrowing the window. This measurably reduced — but did not eliminate — the failure rate. A syntax-error case (a script failing to even parse, exiting in well under a millisecond) still occasionally lost the race.

**Solution — iteration 2:** Register the `wait()` call **before** `container.start()` is even invoked, not merely earlier among the post-start calls. This required using the correct Docker API wait *condition* — `next-exit`, not the default `not-running` — because a container that has been created but not yet started is, technically, already "not running," so the default condition would resolve immediately with a bogus zero exit status rather than actually waiting for the run that was about to happen. With `next-exit` and pre-start registration, the daemon has a live exit subscription open before the container can possibly finish running, no matter how many microseconds later that turns out to be — closing the race completely for exit-status correctness.

**A second race, exposed by fixing the first:** Once `wait()` was fast enough to reliably win the AutoRemove race, a **different** symptom appeared: some fast executions now returned the *correct* exit code, but with empty `stdout` — the process's own output had not finished arriving before the (now much faster) exit-status confirmation was used as the signal to read final output. `container.wait()` and the attached I/O stream are two independent connections to the daemon with no ordering guarantee between them.

**Solution — iteration 3:** Rather than trusting `wait()`'s resolution as proof that output capture was also complete, a separate promise was introduced that resolves when the attach stream itself ends or closes, and final output is only read once **both** the exit status and the stream-end signal have arrived — with the stream-end wait deliberately **bounded** by a short grace period (a couple of seconds), so a connection that unexpectedly never closes cleanly cannot turn into a second, different kind of hang.

**A fourth, self-inflicted bug found during this same fix:** An initial attempt at the stream-end wait targeted the wrong object — it waited on the *derived*, demultiplexed stdout/stderr streams rather than the *raw* attach stream docker-modem demultiplexes from. Those derived streams are only ever written to, never explicitly ended, by the demultiplexing library — so waiting on their `'end'` event **hung forever**, on every single execution, timeout included, since nothing bounds an event that will never fire. This was caught immediately by re-running the test suite (which went from passing to universally hanging), and fixed by moving the wait onto the raw underlying stream, which the daemon does properly close once output is fully flushed.

### 14.2 Lessons Learned

| Lesson | Why it matters beyond this one bug |
|---|---|
| **Test against a real daemon, not a mock, for lifecycle-sensitive code.** | Every one of these races was invisible in an environment where Docker was simply unreachable (every call failed identically, masking the actual timing bug entirely) — they only reproduced against a real, working daemon |
| **A fix that changes timing can expose a second, previously-masked race.** | The output-ordering race only became observable *because* the AutoRemove race was fixed and `wait()` got faster — fixing one race can uncover another that was hiding behind it |
| **"Subscribe before the event can happen" beats "poll after."** | The core, generalizable fix (register the wait *before* starting the container) is a specific instance of a broader, reusable pattern: when an event might happen arbitrarily fast, the only race-free approach is registering interest in it before the action that could trigger it, not asking about it afterward |
| **Bound every wait that isn't already bounded by something else.** | The stream-end grace period is deliberately time-boxed — an unbounded wait "fixing" one hang by introducing the possibility of a different, permanent hang would have been a net-negative trade |
| **The same class of bug, once understood, gets fixed everywhere it applies — proactively.** | When the interactive execution session orchestrator (a separate implementation from the REST path — see the Backend Architecture document §11.2) was built afterward, the identical wait-before-start-with-`next-exit` sequencing was applied to it immediately, on the basis of this investigation — not rediscovered independently through a second round of the same debugging |

### 14.3 Why This Section Is Detailed

These races are the single best illustration of what "production hardening" (§13) means in practice: not a list of features, but specific, non-obvious defects that only surface under real timing conditions, found through disciplined investigation (correlating failure with container speed, then testing each fix against the real daemon), and closed with a fix precise enough to explain *why* it works, not merely that it does.

---

## 15. Failure Handling

| Failure | Handling |
|---|---|
| **Compile errors** | Not treated as an engine failure at all — the container ran successfully, compiled unsuccessfully, and exited non-zero with the compiler's own error on stderr; this is a normal, successful result from the engine's perspective |
| **Runtime errors** | Same treatment — a non-zero exit code and populated stderr are a normal, successful execution outcome, not an engine-level error |
| **Timeouts** | The container is killed after its maximum duration; the result reports `timedOut: true` and a synthesized exit code, and is recorded in metrics as a timeout specifically (distinct from an ordinary non-zero exit) |
| **Docker unavailable** | Detected at startup (fails the boot fast, §9.1) and, if it happens later, surfaces per-execution as an infrastructure failure, recorded distinctly from a code-level failure in metrics (§8.1) |
| **Image missing** | Detected at startup as a non-fatal warning naming the specific missing image(s) (§9.2); an execution attempting to use a language whose image is genuinely missing fails at container-creation time, surfaced as an infrastructure failure |
| **Container crashes** | Handled identically to any other exit — the exit status (whatever it is) is captured via the race-free wait sequencing in §14, and cleanup proceeds exactly as it would for a normal exit |
| **Cleanup failures** | Both the container-removal and workspace-deletion cleanup calls are deliberately fire-and-forget/best-effort at the very final step — a failure to remove an already-`AutoRemove`d container, for instance, is expected and swallowed rather than escalated, since the daemon has already handled it |
| **Backend restart** | All in-flight executions are lost along with the process — there is no persistence of in-progress execution state; any container still running at that moment continues independently until its own timeout, since a container's lifecycle isn't tied to the backend process that started it staying alive |
| **Graceful degradation** | The queue (§7) is itself the primary graceful-degradation mechanism — load beyond capacity becomes a wait, not a crash; the health endpoint (§9.3) lets this degraded (but still functioning) state be observed rather than only discovered through failures |

---

## 16. Performance

| Concern | Approach |
|---|---|
| **Queue efficiency** | A simple in-process semaphore with O(1) acquire/release and a FIFO waiting list — no external coordination overhead for the common case of concurrency staying under the cap |
| **Streaming** | Interactive sessions forward output to the client the instant it's produced rather than buffering it server-side — bounded server memory regardless of how much a long-running program eventually prints |
| **Container lifecycle** | Deliberately ephemeral (§6.6) rather than pooled — the performance cost of a fresh container per execution (image-layer reuse aside, since the image itself is already local and cached) is accepted in exchange for the isolation-correctness and cleanup-simplicity guarantees that pooling would complicate |
| **Workspace reuse** | Not implemented, and not currently planned as a default behavior — a fresh workspace per execution is a correctness property (§5.2), not merely a performance-neutral default |
| **Metrics overhead** | A bounded in-memory ring buffer with O(1) insertion — negligible cost relative to the container operations it's measuring |
| **Scalability (current)** | The queue, active-session registry, and metrics all live in one process's memory — sufficient for a single-instance deployment, and an explicit, documented boundary for anything beyond that (§19) |
| **Optimization opportunities** | Language images could be pre-warmed/pulled proactively at deploy time rather than only checked at startup (§9.2 already detects missing images, but doesn't fetch them automatically); a future caching layer (§19) could avoid re-running identical, side-effect-free submissions |

---

## 17. Testing Strategy

### 17.1 What Is Tested

| Suite | Coverage |
|---|---|
| **Execution tests (REST/batch)** | Every supported language's success path, compile-failure path, and runtime-failure path, run against a real Docker daemon |
| **Interactive session tests** | Session creation, live output streaming (explicitly asserted to arrive incrementally, before the process finishes — not only after), real stdin round-trips, stop/cancellation (including stopping a session still queued, before any container exists), disconnect cleanup, timeout cleanup, and concurrent multi-user sessions verified not to cross-talk |
| **API tests** | The REST execution endpoint end-to-end — validation-error paths (missing/unsupported language, missing code) and a real, successful execution — against a real HTTP server on an ephemeral port |
| **Timeout tests** | A deliberately-overridden, short timeout confirms a never-exiting program is killed and reported as timed out well within a bounded test window, rather than relying on the real multi-minute default |
| **Cancellation tests** | Explicit stop of a running execution, idempotent double-stop, and stopping an execution still waiting in the queue (before a container ever exists) are all directly verified |
| **Health tests** | Exercised manually and via direct invocation against a real Docker daemon in both states (reachable and deliberately unreachable), confirming the endpoint never throws and reports each state accurately |
| **Regression tests** | The full suite (batch execution + interactive sessions + API + CRDT, run together) is re-run after every change to this subsystem, specifically to catch a fix in one area silently breaking another — exactly the pattern that caught the self-inflicted stream-hang bug described in §14.1 |

### 17.2 Why Real Docker, Not Mocks

The defects that actually mattered in this subsystem (§14) are timing- and concurrency-dependent races in the real Docker API's behavior — a mock would, by construction, define exactly these races out of existence, producing a test suite that passes with total confidence against code that fails in production. Testing this subsystem meaningfully requires a real daemon, real containers, and real timing.

### 17.3 Production Validation

Beyond the automated suite, this subsystem was validated with a real, headless-browser-driven end-to-end pass — launching the actual application, registering a real user, running real code through the real Editor UI, typing into a live terminal session mid-execution, and confirming a Stop action actually terminates a container (observed directly via its exit code) — specifically because some defects (a UI element failing to initialize under a particular mounting condition) are invisible to any test that doesn't exercise the real, rendered application. The combination of a Docker-backed automated suite and this direct end-to-end pass is what "production validation" means concretely for this engine, rather than a claim resting on unit tests alone.

---

## 18. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why Docker** | Untrusted code execution requires real OS-level isolation and enforceable resource limits | Strong isolation; direct low-level control via the Docker Engine API rather than a third-party black-box execution service | An external daemon dependency the backend must health-check and can fail independently of the API process |
| **Why an Execution Queue** | Unbounded concurrent containers can exhaust host resources under load or abuse | Graceful degradation (a wait) instead of host-level failure; one shared cap spans both execution modes | Adds latency under contention — accepted against the alternative of no cap |
| **Why a Language Runner abstraction** | Adding a language should be a configuration change, not new execution logic scattered through the codebase | New languages are additive; language-specific quirks stay contained to their own config entry | An extra layer of indirection versus hard-coding each language's logic directly — justified the moment a second language existed |
| **Why temporary, single-use workspaces** | Every execution needs a guaranteed-clean, isolated filesystem | Zero state leakage between executions or users, verified by construction (a fresh random directory every time) rather than by a reset step that could be forgotten | No persistence of installed packages/build artifacts between runs — an accepted simplicity trade (see §19) |
| **Why Execution Metrics** | An engine that can degrade silently is worse than one that cannot run at all | Failures and degradation become visible and diagnosable rather than only surfacing as user complaints | In-memory only today, not yet exported to durable long-term storage |
| **Why Health Monitoring (including fail-fast startup)** | "The API answers HTTP" and "code execution actually works" are different facts a shallow uptime check would conflate | Immediate, clear failure at boot if Docker is unreachable; on-demand deep status at any later point | A small amount of added startup latency for the reachability/image check |
| **Why separate REST execution from interactive sessions** | A one-shot buffered result and a long-lived, bidirectionally-streaming session are different problems wearing the same "run code" label | Neither implementation carries the other's complexity; the well-tested batch path was never put at risk while building the interactive path | Some concepts (language config, resource limits, the exit-status race fix) must be deliberately kept in sync across two call sites — mitigated by both pulling from the same shared configuration/queue/metrics modules, and by applying a fix found in one to the other proactively (§14.2) |

---

## 19. Future Improvements

| Improvement | What it would add |
|---|---|
| **Redis-backed queue** | The prerequisite for running more than one backend instance — today's in-process semaphore would need to become a shared, cross-process concurrency primitive |
| **Distributed execution / Kubernetes** | Running containers directly against a local Docker daemon ties total execution capacity to one host; delegating to Kubernetes or a managed execution cluster removes that ceiling |
| **Autoscaling** | A natural consequence of the Kubernetes step above — execution capacity growing/shrinking with real demand rather than a fixed host's fixed resources |
| **Persistent containers (for specific use cases)** | Today's ephemeral-by-design model (§6.6) is a deliberate correctness choice for arbitrary untrusted code; a *separate*, more constrained mode (e.g. a persistent dev-container per project) could coexist without weakening the isolation guarantee for the general case |
| **Execution caching** | Detecting identical, side-effect-free submissions and returning a cached result would save real compute for common cases (e.g. repeatedly re-running an unchanged "hello world" while testing the platform itself) |
| **Custom images** | Letting a project bring its own base image (with pre-installed dependencies) rather than always starting from the platform's fixed per-language image |
| **Language plugins** | Extending the Language Runner's configuration map with a more formal plugin interface, so a new language can be contributed without touching the core engine's code at all |
| **Resource scheduling (beyond a flat concurrency cap)** | Today's queue treats every execution identically; a more sophisticated scheduler could weight resource allocation by execution size/priority rather than a single flat cap |

---

## 20. Conclusion

The Docker execution engine is, by a clear margin, the most operationally mature subsystem in Code Ground — not because it is the most feature-rich, but because it was built with the specific discipline real infrastructure requires: a shared concurrency queue that makes overload a graceful wait instead of a crash, metrics and health checks that turn "is this actually working" from a guess into a queryable fact, a resource-limit and network-isolation model that treats security and stability as the same problem, and a container-cleanup guarantee that was tested until it held under every exit path — success, failure, timeout, and cancellation alike.

Its most significant engineering story is the exit-status race condition documented in §14: a genuine, non-obvious distributed-systems bug, found through disciplined investigation against a real Docker daemon rather than assumed away by a mock, fixed with a precise and *explainable* solution, and then proactively reapplied to a second, independently-built execution path the moment that path needed the same guarantee. That combination — real isolation, real observability, and a demonstrated ability to find and correctly close a genuine race condition — is what makes this engine the strongest single piece of evidence in the Code Ground codebase that its author can build systems that are not just functional, but actually correct under the conditions that matter.

---

*This document should be revisited if any of the Future Improvements in §19 are implemented — in particular, moving the execution queue or session registry out of process memory changes the concurrency and fault-tolerance story described throughout §7, §15, and §16.*
