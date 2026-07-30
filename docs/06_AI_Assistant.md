# Code Ground — AI Assistant Subsystem

> **Scope of this document:** A complete explanation of the AI Assistant as its own software component — its architecture, request lifecycle, prompt engineering, Gemini integration, and the engineering decisions behind it. This document does not explain unrelated features (auth, collaboration, execution); those are referenced only where the AI subsystem actually touches them (e.g. project/file authorization).
>
> Companion documents: [`01_System_Architecture.md`](./01_System_Architecture.md) §9 and [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) §12 introduced this subsystem at the whole-system level. This document is the authoritative, detailed reference for it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [AI Architecture](#2-ai-architecture)
3. [AI Features](#3-ai-features)
4. [Request Lifecycle](#4-request-lifecycle)
5. [Prompt Engineering](#5-prompt-engineering)
6. [Gemini Integration](#6-gemini-integration)
7. [Response Processing](#7-response-processing)
8. [User Experience](#8-user-experience)
9. [Security](#9-security)
10. [Performance](#10-performance)
11. [Error Handling](#11-error-handling)
12. [Design Decisions](#12-design-decisions)
13. [Testing Strategy](#13-testing-strategy)
14. [Future Improvements](#14-future-improvements)
15. [Conclusion](#15-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the AI Assistant

The AI Assistant gives every user of Code Ground a programming collaborator that is always grounded in exactly what they're looking at — the real content of the file currently open, their actual selection, and the real conversation so far — rather than a generic chatbot the user has to manually paste code into. It exists to answer questions, explain code, catch problems, suggest improvements, and write new code, all without the user ever leaving the editor.

### 1.2 Why AI Was Integrated Into Code Ground

A cloud IDE that only edits and runs code is missing the layer developers increasingly rely on: a second set of eyes that understands the code well enough to explain it, review it, or extend it on request. Integrating this directly into the editor — rather than leaving it as an external tool the user copies code into and out of — is what makes it part of the *workflow* rather than a separate errand.

### 1.3 Design Goals

| Goal | What it means here |
|---|---|
| **Grounded, not generic** | Every request carries the real file/selection/project context — the assistant is never asked to reason about code it can't actually see |
| **Multiple sharp tools, not one blunt one** | Five distinct capabilities (§3), each with its own instructions and expected output shape, rather than one open-ended "ask the AI anything" box |
| **Isolated and swappable** | Nothing outside the AI subsystem knows which model provider is in use (Backend Architecture document §12.3) |
| **Simple and stateless** | No server-side conversation memory to manage, secure, or scale (§6.4, §10) |
| **Honest about uncertainty** | The assistant is explicitly instructed to say when it doesn't have enough information, rather than confidently inventing an answer (§5.2) |

### 1.4 User Experience Objectives

- The assistant should feel like **part of the editor**, not a separate app — reachable from a panel beside the code, not a new browser tab.
- Every response should be **immediately actionable** — code in fenced, language-tagged blocks; reviews structured so a specific issue can be found and acted on; generated code complete rather than a stub.
- A slow or failed AI call should **never affect anything else** the user is doing (editing, collaborating, running code) — a direct consequence of the stateless, isolated design described throughout this document.

---

## 2. AI Architecture

```
                              ┌───────────────┐
                              │      User        │
                              └───────┬───────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   Frontend AI Panel          │
                         │  (chat history rendering,     │
                         │   the 5 action triggers,        │
                         │   loading/error state)            │
                         └───────────┬─────────────┘
                                      │  REST (one round trip per request)
                                      ▼
                         ┌─────────────────────────┐
                         │         REST API              │
                         │  /api/ai/chat|explain|review|   │
                         │       refactor|generate           │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │       AI Controller            │
                         │  thin — pulls req.body +          │
                         │  req.user.id, calls one service     │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │   Capability Service           │
                         │  (chat / explain / review /       │
                         │   refactor / generate)              │
                         └───────────┬─────────────┘
                                      │
                    ┌─────────────────┼─────────────────────┐
                    ▼                                       ▼
        ┌─────────────────────┐                 ┌─────────────────────┐
        │   AI Context Builder    │                 │    Prompt Builder        │
        │  authorize (project        │                 │  system instruction         │
        │  membership, file            │                 │  + built context             │
        │  ownership) + fetch the        │                 │  ──▶ ONE final prompt          │
        │  live file/project state          │                 │  string                            │
        └───────────┬─────────────┘                 └───────────┬─────────────┘
                    └─────────────────┬─────────────────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │        AI Executor             │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │      Provider Factory          │
                         │  (resolves "gemini" — the         │
                         │   one seam a new provider           │
                         │   would be added behind)              │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │      Gemini Provider           │
                         │  (the ONLY module that              │
                         │   imports @google/genai)              │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │        Gemini API              │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │    Response Processing         │
                         │  extract text, translate any      │
                         │  SDK error into a clean, generic     │
                         │  ApiError (§11)                        │
                         └───────────┬─────────────┘
                                      ▼
                         ┌─────────────────────────┐
                         │         Frontend                │
                         │  (rendered via a Markdown          │
                         │   renderer into the chat panel)     │
                         └─────────────────────────┘
```

Two architectural facts fall out of this diagram: **every request re-derives its own context from scratch** (nothing about a prior request is remembered server-side — §6.4), and **exactly one module in the entire codebase (`geminiProvider`) is allowed to import the Gemini SDK** — every other part of the AI subsystem, and everything outside it, only ever calls the provider factory by name.

---

## 3. AI Features

All five capabilities share one request shape, one context-building step, and one response-handling path — they differ only in their system instruction (§5) and, for Chat, in what "the user's request" conceptually means (a running conversation, rather than a one-off instruction).

### 3.1 AI Chat

- **Purpose:** open-ended, conversational questions about the current file/project.
- **User workflow:** type a question in the AI panel; the assistant answers using the current file's content and the conversation so far.
- **Benefits:** the lowest-friction way to ask "why does this work this way" or "how would I add X" without leaving the editor.
- **Typical use cases:** understanding an unfamiliar codebase, brainstorming an approach before writing code, asking follow-up questions about a previous Explain/Review response.

### 3.2 Code Explain

- **Purpose:** explain what a piece of code does.
- **User workflow:** select code (or leave nothing selected to target the whole file) and trigger Explain.
- **Benefits:** fast onboarding to unfamiliar code, and a sanity check on whether code actually does what the author intended.
- **Typical use cases:** understanding a teammate's collaborative edit, revisiting old code, verifying a generated/refactored snippet's actual behavior.

### 3.3 Code Review

- **Purpose:** a structured, pull-request-style review of code for correctness, readability, performance, security, scalability, and unhandled edge cases.
- **User workflow:** select code (reviews only the selection, with the rest of the file available as reference context) or leave nothing selected (reviews the whole file); trigger Review.
- **Benefits:** a second pair of eyes available on demand, with a consistent, scannable structure (Overall Assessment → Strengths → Issues Found → Summary) rather than free-form prose.
- **Typical use cases:** a pre-commit sanity check, reviewing AI-generated or refactored code before accepting it, catching issues before a real human reviewer sees them.

### 3.4 Refactor

- **Purpose:** suggest an improved version of existing code without changing its behavior.
- **User workflow:** select the code to refactor (or target the whole file) and trigger Refactor.
- **Benefits:** concrete, applicable improvements rather than abstract advice — the same "ground everything in what's actually there" discipline as Review, applied to producing a rewritten version instead of a critique.
- **Typical use cases:** cleaning up code before a merge, modernizing an older pattern, simplifying something that grew organically.

### 3.5 Code Generation

- **Purpose:** write new code from a natural-language instruction.
- **User workflow:** describe what's needed in the AI panel (optionally with relevant code selected as style/context); trigger Generate.
- **Benefits:** a complete, non-stubbed starting point that already matches the surrounding file's language and conventions, rather than a generic snippet needing adaptation.
- **Typical use cases:** scaffolding a new function/component, writing a test, implementing a well-specified small feature.

---

## 4. Request Lifecycle

### 4.1 Sequence Diagram

```
 User            Frontend (useAI)         REST API           Capability Service      Gemini
   │                    │                     │                      │                  │
   │  trigger an action    │                     │                      │                  │
   │  (Chat/Explain/etc.)     │                     │                      │                  │
   │ ─────────────────────▶ │                     │                      │                  │
   │                    │  show "thinking"          │                      │                  │
   │                    │  placeholder message         │                      │                  │
   │                    │  POST /api/ai/<action>          │                      │                  │
   │                    │  { projectId, fileId,              │                      │                  │
   │                    │    selectedCode, fileContent,        │                      │                  │
   │                    │    userPrompt, chatHistory }            │                      │                  │
   │                    │ ─────────────────────────▶ │                      │                  │
   │                    │                     │  validate request body      │                  │
   │                    │                     │  (§9)                          │                  │
   │                    │                     │  authenticate() ──▶ req.user     │                  │
   │                    │                     │ ───────────────────▶ │                  │
   │                    │                     │                      │  authorize:        │
   │                    │                     │                      │  project member?      │
   │                    │                     │                      │  file in project?        │
   │                    │                     │                      │  (§9)                      │
   │                    │                     │                      │  build context +             │
   │                    │                     │                      │  final prompt (§5)             │
   │                    │                     │                      │ ───────────────────▶ │
   │                    │                     │                      │                      │  model call
   │                    │                     │                      │  extracted text          │
   │                    │                     │                      │ ◀───────────────────  │
   │                    │  { success: true,       │  { success: true,       │                      │
   │                    │    response }               │    response }               │                      │
   │                    │ ◀───────────────────────── │ ◀─────────────────── │                  │
   │  response rendered      │                     │                      │                  │
   │  in the chat panel         │                     │                      │                  │
   │ ◀───────────────────── │                     │                      │                  │
```

### 4.2 Notes

- **One HTTP round trip, start to finish** — there is no intermediate streaming or polling; the entire lifecycle above completes (or fails) as a single request/response cycle.
- **Authorization happens before any prompt is built** (§9) — an unauthorized request never reaches Gemini at all, and never incurs the cost of a model call.
- **The "thinking" placeholder is purely a frontend UI state** (§8) — the backend has no concept of a partial/in-progress response to report back.

---

## 5. Prompt Engineering

### 5.1 Why Prompt Engineering Matters Here

A general-purpose model given a bare "explain this code" instruction will happily explain code that doesn't exist, invent APIs it assumes are present, or answer confidently when the actual context given to it was too thin to justify confidence. Because Code Ground's AI features are embedded in a real, high-stakes context (actual project code, shown to a developer who will act on the answer), the prompts are engineered specifically to suppress exactly those failure modes, not just to phrase a question politely.

### 5.2 The Shared Base Instruction

Every one of the five capabilities' prompts is built by prepending the **same shared base instruction** to a capability-specific addendum, rather than each capability re-stating its own formatting and accuracy rules independently. The base instruction fixes:

| Rule category | What it enforces |
|---|---|
| **Priorities** | Correctness first, then clarity, safety, maintainability, and modern best practices — an explicit ordering, not an unranked list |
| **Response style** | Markdown formatting; headings for longer answers; fenced code blocks with an explicit language tag; concise by default, detailed only when the request calls for it |
| **Accuracy rules** | Never invent APIs, libraries, files, functions, or project structure not actually shown; if the given context is insufficient, say exactly what's missing instead of guessing; state uncertainty explicitly rather than presenting a guess as fact |

This shared foundation is what keeps all five capabilities feeling like one coherent assistant rather than five differently-behaved tools, and centralizes the single most important safety property (never fabricate what wasn't shown) in exactly one place.

### 5.3 Context Gathering

Before any prompt is built, the backend assembles a **context object** carrying: the project's name, the file's name and its live content, the user's current selection (or an explicit "None"), the resolved programming language, the user's own instruction/question, and — for Chat specifically — the prior conversation turns. Critically, **the file content used is the live editor buffer the frontend sends with the request, not the last explicitly-saved copy** — the product's promise is that the assistant sees every edit as it happens, not only what's been saved, so a stale on-disk version is only ever used as a fallback if no live buffer was supplied at all.

### 5.4 Code Inclusion and Language Awareness

The built context always includes the file's resolved language explicitly, and every capability's addendum instructs the model to match that language in anything it generates or suggests — code inclusion is never presented to the model as opaque, unlabeled text; it always arrives tagged with what it actually is.

### 5.5 Instruction Formatting — One Flat Prompt, Not a Message Array

Unlike some chat-style integrations that send a structured list of role-tagged messages, Code Ground's prompt builder assembles **one single flat text prompt** per request: the system instruction, followed by clearly-labeled sections for Project, Language, File, Selected Code, Current File Content, Previous Chat (serialized as text), and the User Request — concatenated into one string and sent as a single call to the model. Conversation continuity for Chat is achieved by literally including prior turns as text inside this one prompt, not by a stateful, multi-turn API session.

### 5.6 Response Expectations Per Capability

Beyond the shared base rules, each capability's addendum sets **explicit expectations for the shape of the response**:

| Capability | Expected response shape |
|---|---|
| **Chat** | Free-form, conversational — answer the latest message directly, using prior turns only for continuity |
| **Explain** | A direct explanation targeted at whatever's selected (or the whole file if nothing is) |
| **Review** | A fixed Markdown structure: Overall Assessment → Strengths → Issues Found (one subsection per issue, each explaining *why* it matters and a concrete fix) → Summary — with an explicit instruction to omit sections that don't apply rather than padding them out |
| **Refactor** | The improved code, matching the original's language/style, with behavior preserved |
| **Generate** | A fixed Markdown structure: a single fenced Code block, followed by an optional Explanation section (skippable if the code is trivial enough to be self-explanatory) |

Fixing the expected shape per capability is what makes responses **predictable and scannable** on the frontend — the Markdown renderer and the surrounding UI can rely on a Review response looking like a review and a Generate response leading with a code block, without needing to parse free-form text to find the part that matters.

### 5.7 Ground Rules Against Fabrication (Capability-Specific Reinforcement)

Review and Generate both explicitly reinforce the base prompt's anti-hallucination rule in their own terms — Review is told not to invent problems that aren't traceable to the actual code shown, and to say plainly when code is already solid rather than manufacturing nitpicks; Generate is told not to invent project files, dependencies, or APIs beyond what was shown or explicitly requested. This repetition at the capability level, on top of the shared base rule, reflects that fabrication is the single highest-risk failure mode for an assistant embedded in a real development workflow — worth stating more than once, in the specific terms most relevant to each capability.

---

## 6. Gemini Integration

### 6.1 API Communication

Exactly one module in the codebase constructs a Gemini client and calls the model — every capability service reaches it only through the AI Executor and Provider Factory (§2), never by importing the SDK directly. The client itself is constructed **lazily**, on first actual use, rather than at process startup: a missing or invalid API key therefore fails only the specific AI request that needed it, not the entire backend at boot. This is a deliberate, different choice from the execution engine's Docker dependency (Backend Architecture document §4.6), which *does* fail the whole boot fast — because AI is a supplementary capability of the platform, while code execution is a core one; the two dependencies warrant different startup-failure philosophies.

### 6.2 Request Formatting

The single flat prompt string built in §5 is sent as the model's input content, alongside a resolved model name (currently a fast, cost-efficient Gemini variant chosen deliberately for an interactive, in-editor experience rather than a slower, heavier one) and an optional configuration object for future model-level tuning.

### 6.3 Response Parsing

The SDK's response is reduced to its plain text content before it ever leaves the provider module — no capability service or controller touches the raw SDK response shape, which is what keeps a future provider swap from requiring changes anywhere outside this one module.

### 6.4 Why Interactions Are Stateless

The backend holds **no server-side conversation memory** between AI requests, for any capability. Every request is self-contained: whatever conversational context a request needs is sent by the client, from the client's own state, on every single call (§5.5). This has two direct consequences: any backend instance can serve any AI request with zero session affinity requirement, and a slow, failed, or malformed response to one request can never corrupt or block a different request's context, because there is no shared context between them to corrupt.

### 6.5 Error Handling at the Integration Boundary

Any failure from the Gemini SDK itself — a rate limit, an invalid key, a content-safety block, a network failure — is caught inside the provider module and translated into one clean, generic, user-facing error, rather than letting the raw SDK error object/shape propagate up through the capability service and controller. This is what guarantees the AI subsystem's failures look exactly like every other backend error to the client (§11), regardless of how varied Gemini's own failure modes are.

### 6.6 Why Gemini Was Chosen

| Consideration | Why it favored Gemini |
|---|---|
| **API maturity and an official Node SDK** | `@google/genai` provides a straightforward, well-documented client, reducing integration risk |
| **Latency-appropriate model tiers** | A fast model variant fits an interactive, in-editor assistant better than a larger, slower one optimized purely for maximum quality |
| **Provider abstraction makes this a reversible choice** | Because nothing outside `geminiProvider` depends on Gemini specifically (§2), this decision is not architecturally locked in — see §14 |

---

## 7. Response Processing

### 7.1 Formatting and Markdown

Every capability's prompt instructs the model to respond in Markdown (§5.2), and the frontend renders that response through a small, purpose-built Markdown renderer sized to exactly what AI responses need (headings, emphasis, lists, and fenced code blocks) rather than a full general-purpose Markdown engine.

### 7.2 Code Blocks

Because the base prompt requires every code block to be fenced with an explicit language tag, the renderer can apply language-aware syntax highlighting directly from the response text itself, with no separate language-detection step needed on the frontend.

### 7.3 Validation

The backend does not attempt to semantically validate a model's response (e.g. parsing generated code to confirm it compiles) — the response is treated as opinionated, human-readable text to be rendered and left for the user to judge, consistent with the base prompt's own instruction that the model state uncertainty rather than the platform trying to programmatically catch every possible inaccuracy after the fact.

### 7.4 Error Responses

A failure anywhere in the pipeline (authorization, context building, or the Gemini call itself) is surfaced to the frontend as a normal error response shape (§11) — the AI panel renders it as an inline error on the specific message that failed, not a full-page failure.

### 7.5 Rendering

The rendered response replaces the "thinking" placeholder message in the chat panel in place — from the user's perspective, the same message simply transitions from a loading state to its final content (or an error state), rather than a new message appearing separately.

---

## 8. User Experience

### 8.1 Loading States

The moment a user triggers any of the five actions, an empty assistant message is inserted into the conversation immediately, marked as "thinking" — giving instant visual feedback that the request was received, well before the (potentially several-second) model call actually completes.

### 8.2 Streaming — Not Currently Implemented

Responses arrive as a single, complete JSON payload, not token-by-token. This is a deliberate scope decision (see §12 and §14), not an oversight: it keeps the request lifecycle (§4) simple — one request, one response, no partial-message state to reconcile on the frontend — at the cost of the user seeing nothing until the entire response is ready, rather than watching it appear incrementally the way many chat products do.

### 8.3 Retry Handling

A failed AI message can be retried individually, re-sending the same request — retries are scoped to the one message that failed, not the whole conversation, so a transient failure never requires the user to reconstruct their question.

### 8.4 Error Messages

Errors are rendered inline, on the specific message, with the generic-but-clear text the backend already translated Gemini's failure into (§6.5) — never a raw stack trace or SDK error code surfaced to the user.

### 8.5 Usability Considerations

- Selecting code before triggering Explain/Review/Refactor is the natural, low-friction way to scope an action to exactly the code in question, rather than requiring the user to describe *which* code they mean.
- A consistent, predictable response shape per capability (§5.6) means a user learns once what a Review or a Generate response will look like, and can scan it the same way every time.

---

## 9. Security

| Concern | Mechanism |
|---|---|
| **API key protection** | The Gemini API key lives only in centralized backend environment configuration (Backend Architecture document §5), read once by the lazily-constructed client — it is never sent to, or reachable from, the frontend |
| **Backend proxying** | The frontend never calls Gemini directly; every request is proxied through the backend's own REST endpoints, which is what makes centralized authorization, key protection, and error translation possible in the first place |
| **Authorization before any model call** | Every AI request is checked against real project membership and confirms the referenced file actually belongs to the referenced project (§4.2, verified in `aiContextBuilder`) — an authenticated-but-unauthorized request never reaches prompt construction or Gemini, and never incurs a model-call cost |
| **Input validation** | `projectId`/`fileId` must be valid identifiers; `userPrompt` is required and capped at 8000 characters; `selectedCode`/`fileContent` are validated as strings and `chatHistory` as an array, before any of it is used to build a prompt |
| **Prompt safety** | The base system instruction itself is a safety mechanism as much as a quality one — instructing the model never to fabricate information reduces the risk of confidently-wrong output being acted on as if it were verified fact |
| **Rate limiting** | Not currently applied specifically to AI routes — `express-rate-limit` is part of the dependency stack platform-wide (Backend Architecture document §17) but consistent enforcement on the AI endpoints specifically (which carry a real per-request cost against the Gemini API) is an honestly-flagged gap rather than a claimed guarantee |
| **Sensitive data considerations** | Whatever code/content a user includes in a request is sent to a third-party model provider (Gemini) as part of normal operation — this is an inherent property of any cloud-AI-assisted editor, not something this subsystem specifically mitigates beyond the access control above (i.e. only a project's own authorized members can trigger a request that includes that project's code) |

---

## 10. Performance

| Concern | Approach / current state |
|---|---|
| **Request latency** | Dominated by the single Gemini API call itself; a fast model variant (§6.6) was chosen specifically to keep this acceptable for an interactive, in-editor experience |
| **Response size** | Unbounded on the response side beyond whatever the model itself produces — capability prompts (§5.6) constrain *shape*, not length, so an unusually long response is possible though not the common case |
| **Stateless design as a performance property** | Because no server-side conversation state exists (§6.4), the AI subsystem has effectively zero standing memory cost between requests, and no cross-request contention to manage |
| **Scalability** | Any backend instance can serve any AI request — there is no session affinity requirement, so this subsystem scales exactly as well as the rest of the stateless REST API scales (Backend Architecture document §19) |
| **Caching possibilities** | Not currently implemented — every request, even a repeated identical one, triggers a fresh model call; see §14 |
| **Concurrency considerations** | Unlike the Docker execution engine (Backend Architecture document §11), AI requests are **not** gated by a concurrency queue today — each request is handled independently, with the Gemini API's own rate limits (surfaced as a translated error, §6.5, §11) as the only current backpressure signal |
| **Context size** | There is currently no token counting or truncation step before a prompt is sent (the codebase carries a placeholder for this that is not yet implemented) — a very large file's full content, included verbatim in the prompt (§5.3), could in principle approach or exceed a model's effective context window with no explicit safeguard today; a real, honestly-flagged limitation rather than a solved problem (see §14) |

---

## 11. Error Handling

| Failure | Handling |
|---|---|
| **API failures** (Gemini rejects the request, an invalid key, a content-safety block) | Caught in the provider module and translated into one generic, user-facing error — never the raw SDK error shape |
| **Timeouts** | A slow or hanging Gemini call surfaces as the same translated failure path once the underlying call rejects; there is no AI-specific client-side timeout layered on top today beyond whatever the SDK/transport itself enforces |
| **Malformed responses** | Response handling extracts plain text and does not assume a specific internal structure beyond that — there is little surface area for a "malformed" response to manifest as anything other than an unhelpful (but still renderable) piece of text |
| **Rate limits** | Surfaced through the same generic translated-error path as any other Gemini-side failure (§6.5) — the user sees a "temporarily unavailable, try again" message rather than a rate-limit-specific one |
| **Fallback behavior** | None beyond surfacing the error — there is no automatic retry or fallback to a different model/provider today (see §14) |
| **User feedback** | Every failure, regardless of its underlying cause, reaches the user as a clear, non-technical inline error on the specific message that failed (§8.4), consistent with the platform-wide centralized error handling described in the Backend Architecture document §16 |

---

## 12. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why Gemini** | A mature API with an official Node SDK and model tiers appropriate for an interactive, in-editor assistant | Fast responses at reasonable cost for a fast model tier; straightforward integration | Ties current behavior/pricing to one vendor's models — mitigated by the provider abstraction below |
| **Why backend mediation (no direct frontend-to-Gemini calls)** | The API key must never reach client-side code, and every request needs the same authorization check applied uniformly | Centralized key protection, authorization, and error translation in one place | An extra network hop (frontend → backend → Gemini) versus a direct call — negligible relative to the model call's own latency |
| **Why stateless AI (no server-side conversation memory)** | Matches the platform's broader stateless-where-possible design (Backend Architecture document); avoids the complexity and failure surface of managing per-user conversation state server-side | Trivial horizontal scalability; a failed request can never corrupt a different request's context | The client is responsible for resending whatever context it wants remembered — a page refresh naturally loses conversation history, an accepted simplicity trade |
| **Why prompt templates (a shared base + per-capability addendum)** | Five capabilities need consistent formatting/safety rules but different task instructions and output shapes | One place to fix a shared rule (e.g. the anti-hallucination instruction) that automatically applies to all five; predictable, capability-specific response shapes | Changing a capability's behavior requires editing its specific prompt file with care not to contradict the shared base instruction |
| **Why five distinct tools instead of one open-ended prompt box** | A single generic "ask anything" interface would leave the model guessing at what shape of answer is wanted, and would leave the UI unable to render anything more structured than plain prose | Predictable, purpose-fit responses per action (a Review looks like a review); clearer UX affordances (select code, click Review) than describing intent in free text every time | More prompt-engineering and UI surface to build and maintain than a single generic box would have required |
| **Why a provider factory/abstraction rather than calling the Gemini SDK directly from each capability** | The specific model provider is an implementation detail, not something every capability should need to know about | A future second provider (or a provider selectable per-request) is additive — a new module behind the factory, not a rewrite | A small amount of indirection for a system that, today, only ever resolves to one provider |

---

## 13. Testing Strategy

### 13.1 What Was Verified and How

| Category | Approach |
|---|---|
| **Manual testing** | Each of the five capabilities was exercised directly against real project files and selections, confirming the response shape matches what each prompt specifies (§5.6) and that context (file content, selection, language) is actually reflected in the answer |
| **Prompt validation** | Prompts were iterated against real code samples to check for the specific failure mode they're most designed to prevent — fabrication (inventing APIs/files not shown) — confirming the base prompt's accuracy rules actually suppress it in practice, not just in wording |
| **Feature testing** | Each capability's mode-selection logic (selection vs. whole-file for Explain/Review/Refactor; instruction-driven vs. context-fitting for Generate) was verified against both branches of that logic |
| **Failure testing** | Authorization failures (a request for a project the user isn't a member of, or a file that doesn't belong to the stated project) and validation failures (missing/oversized `userPrompt`, malformed IDs) were confirmed to be rejected before any model call is made |
| **Regression testing** | Adding a new capability (e.g. Generate, added after Chat/Explain/Review/Refactor already existed) was verified not to require any change to the context builder, prompt builder, executor, or provider factory — confirming the abstraction boundaries described in §2 hold in practice, not just on paper |

### 13.2 Why This Verification Approach Fits This Subsystem

Unlike the execution engine (where automated tests against a real Docker daemon are the right tool, because the bugs that matter there are deterministic container-lifecycle races — Collaboration System document §17), the AI subsystem's highest-risk properties — response *quality*, groundedness, and the absence of fabrication — are not naturally expressed as a deterministic pass/fail assertion against a live third-party model. Verification here is therefore concentrated on what **is** deterministically testable (authorization, validation, mode-selection branching, the abstraction boundaries staying clean when a new capability is added) while prompt quality itself is validated by direct inspection against real inputs rather than automated assertions on model output.

---

## 14. Future Improvements

| Improvement | What it would add |
|---|---|
| **Conversation memory (server-side)** | Persisting chat history server-side (rather than the client resending it every time) would let a conversation survive a page refresh and reduce request payload size for long conversations — at the cost of reintroducing the state-management complexity §6.4 currently avoids |
| **Streaming responses** | Token-by-token rendering (§8.2) would improve perceived latency for longer responses, at the cost of a materially more complex request lifecycle (partial-message state, cancellation mid-stream) |
| **Multiple model providers** | The provider factory (§2, §12) already has the seam for this — adding a second provider is additive, not a rewrite |
| **Model selection (per-request or per-user)** | Letting a user trade off speed vs. quality (or cost) per request, building directly on the existing provider/model configuration already passed through the executor |
| **Context-aware project indexing** | Today, context is exactly one file plus a selection (§5.3) — indexing an entire project so the assistant can answer questions spanning multiple files would be a substantial but natural extension of the existing context-builder pattern |
| **RAG (Retrieval-Augmented Generation) integration** | Retrieving only the most relevant snippets from a large, indexed project (rather than always sending one full file) would let AI features scale to projects much larger than fits comfortably in a single prompt (see §10's context-size limitation) |
| **Semantic code search** | A natural companion to project indexing — "find where X is handled" as its own AI-assisted capability, reusing the same underlying index RAG would require |
| **Embeddings** | The underlying technology RAG and semantic search would both be built on — representing code chunks as vectors for similarity-based retrieval |
| **Offline/local models** | A self-hosted or local model option would remove the third-party data-sharing consideration noted in §9, at the cost of the quality/capability ceiling smaller local models currently carry relative to hosted frontier models |
| **Agentic workflows** | Moving from "answer a single grounded request" to a multi-step agent (e.g. one that reads a file, proposes a change, and applies it) — a significant architectural extension that would need its own safety/permission model layered on top of everything described in §9 |

---

## 15. Conclusion

The AI Assistant is deliberately built as a **thin, well-isolated layer** on top of a genuinely useful engineering discipline: every request is authorized against real project/file ownership before it costs anything, every prompt is grounded in the actual, live content the user is looking at, and every one of the five capabilities inherits the same shared, carefully-considered instruction set that prioritizes correctness and explicitly forbids fabrication. Statelessness keeps the subsystem simple and horizontally trivial to scale; the provider abstraction keeps today's specific choice of Gemini a reversible implementation detail rather than a structural dependency; and a small, purpose-built set of five tools — rather than one generic prompt box — gives users predictable, actionable output shaped for exactly what they're trying to do. The result is an assistant that reads, architecturally, less like a bolted-on chatbot and more like a natural extension of the editor itself — which is precisely the integration goal stated in §1.

---

*This document should be revisited if any of the Future Improvements in §14 are implemented — in particular, adding server-side conversation memory or a second model provider extends, rather than replaces, the architecture described here.*
