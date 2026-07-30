# Code Ground — Testing Strategy

> **Scope of this document:** How Code Ground was actually tested — what's automated, what's manual, what tools were genuinely used (and which weren't), and the real bugs this process found, with the investigation and resolution behind each. This is a quality-assurance document, not an architecture document: it explains testing decisions and outcomes, not the systems being tested (those are covered in the companion documents referenced throughout).
>
> **A note on honesty, up front:** this document distinguishes clearly, throughout, between what is implemented and repeatable today versus what was a one-time verification pass versus what remains a future improvement. Where a testing capability doesn't exist yet (a CI pipeline, a maintained E2E suite, load testing), it is named as such in §14, not implied to already exist.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Testing Strategy](#2-testing-strategy)
3. [Unit Testing](#3-unit-testing)
4. [Integration Testing](#4-integration-testing)
5. [End-to-End Testing](#5-end-to-end-testing)
6. [Docker Execution Testing](#6-docker-execution-testing)
7. [Interactive Terminal Testing](#7-interactive-terminal-testing)
8. [Collaboration Testing](#8-collaboration-testing)
9. [Error Handling Validation](#9-error-handling-validation)
10. [Manual Testing](#10-manual-testing)
11. [Bugs Discovered During Development](#11-bugs-discovered-during-development)
12. [Testing Tools](#12-testing-tools)
13. [Continuous Quality Practices](#13-continuous-quality-practices)
14. [Future Improvements](#14-future-improvements)
15. [Conclusion](#15-conclusion)

---

## 1. Introduction

### 1.1 Purpose of Testing

Testing in Code Ground exists to answer one question honestly, for the subsystems where it matters most: **does this actually work, under the specific conditions that break systems like it** — not merely "does the happy path return the expected value." That framing shaped where testing effort was concentrated: heaviest on the two subsystems with real concurrency and lifecycle complexity (Docker execution and CRDT collaboration), lighter where the risk profile is genuinely lower.

### 1.2 Testing Philosophy

Two principles run through every testing decision made on this project:

- **Test against the real dependency, not a mock, when the bug you're afraid of is a timing or lifecycle bug.** A mocked Docker daemon cannot reproduce a container-removal race; a mocked Socket.IO connection cannot reproduce a real reconnect. Where this project's tests matter most, they run against a real Docker daemon and real network connections, deliberately.
- **Automated coverage and manual verification are not substitutes for each other.** The single clearest lesson from this project's own history (§11.2, §11.4) is that a fully passing automated suite and a genuinely working feature are not the same claim — one specific defect (the xterm.js mounting bug) existed behind a completely green automated test suite until it was caught by actually opening the application in a browser.

### 1.3 Quality Goals

| Goal | What it means concretely here |
|---|---|
| **Correctness under concurrency** | The execution engine and collaboration layer are explicitly tested for race conditions, not just sequential correctness |
| **No silent resource leaks** | Every execution test suite verifies zero orphaned Docker containers remain afterward |
| **Consistent, predictable failure behavior** | Validation, authorization, and infrastructure failures are tested to confirm they fail the *expected* way, not just that they fail |
| **Confidence proportional to risk** | The subsystems with the most automated tests are the ones with the highest concurrency/lifecycle risk — test investment was not spread evenly, it was spread deliberately |

### 1.4 Confidence vs. Correctness

No test suite proves a system correct in an absolute sense — it demonstrates that specific, deliberately chosen scenarios behave as expected. This project's testing strategy is explicit about that distinction: automated tests provide **repeatable confidence** for the scenarios they cover (concurrency, cleanup, validation, authorization); they do not substitute for the kind of confidence that only comes from **actually using the running application** — which is precisely why manual and browser-driven verification (§5, §10) remain a deliberate, named part of this project's process rather than an informal afterthought.

---

## 2. Testing Strategy

### 2.1 The Testing Pyramid, as Actually Implemented

```
                        ┌─────────────────────────┐
                        │      E2E (Browser)           │
                        │  Playwright, driven               │
                        │  manually against a real           │
                        │  running app — ONE deep pass,        │
                        │  not a maintained, repeatable          │
                        │  suite in CI (§5, §14)                  │
                        └─────────────┬─────────────┘
                                       │  fewest, most expensive,
                                       │  highest real-world confidence
                        ┌─────────────┴─────────────┐
                        │       Integration              │
                        │  real HTTP server + real          │
                        │  Docker daemon + real                │
                        │  MongoDB — API tests,                  │
                        │  execution tests, CRDT                   │
                        │  hydration tests (§4, §6)                 │
                        └─────────────┬─────────────┘
                                       │  moderate count, real
                                       │  dependencies, run on demand
                        ┌─────────────┴─────────────┐
                        │            Unit                 │
                        │  input validation, pure               │
                        │  service logic exercised                │
                        │  directly, no I/O (§3)                   │
                        └─────────────────────────┘
                                most numerous, fastest,
                                narrowest scope each
```

### 2.2 What's Different From a Textbook Pyramid

This project's pyramid is **inverted in emphasis, not in shape**: the middle layer (integration) carries more of the actual risk-reduction weight than the base layer, because most of this codebase's genuine correctness risk lives in *how components interact under real timing conditions* (a Docker container's exit lifecycle, a CRDT room's hydration race), not in isolated logic errors a pure unit test would catch. The top layer exists, and was decisive in finding one specific class of bug (§11.4), but is not exercised as a routine, automated gate today — it is documented honestly as a one-time deep validation pass, not a continuously-run suite.

### 2.3 Layer Responsibilities

| Layer | What it catches | What it cannot catch |
|---|---|---|
| **Unit** | Logic errors in isolated functions/services; incorrect validation rules | Anything involving real timing, real I/O, or real concurrent access |
| **Integration** | Wiring errors between layers; real database/Docker/HTTP behavior; concurrency and lifecycle races | Whether the feature is actually usable/visible in a real browser |
| **E2E (browser)** | Whether the whole system, rendered and interacted with as a real user would, actually works — including frontend-only defects invisible to any backend test | Broad, repeatable regression coverage (given its current one-off, manual nature — §14) |

---

## 3. Unit Testing

### 3.1 What Was Unit Tested

| Area | What's verified |
|---|---|
| **Input validation** | The execution engine's language/code presence checks (Docker Execution Engine document §4.1) are exercised directly against `executionService.execute()`, asserting the specific `ApiError` status code and message for each invalid input, without ever reaching the queue or Docker |
| **Service logic exercised directly** | Where a service's logic is meaningfully separable from its external dependency, it is called directly as a plain function/module (e.g. the execution queue's concurrency-limiting behavior — §12.1 in the Docker Execution Engine document's verification approach) rather than only indirectly through an HTTP layer |
| **Ownership/ authorization logic** | The interactive terminal's session-ownership check (`isOwnedBy`) is exercised directly against fake socket identities, confirming a non-owning connection's input has no effect (Interactive Terminal document §10) |

### 3.2 Purpose

Unit-level checks isolate a single unit of logic from the timing and infrastructure concerns integration tests carry — they run in milliseconds, and a failure points at exactly one function's behavior, not an ambiguous interaction between several moving parts.

### 3.3 Benefits

- **Fast feedback** — no Docker, no real socket connections, no network latency.
- **Precise failure attribution** — a failing unit test names the exact behavior that's wrong.
- **Safe to run constantly** — cheap enough to run on every change without friction.

### 3.4 Limitations

Unit tests in this project deliberately do **not** attempt to verify the properties that actually mattered most in the subsystems where real bugs were found (§11) — container lifecycle timing, hydration race conditions, and real socket disconnect behavior are all *integration*-level concerns by nature; a unit test mocking Docker or Socket.IO away would have passed throughout the entire period these real bugs existed, which is precisely why this project does not lean on unit testing as its primary confidence mechanism for those subsystems (§2.2).

---

## 4. Integration Testing

### 4.1 What's Covered

| Area | How it's tested |
|---|---|
| **REST APIs** | A real Express app (routes + real middleware, e.g. `notFound`/`errorHandler`) is bound to an ephemeral port and driven with real HTTP requests (via `fetch`), for the execution endpoint's full validation-and-success path (API Reference document §7.1) |
| **MongoDB interactions** | The CRDT hydration and save-reconciliation tests run against real Mongoose models and a real database connection — not a mocked collection — since the specific bugs these tests guard against (Collaboration System document §7, §11.4) are timing interactions between in-memory and persisted state that a mock would define away |
| **Docker execution pipeline** | The full execution service, from validation through the queue, language resolution, workspace creation, and real container execution, run end-to-end against a real Docker daemon (§6) |
| **Authentication flow** | Exercised indirectly through every integration test that requires a real request context (Authentication document); there is no dedicated, isolated authentication integration suite as a separate artifact today (§14) |
| **Socket.IO communication** | Verified directly for the interactive terminal (§7) using a lightweight fake-socket harness (an object exposing `.id`/`.emit()`) exercising the real `executionSession.service.js` logic — not a full real Socket.IO client/server round trip for every scenario, though the one Playwright E2E pass (§5) did exercise a real, full Socket.IO connection end-to-end |

### 4.2 Why Integration Testing Matters Here

The single most valuable property integration tests provide in this codebase is **exposing real timing behavior a mock cannot produce** — every race condition documented in the Docker Execution Engine document §14 and the Collaboration System document §7 was only reproducible, and only fixable with confidence, because the tests exercising them ran against the real dependency (Docker, MongoDB) rather than a stand-in for it.

---

## 5. End-to-End Testing

### 5.1 The Role of Playwright — Accurately Stated

Playwright was used for **one deliberate, deep verification pass** of the interactive terminal feature, driving a real headless Chromium browser against the actual running application (both frontend and backend, with a real Docker daemon underneath). It is **not** currently a maintained, repeatable test suite committed to the repository or wired into any routine process — it was installed and run ad hoc, specifically to answer the question "does this feature actually work when a real user opens it in a real browser," after every lower-level automated test had already passed.

### 5.2 Why That Distinction Matters

This document is explicit about this because conflating "we used Playwright once" with "we have an E2E test suite" would misrepresent the actual state of this project's quality assurance — the honest claim is narrower and, in a specific way, more valuable: a targeted, real-browser validation caught a defect (§11.4) that a broader but shallower suite might not have been specifically aimed at.

### 5.3 The User Journey Actually Exercised

The one E2E pass drove a complete, realistic journey: **registering a real account → creating a real project → creating real files via the API → opening the Editor in a real browser → opening a file and waiting for Monaco/collaboration to become ready → clicking Run → observing live streamed output appear before the program finished → typing a real answer into the terminal for a live `input()` prompt and confirming the program continued correctly → observing a clean exit with the correct exit code → switching to a second, long-running file → clicking Run again → clicking Stop and confirming the exit code reflected a real container kill (`137`) → checking the browser console for any errors at every step.**

### 5.4 What E2E Tests Can Detect That Lower-Level Tests Cannot

| Category | Example from this project |
|---|---|
| **Frontend rendering/mounting defects** | The xterm.js mounting bug (§11.4) — a completely correct backend, invisible to any backend test, that produced a blank terminal in the real, rendered UI |
| **Real cross-layer timing** | Confirming output genuinely appears *before* a multi-second program finishes, observed visually, not just asserted on an event queue in isolation |
| **Genuine user-facing correctness** | Whether a feature is not just logically correct but *usable* — visible, interactive, and free of console errors in an actual browser session |

### 5.5 Journeys Not Covered by the One E2E Pass

Login/registration via the UI form itself (the pass used the REST API directly for setup, then injected the resulting token — a deliberate choice for speed and reliability, described in the pass itself), the AI assistant's UI flow, and the full real-time collaboration UI (multiple simultaneous browser contexts) were not part of this specific pass — see §14 for formalizing broader E2E coverage.

---

## 6. Docker Execution Testing

Full architectural context: [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md).

### 6.1 What's Verified, Per Language

Every one of the six supported languages is tested for: a **successful run** (correct stdout, zero exit code), a **compilation failure** (for the four compiled/transpiled languages — non-zero exit, the compiler's error surfaced on the expected stream), and a **runtime failure** (a thrown exception/panic/abort — non-zero exit, the error message present).

### 6.2 Cross-Cutting Properties Verified

| Property | How it's tested |
|---|---|
| **Timeouts** | A deliberately short, overridden timeout confirms a never-exiting program is killed and reported as timed out, well within a bounded test window rather than the real multi-minute default |
| **Cancellation** | Explicit cancellation of a running execution, and of a request still waiting in the queue before any container exists, are both directly exercised |
| **Resource limits** | Verified structurally (the correct limits are passed to container creation) rather than by attempting to actually exhaust memory/CPU in a test run — an intentional choice, since deliberately triggering a resource-limit kill in an automated suite would be slow and flaky relative to the value gained |
| **Cleanup** | Every execution test run is followed by a direct check (`docker ps -a`) confirming zero containers remain — verified repeatedly throughout development, not just once |

### 6.3 How These Tests Improved Confidence

Running this suite against a real Docker daemon (rather than one that was simply unreachable, which had masked real bugs earlier in development — §11.1) is what surfaced the exact, specific defects described in §11 — and, after each fix, re-running the full suite is what confirmed the fix actually held rather than merely seeming plausible. The suite's value is concentrated exactly where this document's philosophy (§1.2) says it should be: proving concurrency- and lifecycle-sensitive behavior, not just happy-path logic.

---

## 7. Interactive Terminal Testing

Full architectural context: [`08_Interactive_Terminal.md`](./08_Interactive_Terminal.md).

| Scenario | What's verified |
|---|---|
| **Session creation** | A session ID is returned; `terminal:ready` fires with the correct payload; an unsupported language is rejected before any container is created |
| **Streaming output** | At least one output event is confirmed to arrive well before a multi-second program would have finished — a direct test of incremental delivery, not just eventual completion |
| **stdin forwarding** | A real round trip: a program that calls `input()`, given a value via simulated `terminal:input`, with its subsequent output confirmed to reflect that value — plus a companion test confirming a *non-owning* simulated connection's input has no effect |
| **Stop execution** | Explicit stop of a running session; idempotent double-stop; and stopping a session still waiting in the queue, before any container exists, confirming no container is ever created in that case |
| **Disconnect cleanup** | Simulating a socket disconnect confirms every session owned by that connection is stopped; a socket with no sessions is confirmed to be a harmless no-op |
| **Concurrent sessions** | Multiple sessions across multiple simulated connections, running simultaneously, are confirmed **not to cross-talk** — each session's captured output contains only its own program's output |

These scenarios are exercised via a lightweight fake-socket harness against the real `executionSession.service.js` logic and a real Docker daemon — the same integration-testing philosophy as §6, applied to the session-based execution model.

---

## 8. Collaboration Testing

Full architectural context: [`05_Collaboration_System.md`](./05_Collaboration_System.md).

### 8.1 Automated Coverage

| Scenario | What's verified |
|---|---|
| **Room hydration (first open)** | A brand-new room correctly seeds from `File.content` |
| **Legitimately empty content** | A genuinely blank file stays empty and is still correctly marked hydrated — confirming "no error" and "not yet hydrated" are never conflated |
| **Reuse of existing state** | A room with already-persisted CRDT state loads it rather than reseeding from `File.content` |
| **Idempotent re-hydration** | Hydrating an already-hydrated room is a safe no-op |
| **Concurrent simultaneous opens** | Two joins racing for the same brand-new room are confirmed to seed content exactly once, not twice |
| **The autosave guard** | `hasDocument()`/room-trustworthiness is confirmed false while hydration is in flight and true only once it resolves |
| **Reconnect/recovery** | A teardown-then-reopen correctly loads the persisted state rather than reseeding it |
| **A full persist/load round trip** | An edit survives a save-then-load cycle exactly |
| **Hydration failure is not cached** | A deliberately-failing hydration attempt is confirmed retryable on the next join, not permanently stuck |
| **The save-path reconciliation fix** | A save is confirmed to correctly replace (not blindly flush) a hydrated room's live content to match what was just persisted |

### 8.2 Manual and Exploratory Verification

Presence, live cursor synchronization, and team chat were verified primarily through **direct, manual multi-browser testing** during development — opening the same project/file in two or more browser sessions and confirming cursors, presence indicators, and chat messages update live and correctly — rather than through automated assertions. This reflects a deliberate prioritization: the highest-risk, most timing-sensitive part of the collaboration system (room hydration and CRDT persistence) has the deepest automated coverage; the more purely visual, lower-risk parts (cursor rendering, presence chips) were validated by direct observation instead.

### 8.3 Conflict Handling

Concurrent-edit convergence itself is not separately re-tested in this codebase beyond what the hydration suite's concurrent-open scenarios exercise — it rests on Yjs's own, independently-proven CRDT guarantees (Collaboration System document §5), which this project consumes rather than re-verifies from first principles.

---

## 9. Error Handling Validation

| Failure scenario | How it was tested |
|---|---|
| **Invalid JWT** (missing, malformed, expired) | Verified via the `authenticate` middleware's behavior across integration tests that exercise protected routes without a valid token |
| **Missing resources** (unknown project/file/snapshot ID) | Covered by service-level error paths returning the expected `404`-class `ApiError` |
| **Docker unavailable** | Directly observed and worked with during an extended period of this project's actual development, when the local Docker daemon genuinely was unreachable — every execution test's failure mode during that period was confirmed to be the expected "infrastructure failure," not a false negative masking a different bug (§11.1) |
| **Gemini unavailable / misconfigured** | The AI provider's lazy client construction and generic error translation (AI Assistant document §6.1, §6.5) were verified by direct invocation without a configured API key, confirming a clean, generic failure rather than a raw SDK error leaking through |
| **Network failures / disconnects** | Exercised directly for the interactive terminal (§7's disconnect cleanup) and observed during the collaboration system's manual multi-browser testing (a tab closed mid-session, confirming lock/presence cleanup) |
| **Backend restart** | Verified by direct observation — restarting the backend process mid-development and confirming the execution queue/active sessions reset cleanly (as designed — Docker Execution Engine document §15) and that CRDT rooms re-hydrate correctly from persisted state on the next join, rather than through an automated restart-simulation test |
| **Invalid API input** | Covered extensively via the validation-error paths in the execution, AI, and auth integration tests (missing/oversized fields, malformed IDs, unsupported languages) |

---

## 10. Manual Testing

### 10.1 Why Manual Testing Remained Important

Automated tests, however thorough, verify what they were explicitly written to check — they do not notice an awkward interaction, a confusing error message, or a UI element that technically renders but is hard to use. Manual, exploratory testing is where this project caught the class of issue automated coverage is structurally unable to: whether the product is actually pleasant and correct to use as a whole.

### 10.2 Exploratory Testing Performed

| Area | What was manually verified |
|---|---|
| **UX validation** | The Run/Stop button's relabeling behavior, the terminal panel's open/collapse/resize interactions, and the AI panel's loading/error states were all directly clicked through during development |
| **Browser behavior** | Real browser console output was checked during the E2E pass (§5.3) specifically for silent errors a passing test could otherwise mask |
| **Responsive layout** | The resizable sidebar/AI-panel/terminal-panel layout (Frontend Architecture document §17) was manually resized and observed across different panel-size combinations |
| **Edge cases** | Empty files, very long single lines, and rapid repeated Run clicks were exercised manually to probe for UI-state edge cases not covered by the backend-focused automated suites |
| **Long-running sessions** | An interactive session left running for an extended period (well beyond a typical quick test) was manually observed to confirm streaming, memory behavior, and eventual timeout/cleanup all behaved as expected over real elapsed time, not just in a compressed test window |

### 10.3 Early Development Scratch Scripts

During the execution engine's earliest development — before the automated `node --test` suites existed — small, throwaway Node scripts were used to manually exercise the Docker integration directly (creating a workspace, running a "Hello World" Java program, confirming a container's basic lifecycle) before any formal test suite existed to encode those checks repeatably. These scripts remain in the repository as a historical record of that exploratory phase; they are not part of the maintained, repeatable test suite (§12).

---

## 11. Bugs Discovered During Development

This section covers defects **found through testing specifically** (as opposed to found through code review or design discussion) — each with the problem, how it was actually discovered, its resolution, and the lesson drawn from it. Full technical detail for the Docker-related races is in the Docker Execution Engine document §14; this section focuses on the discovery process itself.

### 11.1 The Docker AutoRemove Race

- **Problem:** Containers configured to self-remove on exit could be fully reaped by the daemon before the code asking for their exit status ever got there.
- **How it was discovered:** Not by code review — by running the automated execution test suite against a **real, reachable** Docker daemon for the first time in a while (earlier testing had Docker unreachable, which produced a different, misleadingly uniform failure that masked this entirely). The failure pattern was specific and reproducible: every *fast-exiting* execution (a one-line script, a near-instant compile error) failed with a 404; every *slower* one passed.
- **Resolution:** Registering the exit-status wait before starting the container, with the correct wait condition (Docker Execution Engine document §14.1).
- **Lesson learned:** A test environment where a dependency is simply *unreachable* can hide a completely different, real timing bug that only manifests when that dependency is actually *working* — "the tests pass" and "the tests pass against a functioning dependency" are not the same claim.

### 11.2 The Output-Ordering Race

- **Problem:** Once the fix above made exit-status retrieval fast enough to win the AutoRemove race, some fast executions began returning the correct exit code paired with **empty** captured output.
- **How it was discovered:** Immediately upon re-running the same automated suite after the fix above — a regression the very next test run caught, not a separately hunted-for issue.
- **Resolution:** Waiting for both the exit status **and** a signal that the attached output stream had actually finished, bounded by a short grace period (Docker Execution Engine document §14.1).
- **Lesson learned:** Fixing one race can unmask a second, previously-hidden one — re-running the full suite after every fix (not just spot-checking the specific case just fixed) is what caught this one immediately rather than letting it ship.

### 11.3 The Self-Inflicted Stream-Hang Bug

- **Problem:** An initial attempt at the fix in §11.2 waited on the wrong stream object, one that is only ever written to and never explicitly closed by the demultiplexing library in use.
- **How it was discovered:** The exact same automated suite, run immediately after this change, went from passing to **hanging entirely** — every single execution, including ones that should have failed fast on a timeout, never completed.
- **Resolution:** Waiting on the correct, raw underlying stream, which the daemon does properly close.
- **Lesson learned:** A test suite that reliably completes in a known amount of time is itself a diagnostic — a suite that starts hanging is telling you something specific and urgent, and re-running tests after every change (not just once at the end) is what turned this from a shipped regression into an immediately-caught one.

### 11.4 The xterm.js Mounting Issue

- **Problem:** The interactive terminal's frontend component failed to actually initialize the xterm.js library when the terminal panel started in its default, collapsed state.
- **How it was discovered:** Not by any backend test — every single automated test for session creation, streaming, stdin, stop, disconnect, and timeout passed completely. It was found by the Playwright end-to-end pass (§5), specifically by taking a screenshot after opening a file and clicking Run and observing an empty terminal area despite the panel's own status indicator showing an active, running session.
- **Resolution:** Keeping the terminal's container element always present in the DOM and toggling visibility with CSS rather than conditional mounting (Interactive Terminal document §14.2).
- **Lesson learned:** This is the single clearest, most concrete argument in this entire project for why browser-driven end-to-end verification is a necessary complement to automated backend testing, not an optional nicety — a fully correct backend, proven by a thorough and entirely passing test suite, was still invisible to a real user until someone actually looked at the rendered page.

### 11.5 Queue-Related Behavior — Validated, Not "Discovered as Broken"

Unlike the four defects above, the execution queue's handling of a session stopped while still waiting for a slot (Docker Execution Engine document §7, Interactive Terminal document §4.1) was identified as a *risk* through reasoning about the design, and a test was written specifically to confirm the guard added for it worked correctly — this is testing validating a deliberately-added safeguard, not testing uncovering a live defect, and is recorded here as a distinct category deliberately, so this section doesn't overstate every safeguard as having been "found broken first."

---

## 12. Testing Tools

| Tool | Role | Notes |
|---|---|---|
| **Node's built-in `node:test` runner** | Every automated backend test in this project (execution, sessions, API, CRDT) | Chosen specifically because it required zero additional dependency and gave first-class `async`/`await` support — no Jest, Mocha, or similar framework is installed or used |
| **Docker (real daemon)** | The dependency every execution- and session-related test runs against directly | Not mocked, deliberately (§1.2) |
| **MongoDB** | The real database the CRDT hydration/persistence tests run against | Not mocked, for the same reason |
| **Playwright** | The one deep, real-browser E2E verification pass (§5) | Installed and used ad hoc for that pass; not a committed project dependency or a routinely-run suite today |
| **Browser Developer Tools** | Manual inspection of console output, network requests, and rendered DOM state throughout development and specifically during the E2E pass | Used directly, not through any automated harness |
| **`fetch` / Node's HTTP client** | Driving real HTTP requests against a real Express app bound to an ephemeral port, for API integration tests | A deliberate choice over a request-mocking library like Supertest — not currently used in this project |
| **`docker ps -a`** | Direct, manual (and test-embedded) verification that zero containers remain after a test run | The concrete check behind every "no orphaned containers" claim made throughout this documentation series |

**Tools explicitly not used in this project**, despite being common choices for similar work: Jest, Mocha, Supertest, Chai, Sinon, Cypress, and Postman. None are installed as dependencies or referenced anywhere in the codebase.

---

## 13. Continuous Quality Practices

| Practice | Current state |
|---|---|
| **Regression testing** | The full automated suite (execution + sessions + API + CRDT) is re-run after every change to the subsystems it covers — this is exactly the practice that caught the regression in §11.2 and the hang in §11.3 within one run each |
| **Smoke testing** | The health endpoint (Docker Execution Engine document §9.3) serves as an on-demand smoke check of the execution engine's real runtime state; there is no separate, scripted smoke-test suite beyond it |
| **Feature validation** | Each major feature (execution, interactive terminal, AI, collaboration) was manually exercised end-to-end at the point it was built, in addition to whatever automated coverage exists for it |
| **Code reviews** | Not currently a formalized, multi-person process (this is presently a single-developer project) — design and implementation decisions are reasoned through and documented (as in this documentation series) rather than reviewed by a second engineer |
| **Manual verification before merge** | Every subsystem's automated suite (where one exists) is run, and the affected feature is manually exercised, before considering a change complete — informal, but consistently applied throughout this project's development |
| **Future CI/CD integration** | Not yet implemented — see §14 |

---

## 14. Future Improvements

| Improvement | What it would add |
|---|---|
| **Higher automated coverage** | Formal integration tests for authentication as its own isolated suite (currently only exercised indirectly — §4.1), and for collaboration features beyond hydration (presence, cursors, chat — currently manual, §8.2) |
| **A maintained, repeatable E2E suite** | Formalizing the one-off Playwright pass (§5) into a committed, re-runnable suite covering login, project/file management, AI, and collaboration journeys, not just the interactive terminal |
| **Performance testing** | No dedicated performance-benchmarking suite exists today (e.g. measuring execution queue throughput or CRDT sync latency under sustained load) |
| **Load testing** | No test currently simulates many concurrent users/executions/sessions at a realistic scale — today's concurrency-safety tests (§6, §7) use a small, fixed number of simultaneous operations to prove correctness, not to characterize behavior under real load |
| **Security testing** | No dedicated penetration-testing or automated security-scanning pass has been performed; security properties (Authentication document §11, Docker Execution Engine document §12) are currently verified by design review and targeted functional tests (e.g. session ownership), not by adversarial testing |
| **Accessibility testing** | No formal accessibility audit exists yet (Frontend Architecture document §17.3 notes this as a known gap) |
| **CI pipelines** | Tests are currently run manually/on demand rather than automatically on every commit or pull request — a real CI pipeline (running the full automated suite, including against a real Docker daemon) is a concrete, realistic near-term improvement |
| **Mutation testing** | Not currently used — would help validate that the existing automated suite's assertions are actually strict enough to catch a deliberately introduced defect, rather than only confirming they pass against the current implementation |

---

## 15. Conclusion

Code Ground's testing strategy is deliberately uneven in emphasis, and that unevenness is itself the point: the deepest, most rigorous, real-dependency-backed automated coverage exists exactly where this project's actual engineering risk lives — Docker container lifecycle timing and CRDT room hydration — because those are the two places a subtle, timing-dependent defect could silently reach production. Everything else (broader UI flows, presence/cursor rendering, most of authentication) leans more heavily on direct manual verification, a deliberate allocation of limited testing effort rather than an oversight.

The project's clearest, most concrete lesson about testing itself is the xterm.js mounting defect (§11.4): a completely correct, thoroughly-tested backend that was nonetheless invisible to a real user, caught only because someone opened the actual application in an actual browser and looked. That single result is the strongest evidence in this project for a principle worth carrying forward into any future work: a green test suite is a claim about the scenarios it was written to check, never a substitute for actually using the thing you built.

---

*This document should be revisited as the Future Improvements in §14 are implemented — in particular, adding a CI pipeline or a maintained E2E suite would change several claims made throughout this document about what is one-time versus routinely repeated.*
