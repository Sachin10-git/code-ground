# Code Ground — Real-Time Collaboration System

> **Scope of this document:** A complete, distributed-systems-level explanation of Code Ground's real-time collaboration subsystem — the mechanism that lets multiple users edit the same file, see each other's cursors, chat, and recover from a checkpoint, all consistently and without manual conflict resolution. This document does not explain unrelated features (auth, execution, AI); those are referenced only where collaboration touches them.
>
> Companion documents: [`01_System_Architecture.md`](./01_System_Architecture.md) §8 and [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) §9.5/§10 introduced this subsystem at the whole-system level. This document is the authoritative, detailed reference for it — the earlier documents' collaboration sections should be read as summaries of what is fully specified here.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Collaboration Architecture](#2-collaboration-architecture)
3. [Collaboration Components](#3-collaboration-components)
4. [Session Lifecycle](#4-session-lifecycle)
5. [CRDT Fundamentals](#5-crdt-fundamentals)
6. [Yjs Architecture](#6-yjs-architecture)
7. [Document Hydration](#7-document-hydration)
8. [Presence & Cursor Synchronization](#8-presence--cursor-synchronization)
9. [Chat System](#9-chat-system)
10. [Snapshot System](#10-snapshot-system)
11. [Conflict Resolution](#11-conflict-resolution)
12. [Socket Event Lifecycle](#12-socket-event-lifecycle)
13. [Failure Handling](#13-failure-handling)
14. [Performance](#14-performance)
15. [Security](#15-security)
16. [Design Decisions](#16-design-decisions)
17. [Testing Strategy](#17-testing-strategy)
18. [Future Improvements](#18-future-improvements)
19. [Conclusion](#19-conclusion)

---

## 1. Introduction

### 1.1 Purpose of Real-Time Collaboration

The collaboration subsystem is what turns Code Ground from "an editor several people happen to have open" into an actual shared workspace: every keystroke, cursor movement, chat message, and file lock is propagated to every other collaborator within the same file or project in real time, and every collaborator's view of a file's content is guaranteed to converge to the same result, regardless of the order edits happened to arrive in.

### 1.2 Why Collaborative Editing Is Difficult

Naively broadcasting "here's my new version of the file" from every client breaks almost immediately under concurrency:

- **Two users typing at once** produces two divergent edits with no natural way to pick a "winner" — a last-write-wins broadcast silently discards one user's keystrokes.
- **Network latency and reordering** mean updates do not necessarily arrive at every client in the order they were made — a correct system must converge to the same result *regardless* of arrival order, not just the common case.
- **A user joining mid-session** needs to receive the *current* state, not just future updates, without that catch-up process itself corrupting an already-in-progress edit from someone else.
- **A crash or disconnect** must not silently lose the last few seconds of someone's work, nor leave the room's server-side state in a way that corrupts the next person to join it.

### 1.3 Goals of the Subsystem

| Goal | Concrete requirement |
|---|---|
| **Conflict-free concurrent editing** | Two or more users editing the same file at the same time never need a manual merge |
| **Convergence** | Every collaborator's document eventually reaches the exact same state, independent of network timing |
| **Low-latency feedback** | A user's own keystrokes appear instantly, locally, never waiting on a round trip |
| **Durability** | Collaborative edits survive a server restart and a room becoming temporarily empty |
| **Correct cold-start behavior** | The very first time a room is ever opened, and every subsequent reopen, must load the *right* content — never a stale or prematurely-empty version |
| **Live situational awareness** | Presence, cursors, typing indicators, and locks give collaborators a real sense of who's doing what, without any of it affecting document correctness |

### 1.4 Challenges Solved

This subsystem specifically had to solve, and has automated tests proving it solved: **atomic room initialization** (no window where an unhydrated document can be mistaken for a real one — §7), **conflict-free concurrent text editing** (via CRDTs — §5, §11), and **safe recovery** (from a disconnect, a crash, or a cold start — §13). Two of these — the hydration race and a related save-path race — were real defects found and fixed during development; their engineering story is documented in detail in §7 and §11.

---

## 2. Collaboration Architecture

```
                     Browser A                                    Browser B
                        │                                            │
                        │ Socket.IO (default namespace)                │ Socket.IO (default namespace)
                        ▼                                            ▼
              ┌───────────────────────────────────────────────────────────┐
              │                  Backend Collaboration Layer                    │
              │                                                               │
              │   roomManager        — who's in which room                     │
              │   liveUpdateManager  — apply + rebroadcast CRDT updates          │
              │   awarenessManager   — per-room Yjs Awareness instance             │
              │   cursorManager /                                                 │
              │   typingManager /    — plain-socket ephemeral UI state               │
              │   fileLockManager    — advisory per-file edit lock                    │
              │   debounceManager    — schedules a persistence save after a pause       │
              │   snapshotScheduler  — periodic full-document checkpoint timer           │
              │   hydration          — the atomic room-initialization pipeline (§7)        │
              └───────────────────────────┬───────────────────────────────────┘
                                            │
                                            ▼
                                  ┌───────────────────┐
                                  │    Yjs Documents        │
                                  │  (in-process, one          │
                                  │   Y.Doc per active room)     │
                                  └───────────┬───────────┘
                                              │  encodeStateAsUpdate (full state)
                                              ▼
                                  ┌───────────────────┐
                                  │      MongoDB            │
                                  │  CRDTDocument (debounced,   │
                                  │  always-latest)               │
                                  │  CRDTSnapshot (periodic,        │
                                  │  point-in-time fallback)           │
                                  │  File.content (last explicit         │
                                  │  Save, reconciled — see                │
                                  │  Backend Architecture doc §9.5)          │
                                  └───────────────────┘
```

Both Browser A and Browser B connect to the *same* backend process's in-memory `Y.Doc` for a given room — there is exactly one authoritative in-process document per active room, and every connected client's local Yjs replica is kept converged with it (and, transitively, with each other) purely through the update-broadcast mechanism in §6, never through a client talking to another client directly.

---

## 3. Collaboration Components

| Component | Responsibility |
|---|---|
| **Socket.IO** | Transport: per-file rooms on the default namespace, carrying join/leave, CRDT updates, cursor/selection/typing signals, and lock events |
| **Yjs** | The CRDT engine itself — the `Y.Doc` that represents a file's live, mergeable content |
| **CRDT (conceptually)** | The mathematical guarantee (§5) that makes "just apply updates in any order" produce a correct, convergent result |
| **Monaco Binding (`y-monaco`)** | Bridges the Yjs document to the actual Monaco editor buffer the user sees and types into (§6.5) |
| **Presence System** | Tracks who is in which room (deduplicated by user, not by connection — §8.1) |
| **Cursor Synchronization** | Broadcasts live cursor position/selection — implemented as plain, non-CRDT socket state, deliberately (§8.2) |
| **Chat** | Persisted, project-scoped messaging, broadcast live (§9) |
| **Snapshots** | Project-wide, point-in-time checkpoints that can restore an entire project's file tree (§10) |
| **Hydration** | The one-time-per-room-activation pipeline that makes a room's document trustworthy before anyone edits it (§7) |

Each of these is deliberately narrow — the Awareness/cursor/typing/lock managers, for instance, are four separate small modules rather than one "presence" god-module, each independently responsible for exactly one ephemeral signal.

---

## 4. Session Lifecycle

### 4.1 Narrative

1. **Opens a project** — no collaboration state yet; this is a REST-only concern (project tree retrieval).
2. **Opens a file** — the frontend joins that file's collaboration room over Socket.IO.
3. **Joins a collaboration room** — the backend hydrates the room (§7) if this is the first join since the room went inactive, then sends the current document state to the joining client.
4. **Starts editing** — keystrokes become local Yjs updates, applied instantly to the local buffer, and broadcast to the room; the backend applies the same update to its own in-process document and schedules a debounced save.
5. **Disconnects** (crash, tab close, network drop) — the backend's disconnect handler releases any lock the socket held, and — if this was the room's last connection — flushes any pending save and tears down the in-memory document and its hydration state.
6. **Reconnects** — a fresh room join runs the hydration pipeline again; because the previous session's edits were already persisted (debounced save) or the room never actually went empty, the reconnecting client is caught up correctly either way.
7. **Leaves** (explicitly switching files, or closing the room deliberately) — same cleanup as a disconnect, but triggered by an explicit leave event rather than a connection drop.

### 4.2 Sequence Diagram

```
 User                    Frontend (useYjs)              Backend                 MongoDB
   │                            │                           │                        │
   │  opens file                  │                           │                        │
   │ ─────────────────────────▶ │                           │                        │
   │                            │  socket.emit(ROOM_JOIN)      │                        │
   │                            │ ───────────────────────▶ │                        │
   │                            │                           │  hydrate room (§7)         │
   │                            │                           │ ───────────────────▶ │
   │                            │                           │  (load / recover / seed)     │
   │                            │                           │ ◀─────────────────── │
   │                            │  DOCUMENT_SYNC (full state)    │                        │
   │                            │ ◀─────────────────────── │                        │
   │                            │  bind Monaco to the                │                        │
   │                            │  local Yjs doc                       │                        │
   │  types                       │                           │                        │
   │ ─────────────────────────▶ │  local update applied instantly  │                        │
   │                            │  FILE_CHANGE (binary update)        │                        │
   │                            │ ───────────────────────▶ │                        │
   │                            │                           │  apply to server doc,        │
   │                            │                           │  rebroadcast to room,          │
   │                            │                           │  schedule debounced save (2s)    │
   │                            │                           │                        │
   │  (2s of no further edits)     │                           │  save (encodeStateAsUpdate)       │
   │                            │                           │ ───────────────────▶ │
   │                            │                           │                        │
   │  closes tab                  │                           │                        │
   │  (hard disconnect)             │                           │  release lock, flush any         │
   │                            │                           │  pending save, tear down            │
   │                            │                           │  in-memory doc if last socket          │
```

---

## 5. CRDT Fundamentals

### 5.1 What a CRDT Is

A **Conflict-free Replicated Data Type** is a data structure specifically designed so that **every replica, having received the same set of updates in any order (or even with some updates applied more than once), converges to the same final state** — mathematically, its operations are commutative, associative, and idempotent. This is a stronger and fundamentally different guarantee than "we resolved the conflict correctly this time": for a true CRDT, there is no conflict state to resolve, because concurrent operations are defined never to conflict in the first place.

### 5.2 Why CRDTs Were Chosen

Real-time collaborative text editing is a problem with two well-known solution families: **Operational Transformation (OT)** and **CRDTs**. Code Ground uses a CRDT (via Yjs) because:

- It requires **no central sequencing authority** to transform concurrent operations against each other — every replica can apply updates independently and still converge.
- The convergence guarantee is a property of the data structure's math, not of an algorithm's correctness that has to be gotten right (and re-verified) by the implementer for every new kind of operation.
- Mature, production-proven implementations (Yjs) already exist with editor bindings, so this guarantee could be adopted rather than built and proven from scratch.

### 5.3 Conflict-Free Editing, Conceptually

Consider two users, both starting from the text `"cat"`:

- User A inserts `"s"` at the end → `"cats"`.
- User B simultaneously inserts `"ATTACK "` at the beginning → `"ATTACK cat"`.

A naive last-write-wins broadcast would let only one of these survive. A CRDT instead represents each character as an item with a stable identity relative to its neighbors (not a raw string index), so both insertions apply cleanly and every replica converges to `"ATTACK cats"` — both edits preserved, in the position each author actually intended, with no merge conflict ever surfacing to either user.

### 5.4 Eventual Consistency

At any given instant, two collaborators' local documents might briefly differ (one has seen an edit the other hasn't received yet) — but **once all updates have propagated, every replica is guaranteed identical**, without any further action. This is "eventual consistency" in the precise distributed-systems sense: consistency is not instantaneous, but it is guaranteed, not merely hoped for.

### 5.5 Concurrent Editing in Practice

Because Yjs updates carry enough structural information to apply correctly regardless of order, the system tolerates: two users typing in different parts of the same file simultaneously, a user's update arriving at the server slightly out of order relative to another's, and a reconnecting client re-applying updates it may have partially seen before (idempotency absorbs the duplication harmlessly).

### 5.6 Offline Edits (Conceptual Note)

Although Code Ground does not currently ship an offline editing mode, this is worth noting precisely because of the architecture already in place: a CRDT document's convergence property holds *regardless of how long two replicas were disconnected from each other* — a client that edited entirely offline for an extended period and then reconnects would, in principle, merge back in correctly using the same mechanism already used for a brief network drop. Building a genuine offline mode would primarily be frontend/caching work (persisting local Yjs state while offline), not a change to the convergence guarantee itself (see §18).

### 5.7 CRDTs vs. Operational Transformation (Conceptual Comparison)

| | CRDT (used here) | Operational Transformation |
|---|---|---|
| **Convergence mechanism** | Data-structure math (commutative/associative/idempotent operations) | An explicit transform function that rewrites a concurrent operation against another before applying it |
| **Central authority needed** | No — any replica can apply updates independently | Typically yes — a server (or an agreed ordering) is usually needed to resolve transforms consistently |
| **Correctness burden** | Proven once, by the CRDT's mathematical definition | Must be proven correct for every pair of concurrent operation types the system supports |
| **Maturity of available libraries** | Yjs, Automerge, and others are mature and widely deployed | Historically used by earlier collaborative editors (e.g. Google Docs' original implementation); more complex to implement correctly from scratch |
| **Why this matters here** | Adopting a proven library gets the guarantee "for free" | Implementing OT correctly in-house would have been substantially higher engineering risk for the same end-user guarantee |

---

## 6. Yjs Architecture

### 6.1 `Y.Doc`

A `Y.Doc` is the root CRDT container — one instance per active collaboration room, held in the backend's in-process memory for as long as that room has at least one connected client (see §2's diagram).

### 6.2 Shared Text

Within each room's `Y.Doc`, the file's content lives in a single shared text type — the CRDT sequence structure that represents the actual editable string, with per-character (technically, per-insertion-run) identity that makes concurrent inserts/deletes resolve correctly as described in §5.3.

### 6.3 Awareness

Yjs's companion **Awareness** protocol represents *ephemeral*, non-document state — state that should be shared live but never persisted or subject to CRDT merge semantics, because it has no "content" to converge (only a "current value per user," naturally superseded by that same user's next update). The backend instantiates one Awareness object per room, tied to that room's `Y.Doc`, and clears a departing user's awareness state (rather than merging or persisting it) the moment they disconnect.

### 6.4 Document Updates

Two distinct update representations are used, deliberately for different purposes:

| Representation | Used for | Size characteristic |
|---|---|---|
| **Incremental update** (`Y.encodeStateAsUpdate` computed relative to what changed) | Live broadcast between clients on every edit | Small — proportional to the size of the actual edit, not the whole document |
| **Full-state encode** (`Y.encodeStateAsUpdate(doc)` with no prior-state argument) | Persistence (both the debounced `CRDTDocument` save and periodic `CRDTSnapshot`s) | Proportional to the whole document — acceptable here because persistence happens far less often than every keystroke |

This distinction is what keeps live collaboration bandwidth-efficient (§14) while keeping persisted state simple to restore (a single full-state blob, rather than reconstructing a document from a long incremental update history on every load).

### 6.5 Synchronization and the Monaco Binding

The frontend uses `y-monaco`'s `MonacoBinding` to connect a room's Yjs shared text directly to the Monaco editor model the user is looking at: local keystrokes in Monaco become Yjs document mutations (which in turn produce the incremental updates broadcast to the server), and incoming remote updates applied to the local Yjs document are reflected into the Monaco buffer automatically by the binding — the application code never manually diffs or patches editor content itself. The binding is only created **after** the room's initial document state has been received and applied locally (see §7's hydration discussion and §11's related race-condition fix) — creating it any earlier risks the binding's own initial-sync behavior overwriting content that hadn't arrived yet.

---

## 7. Document Hydration

### 7.1 MongoDB as the Source of Truth

A room's in-memory `Y.Doc` is *not* the source of truth by itself — it is a live, editable cache of state that ultimately must trace back to MongoDB: either a previously persisted `CRDTDocument` (the debounced, always-latest record), a `CRDTSnapshot` (a periodic fallback), or, for a file that has genuinely never had a collaboration session before, the file's plain `File.content` field.

### 7.2 The Hydration Pipeline

When a room is joined and no in-memory document work has happened for it yet, hydration runs a strict, ordered pipeline:

```
1. Try loading a persisted CRDTDocument for this room
       │
   found? ──yes──▶ apply it; DONE (this is always at least as fresh
       │            as any snapshot, since it's saved on every edit-pause)
       no
       ▼
2. Try recovering from the latest CRDTSnapshot
       │
   found? ──yes──▶ apply it; DONE
       │
       no
       ▼
3. Seed from File.content (this room has never been collaboratively
   edited before) — but ONLY if the shared text is still genuinely
   empty (guards against a race where another concurrent join already
   seeded it — see §7.4)
       │
       ▼
4. Mark the room hydrated — this is the ONLY step that flips the
   "this room's document is trustworthy" flag
```

### 7.3 Why Hydration Needed to Become Its Own Atomic Step

Before this design, a room was considered "active" the instant an in-memory `Y.Doc` object was created for it — which happens synchronously — even though *loading its real content* is asynchronous and could still be in flight. That gap was a real, exploitable window: a REST save landing during it could see "a document object exists for this room" and force-flush that still-empty, not-yet-loaded document over the file's real, previously-saved content, silently destroying it. The fix was to stop treating "a `Y.Doc` object exists" as meaningful at all, and introduce a **separate, explicit "hydrated" flag** that is only ever set once the full load/recover/seed pipeline has genuinely completed.

### 7.4 Promise Caching and Concurrent-Join Safety

Two users opening the same brand-new file's room at the exact same moment must not each independently run the seed-from-`File.content` step — that would duplicate the content. Hydration is guarded by an **in-flight promise cache keyed by room ID**: the first join to reach hydration for a given room starts the pipeline and caches the resulting promise; any concurrent join for the *same* room, arriving before that promise settles, is simply handed the same promise rather than starting a second pipeline run. Both joins therefore observe exactly one execution of the pipeline, and the content is seeded exactly once.

### 7.5 Failure Is Never Cached

If the hydration pipeline throws (for example, a transient database error while looking up the file), the room is **not** marked hydrated, and — critically — the failed attempt's cached promise is evicted immediately rather than left in the cache. Without this, every subsequent join to that room would be handed the same already-rejected promise forever, permanently stuck behind one transient failure. Evicting on failure means the very next join gets a clean, fresh retry.

### 7.6 Race Condition Avoidance — Summary

| Race avoided | Mechanism |
|---|---|
| A save landing mid-hydration overwrites real content with an empty document | The "hydrated" flag is separate from "a `Y.Doc` object exists," and is only set on pipeline success |
| Two simultaneous first-opens duplicate the seeded content | A single cached in-flight promise per room, shared by every concurrent joiner |
| A transient hydration failure permanently blocks the room | The failed attempt's cached promise is evicted immediately, allowing a clean retry on the next join |

### 7.7 Lifecycle Diagram

```
 Room join #1                Room join #2 (concurrent)         Hydration promise cache
      │                              │                                  │
      │  hydrateDocument(roomId)        │                                  │
      │ ───────────────────────────▶  │  (checks cache first)                │
      │                              │  hydrateDocument(roomId)                │
      │                              │ ───────────────────────────────────▶  │
      │                              │                                  │  cache MISS for join #1 →
      │                              │                                  │  starts pipeline, caches
      │                              │                                  │  the resulting promise
      │                              │                                  │  cache HIT for join #2 →
      │                              │                                  │  hands back the SAME promise
      │  pipeline completes             │                                  │
      │  (load/recover/seed)              │                                  │
      │ ◀─────────────────────────── │ ◀─────────────────────────────────  │
      │  both joins resolve with the       │                                  │
      │  SAME hydrated document               │                                  │
      │  mark room hydrated                      │                                  │
```

---

## 8. Presence & Cursor Synchronization

### 8.1 Presence Tracking

Presence is tracked per room as a map of connected sockets, each carrying the identity resolved from that socket's authenticated user (never client-supplied — see §15). The presence list shown to users is **deduplicated by user, not by connection**: if the same person has the same file open in two browser tabs, they appear once, not twice — because what matters to a collaborator is *who* is present, not how many connections that person happens to have open.

### 8.2 Cursor Positions — A Deliberately Non-CRDT Channel

Although the backend maintains a genuine Yjs Awareness instance per room (§6.3) with a generic update/broadcast event pair available, **live cursor position and selection specifically are implemented as their own dedicated, plain Socket.IO events**, not routed through the CRDT Awareness channel. This is a deliberate simplicity decision: a cursor position is a pure "last value wins, per user" piece of ephemeral UI state — it never needs the convergence guarantees a CRDT provides, because there is nothing to *merge*; only ever one true, current value per user, naturally superseded by that user's own next update. Sending it as a small, direct socket broadcast avoids the extra structure a generic Awareness payload doesn't add value for.

### 8.3 The Awareness Protocol's Actual Role Here

The room-scoped Awareness instance remains part of the architecture — it is created and torn down alongside the room, and a disconnecting user's awareness state is explicitly cleared — providing a general-purpose ephemeral-state channel available for anything that fits the "per-user, non-merged, live" model, independent of the specific cursor/selection feature described above.

### 8.4 Rendering: Identity-Verified, UI-Only

Every cursor/selection/typing broadcast is stamped with the identity resolved from the sending socket's authenticated session, never trusted from client-supplied payload fields (§15) — a user can only ever report their own cursor position. On the receiving side, the frontend renders these signals purely as a Monaco view-layer concern (decorations for the caret/selection highlight, a floating content widget for the username badge) — this rendering never touches the document model's actual text, undo history, or content in any way; it is a strictly cosmetic overlay on top of the real CRDT-synchronized buffer.

### 8.5 Join/Leave Events

A room join broadcasts an updated presence list to everyone already in the room (and, for a room with an existing file lock, catches the joining client up on that lock immediately, rather than making them discover it only when they try to type). A leave — explicit or via disconnect — broadcasts the updated presence list the same way, and additionally releases that user's lock and clears their awareness state.

---

## 9. Chat System

### 9.1 Message Flow

Team chat is scoped to a **project**, not to an individual file's collaboration room — it lives on the `/workspace` namespace (see the Backend Architecture document §10 for that namespace's general purpose), in the same project-wide room that also carries file-tree and presence events. Sending a message is a single round trip: persist it, then broadcast the persisted (not merely the locally-typed) message to everyone in the room — including the sender, so the UI always renders from one authoritative round trip rather than reconciling an optimistic local echo against the eventual server copy.

### 9.2 Socket Events and Room Isolation

A socket only receives a project's chat traffic if it has actually joined that project's `/workspace` room — chat is never broadcast platform-wide, and one project's messages are never visible to a socket that hasn't joined that specific project's room.

### 9.3 History and Real-Time Updates

A socket joining a project's `/workspace` room is immediately sent recent chat history (a bounded, recent window) as a one-time catch-up payload — distinct from the live broadcast stream every already-connected member continues to receive — so a newly joined or reconnected client sees continuity rather than a blank chat panel.

---

## 10. Snapshot System

### 10.1 Creation

Creating a snapshot walks a project's entire folder/file tree and, for every file, captures its **live** content rather than only its last explicitly saved value: if a file currently has an active collaboration room, the snapshot reads directly from that room's in-memory Yjs shared text; only a file with no active room falls back to its persisted `File.content`. This means a snapshot taken while people are actively mid-edit reflects exactly what is on every collaborator's screen at that moment, not a stale last-save.

### 10.2 Storage

A snapshot is stored as a structured, point-in-time capture of the project's folder hierarchy and every file's captured content — a durable MongoDB record, independent of (and outliving) any specific room's in-memory Yjs state.

### 10.3 Restoration

Restoring a snapshot rewrites the project's folder/file structure back to the captured state and triggers a full workspace-tree resync broadcast to every connected client — because a restore can touch every file and folder in the project at once, this is the one operation that intentionally invalidates a client's entire cached view of the project rather than applying an incremental update.

### 10.4 Use Cases and Contribution to Collaboration/Recovery

Snapshots serve two purposes at once: a **collaboration safety net** (a deliberate checkpoint before a risky change, restorable if the change goes wrong) and a **recovery mechanism** independent of the debounced `CRDTDocument`/periodic `CRDTSnapshot` persistence already described in §7 — a project-wide, human-meaningful "go back to this point" capability, rather than the fine-grained, per-room, developer-facing persistence the hydration pipeline relies on.

---

## 11. Conflict Resolution

### 11.1 Simultaneous Edits

As established in §5, two simultaneous edits are never treated as competing versions to reconcile — they are independent CRDT operations, both preserved, both correctly positioned relative to each other once applied. There is no "last write wins" step anywhere in the live-editing path.

### 11.2 Merge Behavior in Practice

| Scenario | Result |
|---|---|
| Two users insert text at different positions in the same file | Both insertions preserved, in the position each author intended |
| Two users insert text at the exact same position | Both insertions preserved; Yjs's internal ordering rules (based on each operation's origin) deterministically and consistently order them the same way on every replica |
| One user deletes text another user is concurrently editing within | Yjs's CRDT semantics resolve this without corrupting either user's intended change — a well-studied, already-solved case for mature CRDT text implementations |
| A user reconnects after a brief drop and resends an update it's unsure was received | Idempotent update application means re-applying an already-seen update is harmless |

### 11.3 Consistency Guarantees and Ordering

Every replica (every connected client, and the server's own in-process copy) converges to the identical final document state once all updates have propagated — this holds regardless of the order updates are received in, which is precisely the property that makes network jitter and reordering a non-issue for correctness (only for the brief, expected window of eventual-consistency lag described in §5.4).

### 11.4 The Related Save-Path Race — Why "No Manual Merge Conflicts" Required More Than Just Yjs

Yjs guarantees convergence *among live collaborators* — but a second, related correctness problem existed at the boundary between the live collaboration layer and the plain REST "Save" action: an explicit save used to simply flush whatever the in-memory `Y.Doc` currently held, trusting it already matched what was just saved. A narrow timing gap — a save landing after `File.content` was written, but before a client's Monaco binding had actually finished attaching to a freshly hydrated room — could mean the live document still held **pre-edit** content at that instant, and flushing it verbatim would silently revert the just-completed save. The fix (see the Backend Architecture document, §9.7) changed the save path to explicitly **replace** the live document's text to match what was just saved, rather than trusting it already did, closing this gap without weakening any of Yjs's own convergence guarantees.

### 11.5 Why Manual Merge Conflicts Are Avoided Entirely

Because both problems above are solved at the data-structure and persistence-boundary level respectively, **no user of Code Ground is ever shown a merge-conflict UI** for collaborative editing — not because conflicts are hidden or resolved behind the scenes with potential data loss, but because the system is architected so that the class of problem a merge-conflict UI exists to solve does not arise in the first place.

---

## 12. Socket Event Lifecycle

```
 Connection
    client connects to the default namespace with its JWT
        │
        ▼
 Authentication
    namespace-level middleware verifies the token, attaches
    socket.user for this connection's entire lifetime
        │
        ▼
 Join Room
    client emits a room-join for a specific file; server runs
    hydration (§7) if needed, sends the current document state
        │
        ▼
 Document Updates
    client edits ──▶ incremental Yjs update ──▶ server applies it
    to its in-process doc, rebroadcasts to the room, schedules a
    debounced persistence save
        │
        ▼
 Presence Updates
    cursor/selection/typing signals broadcast independently of
    document updates (§8), on every relevant local change
        │
        ▼
 Chat Messages
    (on the /workspace namespace, not this room specifically) —
    persisted, then broadcast to the project's connected members
        │
        ▼
 Disconnect
    client's connection drops (explicit leave or a hard disconnect)
        │
        ▼
 Cleanup
    lock released, awareness cleared, presence rebroadcast to the
    rest of the room; if this was the room's LAST connection: any
    pending debounced save is flushed synchronously, the periodic
    snapshot scheduler for that room is stopped, and the in-memory
    Y.Doc + hydration state are released
```

---

## 13. Failure Handling

| Failure | Handling |
|---|---|
| **Network interruption** | Local edits continue to apply instantly to the client's own Yjs replica regardless of connectivity; once the connection recovers, normal update exchange resumes and convergence proceeds exactly as described in §5.4 — no special "conflict" state to reconcile |
| **Socket disconnect** | The disconnect handler runs before the socket's room memberships are cleared, releasing its lock, clearing its awareness state, and rebroadcasting updated presence to the rest of the room |
| **Reconnect** | A fresh room join re-runs hydration; because edits are durably persisted on a short debounce (or the room never actually emptied), a reconnecting client is caught up correctly whether or not the room stayed active in the interim |
| **Backend restart** | All in-memory `Y.Doc`s and hydration state are lost by design — but nothing is lost *data-wise*, because the debounced `CRDTDocument` persistence means any content from more than ~2 seconds before the restart was already durably saved; the next room join simply re-hydrates from that persisted state |
| **Hydration failures** | Never cached as if successful (§7.5) — the very next join attempt gets a clean retry rather than being stuck behind a permanently broken cached promise |
| **Conflicting updates** | Not a distinct failure mode at all in this architecture — see §11; "conflicting" updates are exactly what the CRDT is designed to apply without any special-case handling |

---

## 14. Performance

| Concern | Approach |
|---|---|
| **Incremental updates** | Live document broadcasts carry only what changed, not the whole document — bandwidth scales with edit size, not document size |
| **Binary synchronization** | Yjs updates are compact binary encodings, not JSON-serialized text diffs — smaller wire payloads and faster encode/decode than a textual diff format |
| **Awareness optimization** | Ephemeral state (cursors, in the dedicated non-CRDT channel — §8.2) is broadcast directly without persistence overhead, since it's explicitly designed to never need storing |
| **Efficient broadcasting** | An update is broadcast to everyone in a room *except* the sender (`socket.to(room)`, not `io.to(room)`) — the originating client already has the change applied locally and doesn't need to receive its own edit echoed back |
| **Memory management** | A room's `Y.Doc` and Awareness instance are released the moment its last connection leaves — collaboration state for an inactive file does not linger in memory indefinitely |
| **Room isolation** | Broadcasts are scoped per room via Socket.IO's native room mechanism — a busy file's edit traffic never reaches sockets that haven't joined that specific room |
| **Debounced persistence** | Saving on a short pause-based debounce (rather than on every keystroke) avoids a database write per character while bounding data-loss risk to a small, well-understood window |
| **Scalability considerations** | All of the above assumes one process holding every active room's `Y.Doc` in memory — the explicit, documented scaling boundary discussed in the System Architecture document §19 (a Redis-backed or otherwise externalized document store would be the prerequisite for running more than one backend instance) |

---

## 15. Security

| Concern | Mechanism |
|---|---|
| **Room ownership / project isolation** | A room join is only permitted for a file the requesting user's project membership actually covers — the same authorization model described in the Authentication document §10, applied at the collaboration layer's entry point |
| **User validation** | Every identity attached to a broadcast (presence, cursor, chat sender) comes from the socket's server-verified authenticated identity, never from client-supplied payload fields — a client can report its own state, never impersonate another user |
| **Socket authentication** | The default namespace's connection-time JWT verification (Authentication document §8) gates every collaboration event — an unauthenticated connection never reaches room-join logic at all |
| **Lock integrity** | A file lock's ownership is tied to the exact socket that acquired it; release happens either explicitly or defensively on disconnect, so a lock can never outlive the connection that holds it |

---

## 16. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why Socket.IO for collaboration transport** | Rooms and reconnection are needed per-file, at scale, without hand-rolled connection bookkeeping | Built-in room semantics fit "one room per open file" directly | An abstraction layer over raw WebSockets, accepted for the room/reconnection primitives it provides |
| **Why Yjs** | A mature, widely-deployed CRDT implementation with an existing Monaco binding | Convergence guarantees adopted, not re-proven from scratch; less integration work via `y-monaco` | Requires the team to reason in CRDT terms (§5) rather than a more familiar (but harder to get right) OT-style model |
| **Why CRDT over Operational Transformation** | Avoids needing a correctness-critical transform function proven for every pair of concurrent operations | Lower implementation risk; no central sequencing authority required | Some CRDT implementations (Yjs included) carry more per-character bookkeeping overhead than a leaner OT log — an accepted cost for the correctness guarantee |
| **Why the Monaco Binding (`y-monaco`)** | Manually diffing/patching Monaco's buffer against CRDT updates would be reinventing already-solved integration logic | Editor updates and CRDT updates stay automatically synchronized in both directions | The binding must only be attached once the room is genuinely hydrated (§6.5) — an integration detail that had to be gotten right deliberately |
| **Why MongoDB remains the source of truth (not the in-memory `Y.Doc`)** | In-memory state must never be the only copy of anything durable | A backend restart, or a room going empty, loses nothing that matters | Requires the explicit debounce/snapshot/hydration machinery in §7 to keep the in-memory and persisted views correctly reconciled |
| **Why a hydration cache (in-flight promise, keyed by room)** | Concurrent first-opens of the same brand-new room must not each independently seed content | Content is seeded exactly once regardless of how many simultaneous joiners there are | Requires careful handling of the failure path (§7.5) so a cached rejection doesn't permanently block the room |
| **Why room-based collaboration** (rather than one shared global channel) | Per-file isolation is a correctness requirement (one file's edits must never reach another file's collaborators) as much as a performance one | Broadcast traffic and memory scale with active rooms, not total files in the system | Requires explicit per-room lifecycle management (creation, hydration, teardown) rather than a single always-on channel |

---

## 17. Testing Strategy

### 17.1 What Is Tested

| Test category | What it verifies |
|---|---|
| **Hydration tests** | First-open seeding from `File.content`; a legitimately empty file staying empty (and still being marked hydrated — an empty result is not an error); reusing existing persisted state instead of reseeding; idempotent re-hydration of an already-hydrated room; concurrent simultaneous opens seeding content exactly once; the autosave guard correctly reporting a room as untrustworthy while hydration is still in flight and trustworthy only after; reconnect/recovery correctly loading persisted state rather than reseeding; a full persist-then-load round trip preserving an edit exactly; a failed hydration attempt not being cached, so a retry is possible |
| **Save-path reconciliation test** | Confirms the fix in §11.4 — a save correctly replaces (rather than blindly trusting) a hydrated room's live content to match what was just persisted |
| **Concurrency-specific assertions** | Tests explicitly fire simultaneous joins/operations at the same room and assert on the *count* of resulting side effects (e.g. content inserted exactly once), not just the end state — the class of assertion that actually catches a race condition rather than merely a logic error |

### 17.2 Why This Test Suite Is the Right Validation for This Subsystem

The bugs that matter in a CRDT collaboration layer are almost never simple logic errors a code review catches by inspection — they are **timing- and concurrency-dependent races** that only reproduce under real interleavings (the exact hydration race described in §7.3 is a direct example: it required two things to happen in a specific order across an asynchronous boundary). A test suite for this subsystem is only meaningful if it explicitly constructs those interleavings — concurrent joins, joins racing a save, a deliberately-failing hydration attempt — rather than only testing the single-user happy path. The existing hydration test suite does exactly this, and its full, consistent pass record is the concrete evidence that the specific race conditions described in §7 and §11 are closed, not merely believed to be closed.

### 17.3 Categories Not Covered Here

Socket-transport-level tests (connection handshake, event wire format) and end-to-end multi-browser tests are lighter-weight in this subsystem than the hydration suite, since the highest-risk, highest-value logic — the part where a genuine data-loss bug was actually found and fixed — lives in the hydration and save-reconciliation pipeline, which is where testing investment was concentrated.

---

## 18. Future Improvements

| Improvement | Addresses |
|---|---|
| **Redis-backed shared document state** | The prerequisite for running more than one backend instance — every active room's `Y.Doc` currently lives in one process's memory (§14) |
| **Horizontal scaling of the collaboration layer** | Depends on the Redis step above, plus Socket.IO's own multi-instance adapter, so a room's collaborators can be spread across backend instances and still converge |
| **Persistent Awareness** | Ephemeral state (cursors, presence) currently resets on reconnect; a brief "last known state" cache could smooth over reconnect flicker without changing the ephemeral-by-design nature of the data |
| **Genuine offline collaboration** | The CRDT convergence guarantee already supports this conceptually (§5.6) — the remaining work is primarily client-side (persisting local Yjs state while offline, and a UI for "you have unsynced local edits") |
| **Operational analytics** | Recording edit-volume/collaboration-session metrics (who collaborated with whom, how often) for product insight, analogous to the execution engine's existing metrics subsystem |
| **Version history** | Distinct from snapshots (which are project-wide, manually or periodically triggered) — a finer-grained, file-level "show me this file's edit history over time" view, potentially built on the same persisted CRDT state already being retained |
| **Fine-grained permissions on collaboration itself** | Today, project role (owner/editor/viewer) governs editing broadly; a future capability could restrict collaboration to specific files or grant temporary, revocable editing access without changing project-wide role |

---

## 19. Conclusion

Code Ground's collaboration subsystem is built on a small number of load-bearing guarantees, each solved at the layer where it actually belongs: **conflict-free convergence** is Yjs's CRDT mathematics, not application logic; **durability** is MongoDB as the unambiguous source of truth, with the in-memory `Y.Doc` treated strictly as a live, reconstructable cache; **correctness at room-activation time** is the atomic hydration pipeline, with two specific, real races (a save racing an unhydrated room, and a save racing a not-yet-attached Monaco binding) found and closed rather than merely assumed away; and **live situational awareness** (presence, cursors, locks, chat) is kept deliberately separate from document correctness, so a UI-only feature can never threaten the one guarantee that actually matters — that every collaborator's file converges to the same, correct content.

This combination — a proven CRDT foundation, a rigorously tested hydration and persistence pipeline, and a clean separation between "the document" and "everything ephemeral around it" — is what makes real-time, multi-user, conflict-free editing one of the architectural strengths of Code Ground rather than its most fragile feature, which is often the case in systems that attempt this without a CRDT foundation or without deliberately testing for the specific races that make collaborative systems hard.

---

*This document should be revisited if any of the Future Improvements in §18 are implemented — in particular, moving room state to Redis for horizontal scaling changes the memory-management and failure-handling story described throughout §13 and §14.*
