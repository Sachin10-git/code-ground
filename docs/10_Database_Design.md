# Code Ground — Database Design

> **Scope of this document:** The complete, accurate data model of the Code Ground platform — every actively-used MongoDB collection, its relationships, lifecycle, validation, and indexing, as actually implemented. This document does not explain MongoDB or Mongoose as technologies; it explains how this specific application uses them, and it distinguishes real, wired-in collections from schema files that exist in the repository but are not part of the live data model.
>
> Companion documents: [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) §13 and [`01_System_Architecture.md`](./01_System_Architecture.md) §12 introduced the database at the whole-system level. This document is the authoritative, detailed reference for it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Database Overview](#2-database-overview)
3. [Core Collections](#3-core-collections)
4. [Collection Relationships](#4-collection-relationships)
5. [Data Lifecycle](#5-data-lifecycle)
6. [Data Validation](#6-data-validation)
7. [Indexing Strategy](#7-indexing-strategy)
8. [Data Integrity](#8-data-integrity)
9. [Performance Considerations](#9-performance-considerations)
10. [Security](#10-security)
11. [Backup & Recovery](#11-backup--recovery)
12. [Design Decisions](#12-design-decisions)
13. [Future Improvements](#13-future-improvements)
14. [Conclusion](#14-conclusion)

---

## 1. Introduction

### 1.1 Purpose of the Database

MongoDB is Code Ground's **durable system of record** — everything that must survive a page refresh, a browser closing, or a backend restart lives here. It deliberately does *not* hold the platform's transient, in-memory-only state (live collaboration documents held as `Y.Doc`s, the execution concurrency queue, active terminal sessions) — those are reconstructed or reset by design, as detailed in the System Architecture document §2 and §17.

### 1.2 Why MongoDB Was Selected

Code Ground's core entities — a project's member list, a file's metadata, a chat message, a captured snapshot's file tree — are naturally document-shaped and don't require rigid, pre-declared multi-table joins to represent. A hosted, managed cluster (MongoDB Atlas) also removes the operational burden of running and backing up a database server by hand, letting engineering effort go toward the platform's actual differentiators (collaboration, execution, AI) rather than database administration.

### 1.3 Design Goals

| Goal | What it means here |
|---|---|
| **Clear ownership per collection** | Every collection has exactly one service that owns its queries (Backend Architecture document §13.4) |
| **Referenced, not deeply embedded, relationships** | Projects, files, folders, and their related records reference each other by ID rather than nesting large sub-documents inside a parent (§4) |
| **Denormalize deliberately, not accidentally** | A small number of fields (e.g. a `username` stored alongside an activity/chat/snapshot record) are intentionally duplicated to avoid a `populate` on every read of a frequently-listed collection — a conscious trade, not schema drift |
| **Validate at the schema level first** | Mongoose schema constraints (required fields, enums, lengths) are the first line of defense, ahead of any additional business-rule validation in a service (§6) |
| **Query patterns drive indexes** | Every compound index in this schema exists because a real, identified query shape needs it (§7) — not speculative coverage |

### 1.4 Data Consistency Philosophy

Code Ground does not use multi-document transactions anywhere in its data model — consistency is achieved instead through **careful operation ordering within a single service call** (e.g. persist a file's content, then reconcile the live CRDT document to match it — Collaboration System document §11.4) and through **treating MongoDB as the tie-breaker** whenever an in-memory and a persisted view of the same data could disagree (System Architecture document §2). This is a pragmatic middle ground: the application's write patterns are simple enough (mostly single-document writes) that transactions would add complexity without a corresponding correctness gain in most places they'd apply.

---

## 2. Database Overview

Data in Code Ground organizes around one root entity — the **Project** — with almost everything else either belonging directly to a project or belonging to a user's account.

```
                                    ┌─────────────┐
                                    │     User        │
                                    └──────┬──────┘
                     owns / is a member of  │  authenticates via
                            (with a role)    │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       │
            ┌─────────────┐        ┌─────────────┐          ┌─────────────┐
            │   Project      │        │ RefreshToken   │          │  (User is the  │
            └──────┬──────┘        └─────────────┘          │   root of auth,  │
                    │                                              │   not projects) │
    ┌───────────────┼───────────────────┬───────────────┬─────────┴─────────┐
    ▼               ▼                   ▼               ▼                   ▼
┌─────────┐   ┌─────────┐         ┌─────────┐     ┌─────────┐         ┌─────────┐
│  Folder    │   │   File     │         │Invitation │     │ChatMessage│         │ Snapshot   │
└────┬────┘   └────┬────┘         └─────────┘     └─────────┘         └─────────┘
     │             │
     │  parent of    │  belongs to
     └──────┬──────┘
            ▼
    (self-referencing:
     Folder → Folder,
     via parentFolderId)

┌─────────┐         ┌─────────────┐
│WorkspaceActivity│  │  CRDTDocument   │◀── one per File's collaboration room
└─────────┘         │  CRDTSnapshot    │    (roomId = File._id, as a string)
                     └─────────────┘
```

**Reading this diagram:** every collection except `User` and `RefreshToken` carries a `projectId` reference back to the Project it belongs to — Project is the tenancy boundary almost every authorization check (Authentication document §10) and almost every query in this system is ultimately scoped by.

---

## 3. Core Collections

### 3.1 User

**Purpose:** the platform's account record and the root of authentication.
**Responsibilities:** credentials (hashed password), profile fields (username, email, avatar), platform-wide role, email verification and password-reset state, and the list of projects the account belongs to.
**Relationships:** referenced by nearly every other collection (as `createdBy`, `userId`, `ownerId`, etc.); holds a denormalized `workspaces` array of Project references for fast "my projects" listing.
**Lifecycle:** created at registration; updated on profile changes, password reset, and email verification; never automatically deleted (account deletion is not currently an implemented capability — §13).

### 3.2 RefreshToken

**Purpose:** the durable half of the authentication model (Authentication document §5.3) — the credential that can be individually revoked before its natural expiry.
**Responsibilities:** one document per issued refresh token, tracking which user it belongs to, its expiry, and whether it has been revoked.
**Relationships:** references `User`.
**Lifecycle:** created on register/login/refresh; marked revoked on logout or rotation (Authentication document §5.4); eligible for deletion once expired (a cleanup capability exists in the service layer — §11).

### 3.3 Project

**Purpose:** the tenancy boundary for everything else in the system — a body of work, its collaborators, and their roles.
**Responsibilities:** name, description, owner, a `members` array (each with a `role`: owner/editor/viewer), default language, visibility.
**Relationships:** the parent of Folder, File, Invitation, ChatMessage, Snapshot, and WorkspaceActivity — every one of those references it by ID.
**Lifecycle:** created explicitly by a user (who becomes its owner); renamed/deleted only by the owner (Authentication document §10.2); deletion is currently a hard delete of the Project document itself (§8 discusses what this does and does not cascade).

### 3.4 Folder

**Purpose:** organizes a project's files into a directory-like hierarchy.
**Responsibilities:** a name, a reference to its project, and an optional reference to its **own parent folder** (self-referencing) — `null` meaning "at the project root."
**Relationships:** belongs to a Project; parents zero or more Files and zero or more child Folders.
**Lifecycle:** created/renamed/moved/deleted through the File API (see the API Reference document §5.7); every mutation also triggers a live `workspace:folder-*` broadcast.

### 3.5 File

**Purpose:** the actual unit of code a user edits — the record `File.content` (docs/05 §7.1) is ultimately reconciled against, and the anchor for a per-file collaboration room (`roomId = File._id.toString()`).
**Responsibilities:** name, extension, resolved language, its persisted `content`, its parent project and optional parent folder, and who created it.
**Relationships:** belongs to a Project and optionally a Folder; is the entity a `CRDTDocument`/`CRDTSnapshot` pair exists for, keyed by its own ID as a string room identifier.
**Lifecycle:** created/renamed/moved/deleted through the File API; its `content` field is updated by an explicit Save, and is what a live collaboration session is ultimately reconciled against (Collaboration System document §11.4).

> **A structural note on this collection specifically:** there are **two** File schema files in the codebase — `models/file.js` and `db/models/file.js`. Every service, controller, and test in the application imports and uses `models/file.js` exclusively; `db/models/file.js` is never referenced anywhere and is not part of the live data model. This is a leftover duplicate from the project's phased development history (Backend Architecture document §3), not two collections in active use.

### 3.6 Invitation

**Purpose:** lets a project owner add a specific person to a project by email without making it public.
**Responsibilities:** which project, who invited whom (by email), the offered role, and a status (`pending`/`accepted`/`rejected`/`expired`).
**Relationships:** references a Project and the inviting User; resolved against a User by email at accept/reject time rather than storing a direct reference to the invitee up front (since the invitee may not yet have interacted with the invitation).
**Lifecycle:** created when an owner invites someone; transitions to `accepted` (granting Project membership) or `rejected`; an `expiresAt` field exists for time-boxing an invitation, though automatic expiry sweeping is not currently implemented (§13).

### 3.7 ChatMessage

**Purpose:** persisted history for a project's real-time team chat (Collaboration System document §9).
**Responsibilities:** one document per sent message — project, sender (ID and a denormalized username), and the message text (capped at 4000 characters).
**Relationships:** belongs to a Project and a User.
**Lifecycle:** created on send; never edited or deleted (no message-editing/deletion feature exists today).

### 3.8 Snapshot

**Purpose:** a project-wide, point-in-time checkpoint of every folder and file, restorable later (Collaboration System document §10).
**Responsibilities:** the project it belongs to, who created it (with a denormalized username), and two embedded arrays — `folders` and `files` — each a lightweight capture of that entity's identity and content *at the time the snapshot was taken*.
**Relationships:** belongs to a Project; its embedded file/folder entries deliberately **preserve the original File/Folder `_id` values** rather than generating new ones.
**Lifecycle:** created on demand; restoring rewrites the live Folder/File collections back to the captured state and reuses those preserved IDs — specifically so a restored file's collaboration room identity (`roomId = fileId.toString()`) remains valid with no additional room-management logic required, a deliberate design choice visible directly in this schema's own structure.

### 3.9 WorkspaceActivity

**Purpose:** the durable backing for a project's live activity feed.
**Responsibilities:** one document per workspace mutation — project, actor username, an `operation` enum (`created`/`renamed`/`moved`/`deleted`/`locked`/`unlocked`/`restored`), a `targetType` enum (`file`/`folder`/`snapshot`), and the affected item's name (plus old/new names for renames).
**Relationships:** belongs to a Project.
**Lifecycle:** written at the exact same call site as the corresponding live socket broadcast (Backend Architecture document §9.6), so the persisted history and the live feed can never drift apart from each other; entries are not currently pruned (§13).

### 3.10 CRDTDocument

**Purpose:** the durable, always-freshest persisted form of a file's live collaborative content (Collaboration System document §7.2).
**Responsibilities:** exactly one document per room (`roomId`, unique), holding the room's full Yjs state as a binary blob.
**Relationships:** conceptually one-to-one with a File, keyed by `roomId = File._id.toString()` rather than a formal Mongoose reference.
**Lifecycle:** upserted on a short debounce after every edit-pause; loaded once, at room hydration, to seed the in-memory `Y.Doc`.

### 3.11 CRDTSnapshot

**Purpose:** a periodic (every 5 minutes, per active room) fallback checkpoint of a room's CRDT state, used only when no `CRDTDocument` exists yet for that room (Collaboration System document §7.2).
**Responsibilities:** a `roomId` and a full Yjs state blob, **not** unique per room — multiple accumulate over time, with the most recent selected by sorting on `createdAt`.
**Relationships:** conceptually one-to-many with a File (many snapshots can exist for one room over its lifetime).
**Lifecycle:** created on the periodic scheduler while a room is active; read only during hydration recovery, as the second-choice fallback behind `CRDTDocument`.

### 3.12 Schema Files Present but Not in Active Use

The repository also contains model files for `ActivityLog`, `AIHistory`, `AISuggestion`, `Message`, `Notification`, and `Session` — none of which are imported by any service, controller, or route in the current codebase. They appear to be scaffolding from an earlier development phase (an AI conversation history model, in particular, predates the AI subsystem's current, deliberately stateless design — AI Assistant document §6.4) and are not part of the live data model. They are not documented further here, consistent with this document's scope of covering what is actually implemented.

---

## 4. Collection Relationships

| Relationship | Cardinality | Embedded or Referenced | Why |
|---|---|---|---|
| User → Project (membership) | Many-to-many (a user can be in many projects; a project has many members) | Referenced — `Project.members[].userId`, plus a denormalized `User.workspaces[]` for fast reverse lookup | Membership needs its own metadata (a `role` per member) that doesn't belong on either side alone — an embedded array of `{userId, role}` subdocuments on `Project` is the natural fit, with the denormalized array on `User` trading a small consistency-maintenance cost for avoiding a full collection scan to answer "what are my projects" |
| Project → Folder | One-to-many | Referenced (`Folder.projectId`) | Folders are independently queried, updated, and moved — embedding them inside `Project` would make every folder mutation rewrite part of the parent Project document |
| Folder → Folder (nesting) | One-to-many, self-referencing | Referenced (`Folder.parentFolderId`) | An arbitrarily deep tree cannot be embedded without an unbounded nesting depth in the schema itself — a parent reference plus a query-time tree assembly (Backend Architecture document §13.3) is the standard, scalable approach |
| Project → File | One-to-many | Referenced (`File.projectId`, optional `File.folderId`) | Same reasoning as Folder — files are the most frequently, independently mutated entity in the system and must not be nested inside their parent |
| Project → Invitation | One-to-many | Referenced | Invitations have their own lifecycle (pending/accepted/rejected) independent of the project document itself |
| Project → ChatMessage | One-to-many | Referenced | An unbounded, append-only stream — the textbook case for a separate, independently-growing collection rather than an embedded array with no natural size limit |
| Project → Snapshot | One-to-many | Referenced (the Snapshot) **containing** embedded arrays | The snapshot **itself** embeds its captured file/folder data (§3.8) — a deliberate exception to "reference, don't embed": a snapshot is fundamentally a frozen copy, not a live relationship, so embedding is exactly correct here (there is nothing to keep in sync, by design) |
| Project → WorkspaceActivity | One-to-many | Referenced | Same append-only-stream reasoning as ChatMessage |
| File ↔ CRDTDocument / CRDTSnapshot | One-to-one / one-to-many, respectively | Referenced by convention (`roomId` as a string, not a formal Mongoose `ref`) | The CRDT persistence layer is intentionally decoupled from `File` at the schema level — it is addressed by an ID string rather than a populated relationship, reflecting that this layer's data (Collaboration System document §6.4) has a fundamentally different lifecycle and shape (a Yjs binary state) than the File document itself |

### 4.1 Why Embedded vs. Referenced Was Chosen Case by Case

The one consistent rule applied throughout: **embed a frozen copy of data that will never again change or be queried independently; reference anything that has its own independent lifecycle, mutation pattern, or query pattern.** A Snapshot's file/folder entries are correctly embedded because a snapshot is defined by *never changing after creation* — there is no "keep this in sync" problem to solve. Every other relationship in this schema involves an entity that is independently created, updated, deleted, and queried on its own, which is exactly the situation a reference (not embedding) is the correct fit for.

---

## 5. Data Lifecycle

### 5.1 End-to-End Flow

```
 User registration
        │
        ▼
 Project creation
        │  (creator recorded as owner in Project.members)
        ▼
 File / Folder creation
        │  (each written directly to its own collection,
        │   referencing the Project)
        ▼
 Editing
        │  live edits flow through the CRDT layer (CRDTDocument
        │  debounced-saved every ~2s of pause — Collaboration
        │  System document §6.4); File.content is updated
        │  separately, on an explicit Save
        ▼
 Snapshots (optional, on demand)
        │  a full copy of the current Folder/File tree is
        │  embedded into a new Snapshot document
        ▼
 Deletion
        (a File/Folder/Project delete removes that document;
         see §8 for what does and does not cascade)
```

### 5.2 File Content's Two Parallel Lifecycles

A file's content genuinely has two, related-but-distinct lifecycles simultaneously, which is worth diagramming on its own:

```
        File.content (the durable "last explicitly saved" value)
              ▲                                    │
              │ explicit Save (PATCH)               │ read to SEED a brand-new
              │                                     │ room's CRDTDocument, the
              │                                     │ FIRST time it's ever opened
              │                                     ▼
        reconciled to match ◀──────────────  CRDTDocument (the live, debounced,
        on every Save                         collaboratively-edited state)
```

This dual-track lifecycle — and the specific race it once created — is documented in full in the Collaboration System document §7 and §11.4; it is summarized here only to explain why `File.content` and `CRDTDocument` are two separate collections rather than one.

### 5.3 Snapshot Restore

```
 Snapshot document (embedded folders[] / files[])
        │
        ▼
 Restore: existing Folder/File documents for the project are
 replaced with new ones — reusing the SAME _id values the
 snapshot originally captured (§3.8)
        │
        ▼
 Every connected client receives a full workspace-tree resync
 (Collaboration System document §10.3)
```

---

## 6. Data Validation

### 6.1 Schema-Level Validation

Every collection's required fields, string length limits, and enumerated value sets (§3) are enforced by Mongoose at the schema level — a document that violates them is rejected before it is ever written, regardless of which service constructed it. Representative examples already covered in detail elsewhere: `Project.members[].role` (`owner`/`editor`/`viewer`), `Invitation.status` (`pending`/`accepted`/`rejected`/`expired`), `WorkspaceActivity.operation`/`targetType` enums, and `ChatMessage.message`'s 4000-character cap.

### 6.2 Required Fields and Defaults

Fields with no sensible default (a project's `name`, a file's `createdBy`) are marked required, failing fast on an incomplete write. Fields with a safe, well-defined default (`Project.visibility` defaulting to `"private"`, `Invitation.role` defaulting to `"editor"`, `Folder.parentFolderId` defaulting to `null` for a root-level folder) fall back automatically rather than requiring every caller to specify them explicitly.

### 6.3 Backend (Application-Level) Validation

Beyond schema constraints, `express-validator` rule sets (Backend Architecture document §7.1) enforce request-shape rules that don't belong in the schema itself — a project name's 3–50 character range, an AI request's 8000-character prompt cap, a Mongo ID's format — because these are properties of a specific *API request*, not of the *stored document* (a document loaded from the database is trusted; a request arriving from the network is not).

### 6.4 Why Validation Exists at Multiple Layers

Schema validation and request validation guard against different things: request validation rejects malformed input **before** it's used to construct a query or a write at all (protecting against, for instance, an invalid ID reaching a database call); schema validation is the backstop that guarantees a document can never be persisted in an invalid shape **regardless of which code path wrote it** — including a future code path that might forget to apply the same request-level checks. Neither layer alone provides both guarantees.

---

## 7. Indexing Strategy

### 7.1 Implemented Indexes

| Collection | Index | Why |
|---|---|---|
| `User` | Unique index on `username`; unique index on `email` | Enforces account uniqueness at the database level (not just at the application-check level — Authentication document §3.1) and makes login-by-email lookup fast |
| `RefreshToken` | Unique index on `token`; index on `expiresAt` | `token` is looked up on every refresh call and must be unique by definition; `expiresAt` supports efficient cleanup of expired tokens (§11) |
| `Folder` | Compound index on `{ projectId, parentFolderId }` | Every folder-tree query filters by project and groups by parent — this is the exact shape of that query |
| `Snapshot` | Index on `projectId`; compound index on `{ projectId, createdAt: -1 }` | Listing a project's snapshots is always "this project, newest first" |
| `ChatMessage` | Compound index on `{ projectId, createdAt: -1 }` | Chat history is always fetched as "the latest N messages for this project" |
| `WorkspaceActivity` | Index on `projectId`; compound index on `{ projectId, createdAt: -1 }` | Identical access pattern to ChatMessage — the activity feed is always "latest N for this project" |
| `CRDTDocument` | Unique index on `roomId` | Exactly one document per room by definition — enforced, not just assumed |

### 7.2 A Notable Gap

`CRDTSnapshot` is queried with the same "filter by `roomId`, sort by `createdAt` descending, take the first" shape that `Snapshot`, `ChatMessage`, and `WorkspaceActivity` all have — and all three of *those* collections have an explicit compound index for exactly that shape. `CRDTSnapshot` does not currently have one. For a room with many accumulated periodic snapshots, this query would rely on a collection-wide scan (filtered by `roomId`) rather than an index-assisted one. This is a concrete, identified opportunity, not a hypothetical one — see §13.

### 7.3 Why Unique Indexes Specifically Matter Here

A unique index is the one validation mechanism that **cannot be bypassed by a race condition** — two concurrent registration requests for the same email, or two concurrent hydration attempts trying to create the same room's `CRDTDocument`, are correctly resolved by the database itself rejecting the second write, rather than relying on an application-level check-then-write sequence that a race could slip between (the exact class of problem discussed at length, for a different subsystem, in the Docker Execution Engine document §14).

### 7.4 Future Indexing Opportunities

Beyond closing the `CRDTSnapshot` gap above: `File` currently has no explicit compound index despite `{ projectId, folderId }` being the natural shape of a project-tree query (today, tree assembly relies on `projectId` alone plus in-memory grouping — acceptable at current scale, a candidate for a compound index as project sizes grow); `Invitation` has no index on `inviteeEmail`, which is the field "get my pending invitations" (API Reference document §4.8) filters by.

---

## 8. Data Integrity

### 8.1 Ownership

Every mutation-capable collection carries an explicit owner or creator reference (`createdBy`, `ownerId`, `userId`), which is what every authorization check (Authentication document §10) is ultimately verified against — ownership is a property of the data model itself, not something reconstructed at request time from other signals.

### 8.2 Referential Consistency

Referential integrity (a `File.projectId` actually pointing at a real Project, a `Folder.parentFolderId` actually pointing at a real Folder in the same project) is enforced by **application-level checks in the service layer** at write time (Backend Architecture document §13.4), not by database-level foreign-key constraints — a deliberate consequence of choosing MongoDB (§12), where referential integrity is a modeling discipline rather than an enforced schema property.

### 8.3 Deletion Strategy

Deletes in this system are currently **hard deletes** — deleting a File, Folder, or Project removes that document outright; there is no soft-delete/`deletedAt` marker anywhere in the schema today (§13 discusses this as a future improvement). Deleting a Project does **not** currently cascade to automatically delete its Files/Folders/Snapshots/ChatMessages/WorkspaceActivity — those would become orphaned references pointing at a `projectId` that no longer resolves, a known characteristic of the current implementation rather than an enforced, cascading-delete guarantee.

### 8.4 Orphan Prevention (Current State)

Given §8.3, orphan prevention today relies on **application discipline at delete time** rather than a database-enforced mechanism — the practical mitigation is that project deletion is an owner-only, deliberate action (Authentication document §10.2), not something that happens incidentally. A more complete cascading-delete (or soft-delete) strategy is discussed in §13.

### 8.5 Snapshot Consistency

A Snapshot's internal consistency is structurally guaranteed rather than maintained: because its file/folder data is embedded at creation time (§3.8, §4.1), a snapshot can never "drift" relative to its own captured state — there is nothing external for it to stay in sync with once written. The one integrity property that *is* actively maintained across time is the **preserved-ID** convention (§3.8): restoring a snapshot must reuse the original File/Folder IDs precisely so a file's CRDT room identity remains valid, which is enforced by the restore logic itself, not by a database constraint.

---

## 9. Performance Considerations

| Concern | Current approach |
|---|---|
| **Query optimization** | Indexes are added specifically where a real, repeated query shape exists (§7.1) — every list-style query in the system (chat history, activity feed, snapshots) follows the identical "filter by project, sort newest-first" shape, and each has a matching compound index |
| **Document size** | Most documents are small and bounded (a chat message capped at 4000 characters, a file's `content` field being the one naturally unbounded exception); Snapshot documents are the largest by construction, since they embed an entire project's file contents at a point in time |
| **Reference strategy** | Referencing rather than embedding for anything with an independent lifecycle (§4) keeps individual document writes small and targeted — renaming a file touches only that File document, never a parent Project or Folder document |
| **Scalability (current)** | A managed MongoDB Atlas cluster handles replication and failover; the schema's indexing strategy assumes a single, project-scoped query pattern throughout, which scales horizontally by project count reasonably well without any sharding configuration today |
| **Read/write patterns** | Heavily read-and-write on File (content saves, tree reads) and CRDTDocument (debounced saves every ~2s of active editing per room); comparatively write-light, read-light on Project/User/Invitation |
| **Potential bottlenecks** | The identified missing `CRDTSnapshot` index (§7.2) is the clearest concrete one; a Snapshot collection growing very large (many large embedded documents) over a long-lived, actively-snapshotted project is the other — mitigated today only by the fact that snapshot creation is a deliberate, on-demand user action, not automatic or frequent |

---

## 10. Security

| Concern | How it's addressed at the data layer |
|---|---|
| **Ownership checks** | Every project-scoped query is preceded by a membership/role check (Authentication document §10.2) before the query even runs — the database itself has no row-level security; this is entirely an application-layer guarantee |
| **Authorization** | Role (`owner`/`editor`/`viewer`) is stored directly on `Project.members`, making it the single source of truth every authorization check reads from |
| **Sensitive fields** | `User.password` is never a plaintext value (Authentication document §9) — the schema stores only a bcrypt hash, and every projection used to return a user object explicitly excludes it |
| **Password storage** | Bcrypt hashing with per-hash salting, covered in full in the Authentication document §9.1 — not re-explained here |
| **Environment variables** | The MongoDB connection string itself is read from centralized environment configuration (Backend Architecture document §5), never hard-coded |
| **Data isolation** | Every non-account collection carries a `projectId`, which is what makes per-project data isolation enforceable — a query that forgets to filter by an authorized project would be a real, application-level bug, since the database itself does not partition data by tenant |

---

## 11. Backup & Recovery

### 11.1 Current Approach

Durability rests on MongoDB Atlas's own managed backup/replication infrastructure — this project does not implement any of its own database-level backup tooling. Application-level recovery mechanisms exist at a finer grain, specifically for collaboration state:

- **Snapshots** (§3.8) are the user-facing, deliberate "restore my project to this point" mechanism.
- **`CRDTDocument`/`CRDTSnapshot`** together are the automatic, non-user-facing recovery path for a single file's live collaborative state (Collaboration System document §7.2) — a debounced always-fresh copy, with a periodic fallback behind it.

### 11.2 Recovery Considerations

A full database restore (from an Atlas backup) would recover every collection consistently. A partial, targeted recovery — "undo this one file's last save" without touching anything else — is not a capability this system currently exposes; the closest available tool is restoring a project-wide Snapshot, which affects every file and folder in the project at once (Collaboration System document §10.3), not a single file in isolation.

### 11.3 Future Improvements

See §13 — in particular, a formal, scheduled application-level backup/export (beyond relying entirely on the managed cluster's own backup policy) and finer-grained, per-file restore are both realistic, currently-unimplemented extensions of the recovery story described above.

---

## 12. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why MongoDB** | The domain's core entities are naturally document-shaped, without a strong need for rigid multi-table joins | Flexible schema evolution; a managed cluster (Atlas) removes database operations burden | Referential integrity is an application discipline, not a database guarantee (§8.2) |
| **Why a document database (over relational)** | Nested, variable-shape data (a project's member list, a snapshot's embedded file tree) maps naturally onto documents without a normalization step | Fewer joins for the read patterns this app actually has (mostly single-collection or project-scoped queries) | Cross-collection consistency (e.g. a cascading delete) must be implemented explicitly, not inherited from `ON DELETE CASCADE`-style constraints |
| **Why references over embedding, as the general rule** | Most entities in this system (files, folders, chat, activity) have independent lifecycles and are queried/mutated on their own | Small, targeted writes; no risk of one entity's update requiring a rewrite of an unrelated parent document | An extra query (or a small number of them) to assemble a full "project tree" view, versus one document read if everything were embedded — accepted, since the tree-assembly queries are already indexed appropriately (§7.1) |
| **Why Snapshot is the deliberate exception (embedding)** | A snapshot's entire purpose is to be a frozen, non-live copy | Correctly models "this can never drift" as a structural property, not an invariant that has to be separately maintained | A large project produces a large Snapshot document — an accepted cost given how infrequently snapshots are taken relative to ordinary edits |
| **Why timestamps (`createdAt`/`updatedAt`) on every collection** | Nearly every list-style feature (chat, activity, snapshots) needs "newest first" ordering, and lifecycle reasoning throughout this document (§5, §8) depends on knowing when something was written | Free, automatic, and consistent across every collection via Mongoose's `timestamps: true` option; directly supports the compound indexes in §7.1 | None of real consequence — this is close to a strictly-beneficial default for this application's access patterns |
| **Why Mongoose (over the raw MongoDB driver)** | Schema-level validation (§6.1), typed models, and query ergonomics matter more here than the marginal overhead Mongoose adds | Required fields, enums, and defaults enforced consistently without hand-writing validation for every write path | A thin abstraction layer over the driver — an accepted, standard trade for a Node/Express backend of this shape |

---

## 13. Future Improvements

| Improvement | What it would address |
|---|---|
| **Soft deletes** | Today's hard-delete model (§8.3) offers no undo for an accidental Project/File/Folder deletion beyond restoring a prior Snapshot (which is project-wide, not targeted); a `deletedAt` marker with a grace-period purge would close this gap |
| **Cascading deletes (or a cleanup job)** | Deleting a Project today does not remove its dependent Files/Folders/Snapshots/ChatMessages/WorkspaceActivity (§8.3) — either a transactional cascade or an asynchronous cleanup job would prevent orphaned data from accumulating |
| **Audit logs** | `WorkspaceActivity` covers workspace mutations specifically; a more general, platform-wide audit trail (auth events, role changes, admin actions) does not currently exist |
| **Version history (beyond Snapshots)** | Snapshots are coarse, project-wide, and user-triggered; genuine per-file version history (every save, not just deliberate checkpoints) would be a meaningfully different, finer-grained capability |
| **Redis caching** | Frequently-read, rarely-changing data (project membership, checked on nearly every project-scoped request) is a candidate for a short-lived cache layer in front of MongoDB, not currently implemented |
| **Search indexing** | There is no full-text search across file contents, chat history, or project names today — a dedicated search index (MongoDB Atlas Search, or an external engine) would be required to support that |
| **Sharding** | Not needed at current scale; the existing project-scoped query pattern throughout this schema (§9) would shard cleanly by `projectId` if data volume ever required it |
| **Multi-region replication** | Currently relies on Atlas's default replication topology within its configured region; multi-region would be a deployment/infrastructure configuration change more than a schema change |
| **Analytics collections** | Beyond the execution engine's existing in-memory metrics (Docker Execution Engine document §8), no durable, queryable analytics data currently exists in MongoDB — a dedicated collection (or export pipeline) would be needed for historical analysis |
| **Closing the `CRDTSnapshot` indexing gap** | As identified concretely in §7.2 — a compound index matching the same shape already applied to Snapshot/ChatMessage/WorkspaceActivity |
| **An `inviteeEmail` index on Invitation** | As identified in §7.4 — supporting the "my pending invitations" query directly rather than relying on a collection scan |

---

## 14. Conclusion

Code Ground's data model is organized around one consistent discipline, applied throughout: **reference anything with its own independent lifecycle, embed only what is genuinely frozen at creation, and let every query pattern that's actually used earn its own index** — rather than either over-normalizing (referencing everything, including data that will never change) or over-embedding (nesting live, independently-mutating data inside a parent document for convenience). Project is the tenancy boundary nearly everything else hangs off of; the CRDT persistence layer is deliberately decoupled from the File document it backs, reflecting that collaborative editing state has a genuinely different shape and lifecycle than a file's last-saved content; and Snapshots are the one deliberate embedding exception, correctly modeling a frozen copy as a frozen copy rather than a relationship that needs to be kept in sync.

The schema is honest about its current gaps rather than presented as complete: hard deletes with no cascade, one identified missing index, and several unused legacy model files sitting alongside the live schema are all documented here plainly, because a database design document that hides its own rough edges is less useful to a future contributor than one that names them precisely enough to fix.

---

*This document should be revisited if any of the Future Improvements in §13 are implemented — in particular, adding soft deletes or cascading deletes would change the integrity guarantees described in §8.3.*
