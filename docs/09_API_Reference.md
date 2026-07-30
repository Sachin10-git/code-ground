# Code Ground — API Reference

> **Scope of this document:** A complete reference for every public interface the Code Ground backend exposes — REST endpoints and Socket.IO events — as they are actually implemented today. This is a reference manual, not an architecture document: it documents *what* each interface accepts and returns, not *why* the subsystem behind it is built the way it is. For architectural context, see the companion documents referenced throughout (particularly [`02_Backend_Architecture.md`](./02_Backend_Architecture.md), [`04_Authentication.md`](./04_Authentication.md), [`05_Collaboration_System.md`](./05_Collaboration_System.md), [`06_AI_Assistant.md`](./06_AI_Assistant.md), [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md), and [`08_Interactive_Terminal.md`](./08_Interactive_Terminal.md)).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Base Configuration](#2-base-configuration)
3. [Authentication APIs](#3-authentication-apis)
4. [Project APIs](#4-project-apis)
5. [File APIs](#5-file-apis)
6. [AI APIs](#6-ai-apis)
7. [Execution APIs](#7-execution-apis)
8. [Socket.IO APIs](#8-socketio-apis)
9. [Error Responses](#9-error-responses)
10. [Authentication Flow](#10-authentication-flow)
11. [API Best Practices](#11-api-best-practices)
12. [Future API Improvements](#12-future-api-improvements)
13. [Conclusion](#13-conclusion)

---

## 1. Introduction

### 1.1 Purpose of This Document

This document is the single source of truth for every REST endpoint and Socket.IO event the Code Ground backend exposes, as implemented. It is intended to be used directly — by a frontend developer wiring up a new UI, a contributor adding a feature, or anyone needing to know exactly what a given endpoint expects and returns — without needing to read backend source.

### 1.2 REST API Philosophy

The REST API is organized by resource (`/api/auth`, `/api/projects`, `/api/ai`, `/api/execution`, `/api/health`), returns one consistent success envelope across every endpoint, and treats every route as thin — validation and authorization happen in middleware before a controller runs, and a controller's job is only to call one service and shape its result (see the Backend Architecture document §6–§8).

### 1.3 Socket.IO API Philosophy

Real-time behavior is split across three independent namespaces (default, `/workspace`, `/terminal`), each authenticated independently with the same JWT the REST API uses, each scoped to its own domain of events, and each with its own room/session model. See the Backend Architecture document §10 and the Collaboration System document for why this split exists.

### 1.4 Versioning Strategy

There is currently **no version prefix** in the API surface (e.g. no `/api/v1`) — every endpoint documented here is the current, only version. Versioning is discussed as a future improvement in §12.

---

## 2. Base Configuration

| Property | Value |
|---|---|
| **Base URL** | `/api` (proxied to the backend in development; served from the same origin as the frontend in production) |
| **Socket.IO base** | `/socket.io` (default namespace at `/`, plus `/workspace` and `/terminal`) |
| **Content-Type** | `application/json` for every request body and response |
| **Authentication method** | JWT bearer token (REST) / handshake `auth.token` (Socket.IO) — see [§10](#10-authentication-flow) |
| **Auth header** | `Authorization: Bearer <accessToken>` |
| **Refresh token transport** | `httpOnly` cookie (`refreshToken`) — never sent in a response body, never readable by client-side JavaScript |

### 2.1 Success Response Envelope

Every successful response (via the `ApiResponse.success` helper) uses this shape:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Human-readable description of what happened",
  "data": { "...": "endpoint-specific payload, or null" }
}
```

### 2.2 Error Response Envelope

**Not fully uniform** — see [§9](#9-error-responses) for the exact shapes and the (documented, honest) inconsistency between validation errors and thrown application errors.

---

## 3. Authentication APIs

Base path: `/api/auth`. Full architectural detail: [`04_Authentication.md`](./04_Authentication.md).

### 3.1 Register

| | |
|---|---|
| **Purpose** | Create a new account |
| **Method / URL** | `POST /api/auth/register` |
| **Auth required** | No |
| **Request body** | `{ "username": string, "email": string, "password": string }` |
| **Validation** | username: 3–30 chars, alphanumeric/underscore; email: valid format; password: 8–64 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit, ≥1 special character |
| **Success response** | `201` — `data: { user: {...}, accessToken }`; sets `refreshToken` cookie |
| **Possible errors** | `400` validation failure · `409` email or username already taken |

**Example response:**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully",
  "data": {
    "user": { "id": "...", "username": "sachin", "email": "sachin@example.com", "avatar": "", "role": "user", "workspaces": [] },
    "accessToken": "eyJ..."
  }
}
```

### 3.2 Login

| | |
|---|---|
| **Purpose** | Authenticate an existing account |
| **Method / URL** | `POST /api/auth/login` |
| **Auth required** | No |
| **Request body** | `{ "email": string, "password": string }` |
| **Success response** | `200` — `data: { user, accessToken }`; sets `refreshToken` cookie |
| **Possible errors** | `400` validation failure · `401` invalid email or password (identical message either way) |

### 3.3 Refresh Access Token

| | |
|---|---|
| **Purpose** | Exchange a valid refresh token for a new access/refresh pair |
| **Method / URL** | `POST /api/auth/refresh` |
| **Auth required** | No bearer token — reads the `refreshToken` cookie instead |
| **Request body** | None |
| **Success response** | `200` — `data: { accessToken }`; sets a **new** `refreshToken` cookie (rotation — see Authentication document §5.4) |
| **Possible errors** | `401` missing/invalid/expired refresh token |

### 3.4 Get Current User

| | |
|---|---|
| **Purpose** | Resolve the authenticated identity for the presented access token |
| **Method / URL** | `GET /api/auth/me` |
| **Auth required** | Yes |
| **Success response** | `200` — `data: { user: { id, username, email, avatar, role, workspaces } }` |
| **Possible errors** | `401` missing/invalid/expired access token |

### 3.5 Logout

| | |
|---|---|
| **Purpose** | End the current session |
| **Method / URL** | `POST /api/auth/logout` |
| **Auth required** | Yes |
| **Success response** | `200`; revokes the current refresh token, clears the cookie |
| **Possible errors** | `401` not authenticated |

### 3.6 Logout All Devices

| | |
|---|---|
| **Purpose** | Intended to revoke every refresh token issued to the account |
| **Method / URL** | `POST /api/auth/logout-all` |
| **Auth required** | Yes |
| **Success response** | `200`; clears the cookie |
| **Possible errors** | `401` not authenticated |

> **Note:** as currently wired, this endpoint revokes only the current session's refresh token (the same effect as `/logout`), rather than every session belonging to the account. The service layer exposes a distinct "revoke all tokens for this user" capability (Authentication document §10.4) that this route does not currently call — worth being aware of if you're relying on this endpoint to end *other* sessions specifically.

### 3.7 Forgot Password

| | |
|---|---|
| **Purpose** | Request a password-reset email |
| **Method / URL** | `POST /api/auth/forgot-password` |
| **Auth required** | No |
| **Request body** | `{ "email": string }` |
| **Success response** | `200` — always a generic success message |
| **Possible errors** | `404` no user with that email |

### 3.8 Reset Password

| | |
|---|---|
| **Purpose** | Set a new password using a reset token from the emailed link |
| **Method / URL** | `POST /api/auth/reset-password/:token` |
| **Auth required** | No |
| **Request body** | `{ "password": string }` (new password) |
| **Success response** | `200` |
| **Possible errors** | `400` invalid or expired token |

### 3.9 Send Verification Email

| | |
|---|---|
| **Purpose** | Send an email-verification link to the authenticated user |
| **Method / URL** | `POST /api/auth/send-verification` |
| **Auth required** | Yes |
| **Success response** | `200` |
| **Possible errors** | `400` already verified · `401` not authenticated |

### 3.10 Verify Email

| | |
|---|---|
| **Purpose** | Mark the account's email verified |
| **Method / URL** | `GET /api/auth/verify-email/:token` |
| **Auth required** | No |
| **Success response** | `200` |
| **Possible errors** | `400` invalid or expired token |

---

## 4. Project APIs

Base path: `/api/projects`. "Project" and "Workspace" are used interchangeably in response messages — they refer to the same resource.

### 4.1 Create Project

| | |
|---|---|
| **Method / URL** | `POST /api/projects` |
| **Auth required** | Yes |
| **Request body** | `{ "name": string, "description"?: string }` — name 3–50 chars, description ≤500 chars |
| **Success response** | `201` — `data:` the created project (creator recorded as owner) |
| **Possible errors** | `400` validation · `401` unauthenticated |

### 4.2 List My Projects

| | |
|---|---|
| **Method / URL** | `GET /api/projects` |
| **Auth required** | Yes |
| **Success response** | `200` — `data:` array of projects the user owns or is a member of |

### 4.3 Get Project by ID

| | |
|---|---|
| **Method / URL** | `GET /api/projects/:id` |
| **Auth required** | Yes (must be a project member) |
| **Success response** | `200` — `data:` the project |
| **Possible errors** | `403` not a member · `404` not found |

### 4.4 Get Project Members

| | |
|---|---|
| **Method / URL** | `GET /api/projects/:id/members` |
| **Auth required** | Yes (must be a project member) |
| **Success response** | `200` — `data:` array of members and their roles |

### 4.5 Update (Rename) Project

| | |
|---|---|
| **Method / URL** | `PATCH /api/projects/:id` |
| **Auth required** | Yes — **owner only** |
| **Request body** | `{ "name"?: string, "description"?: string }` |
| **Success response** | `200` — `data:` the updated project |
| **Possible errors** | `400` validation · `403` not the owner · `404` not found |

### 4.6 Delete Project

| | |
|---|---|
| **Method / URL** | `DELETE /api/projects/:id` |
| **Auth required** | Yes — **owner only** |
| **Success response** | `200` |
| **Possible errors** | `403` not the owner · `404` not found |

### 4.7 Leave Workspace

| | |
|---|---|
| **Method / URL** | `POST /api/projects/:id/leave` |
| **Auth required** | Yes (must be a project member) |
| **Success response** | `200` — `data:` the project |

### 4.8 Invitations (Membership)

Base path: `/api/invitations` — a separate top-level resource, not nested under `/api/projects`.

| Endpoint | Method | Purpose | Request body |
|---|---|---|---|
| `/api/invitations/:id/invite` | `POST` | Invite a user to project `:id` by email | `{ "email": string, "role"?: "viewer" \| "editor" }` |
| `/api/invitations` | `GET` | List the authenticated user's own pending invitations | — |
| `/api/invitations/invite/:invitationId/accept` | `POST` | Accept a pending invitation | — |
| `/api/invitations/invite/:invitationId/reject` | `POST` | Reject a pending invitation | — |

All four require authentication. Accepting returns the joined project; rejecting returns the updated invitation record.

---

## 5. File APIs

Base path: `/api/projects` (files and folders are nested resources under a project).

### 5.1 Get Project Tree

| | |
|---|---|
| **Purpose** | Fetch a project's full folder/file structure |
| **Method / URL** | `GET /api/projects/:projectId/tree` |
| **Auth required** | Yes (project member) |
| **Success response** | `200` — `data: { folders: [...], files: [...] }` |

### 5.2 Create File

| | |
|---|---|
| **Method / URL** | `POST /api/projects/:projectId/files` |
| **Auth required** | Yes |
| **Request body** | `{ "name": string, "language": string, "folderId"?: string \| null, "content"?: string }` |
| **Success response** | `201` — `data:` the created file; also broadcasts `workspace:file-created` |
| **Possible errors** | `403` not a member · `404` project/folder not found |

### 5.3 Rename File

| | |
|---|---|
| **Method / URL** | `PATCH /api/projects/files/:fileId` |
| **Request body** | `{ "name": string }` |
| **Success response** | `200`; also broadcasts `workspace:file-renamed` |

### 5.4 Save File Content

| | |
|---|---|
| **Purpose** | Persist a file's content (the explicit Save action) |
| **Method / URL** | `PATCH /api/projects/files/:fileId/content` |
| **Request body** | `{ "content": string }` |
| **Success response** | `200` — `data:` the updated file |
| **Note** | If the file has an active collaboration room, the live CRDT document is reconciled to match — see the Collaboration System document §11.4 |

### 5.5 Move File

| | |
|---|---|
| **Method / URL** | `PATCH /api/projects/files/:fileId/move` |
| **Request body** | `{ "folderId": string \| null }` (`null` moves it to the project root) |
| **Success response** | `200`; also broadcasts `workspace:file-moved` |

### 5.6 Delete File

| | |
|---|---|
| **Method / URL** | `DELETE /api/projects/files/:fileId` |
| **Success response** | `200`; also broadcasts `workspace:file-deleted` |

### 5.7 Folder Endpoints

| Endpoint | Method | Request body |
|---|---|---|
| `/api/projects/:projectId/folders` | `POST` | `{ "name": string, "parentFolderId"?: string \| null }` |
| `/api/projects/folders/:folderId` | `PATCH` | `{ "name": string }` (rename) |
| `/api/projects/folders/:folderId/move` | `PATCH` | `{ "parentFolderId": string \| null }` |
| `/api/projects/folders/:folderId` | `DELETE` | — |

Every folder mutation also broadcasts a corresponding `workspace:folder-*` event.

### 5.8 Activity Feed

| | |
|---|---|
| **Method / URL** | `GET /api/projects/:projectId/activity` |
| **Purpose** | Fetch recent workspace activity history — used to seed the feed before live socket events take over |
| **Auth required** | Yes (project member) |
| **Success response** | `200` — `data:` array of recent activity entries |

### 5.9 Snapshots

| Endpoint | Method | Purpose | Request body |
|---|---|---|---|
| `/api/projects/:projectId/snapshots` | `POST` | Create a snapshot | `{ "name"?: string }` (≤100 chars; falls back to a generated label if omitted) |
| `/api/projects/:projectId/snapshots` | `GET` | List snapshots | — |
| `/api/projects/snapshots/:snapshotId` | `PATCH` | Rename a snapshot | `{ "name": string }` |
| `/api/projects/snapshots/:snapshotId` | `DELETE` | Delete a snapshot | — |
| `/api/projects/snapshots/:snapshotId/restore` | `POST` | Restore the project to this snapshot | — |

Every snapshot mutation broadcasts a corresponding `workspace:snapshot-*` event; restoring additionally triggers a full workspace-tree resync for every connected client (Collaboration System document §10.3).

---

## 6. AI APIs

Base path: `/api/ai`. Full architectural detail: [`06_AI_Assistant.md`](./06_AI_Assistant.md). All five endpoints share an identical request shape and response envelope.

### 6.1 Shared Request Body

```json
{
  "projectId": "mongoId (required)",
  "fileId": "mongoId (required)",
  "userPrompt": "string, required, ≤8000 characters",
  "selectedCode": "string, optional",
  "fileContent": "string, optional (the live editor buffer)",
  "chatHistory": "array, optional (prior turns — Chat only)"
}
```

### 6.2 Shared Response Shape

```json
{
  "success": true,
  "response": "string — the model's Markdown-formatted reply"
}
```

> Note the AI endpoints use `{ success, response }` directly, **not** the `{ success, statusCode, message, data }` envelope used everywhere else in the API — an inconsistency worth knowing if you're writing a generic response handler.

### 6.3 Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/ai/chat` | Open-ended conversational Q&A about the current file |
| `POST /api/ai/explain` | Explain the selected code (or whole file) |
| `POST /api/ai/review` | Structured code review (Overall Assessment → Strengths → Issues Found → Summary) |
| `POST /api/ai/refactor` | Suggest an improved version of the selected code |
| `POST /api/ai/generate` | Generate new code from `userPrompt`'s natural-language instruction |

All five require authentication, and all five verify the authenticated user is a member of `projectId` and that `fileId` actually belongs to `projectId` before any model call is made (Authentication document §10; AI Assistant document §9).

**Possible errors:** `400` validation (missing/oversized `userPrompt`, invalid IDs) · `401` unauthenticated · `403` not a project member, or file/project mismatch · `404` project or file not found · `502` the AI provider failed or is temporarily unavailable · `503` the AI service has no API key configured.

---

## 7. Execution APIs

Base path: `/api/execution` and `/api/health`. Full architectural detail: [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md). For **interactive** execution, see [§8.3](#83-terminal-namespace) and [`08_Interactive_Terminal.md`](./08_Interactive_Terminal.md) — there is no REST endpoint for interactive sessions; they are Socket.IO-only.

### 7.1 Run Code

| | |
|---|---|
| **Purpose** | Execute a single, complete code submission and return its buffered result |
| **Method / URL** | `POST /api/execution/run` |
| **Auth required** | No authentication middleware is currently attached to this route (see the Backend Architecture document §17's noted gap) |
| **Request body** | `{ "language": string, "code": string }` |
| **Supported languages** | `java`, `javascript`, `python`, `typescript`, `cpp`, `go` |
| **Success response** | `200` — `data: { exitCode: number|null, stdout: string, stderr: string, timedOut: boolean }` |
| **Possible errors** | `400` missing/unsupported language, missing/empty code · `500`/`502`-equivalent infrastructure failure (Docker unreachable, image pull failure) |

**Example request:**
```json
{ "language": "python", "code": "print('Hello, Code Ground!')" }
```

**Example response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Execution completed",
  "data": { "exitCode": 0, "stdout": "Hello, Code Ground!", "stderr": "", "timedOut": false }
}
```

### 7.2 Legacy Runner Endpoint (Deprecated)

`POST /api/run` exists as an earlier, superseded implementation of code execution, predating the current engine — it is not used by the frontend and does not carry the current engine's queue, metrics, or hardening. Treat it as deprecated; new integrations should use `/api/execution/run`.

### 7.3 Health Endpoint

| | |
|---|---|
| **Purpose** | Report backend uptime/memory plus the execution engine's real runtime state |
| **Method / URL** | `GET /api/health` |
| **Auth required** | No |
| **Success response** | `200`, always — see shape below |

**Example response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Server is healthy",
  "data": {
    "status": "ok",
    "uptime": 1234.5,
    "timestamp": "2026-07-30T12:00:00.000Z",
    "environment": "production",
    "memory": { "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 },
    "docker": { "reachable": true, "version": "29.6.2", "error": null },
    "requiredImages": [ { "image": "python:3.12", "available": true } ],
    "executionQueue": { "active": 0, "waiting": 0, "maxConcurrent": 4 },
    "executionMetrics": { "summary": { "count": 0, "succeeded": 0, "failed": 0, "timedOut": 0, "byLanguage": {} }, "recent": [] }
  }
}
```

`data.status` is `"ok"` or `"degraded"` (Docker unreachable) — the HTTP status is always `200`; see the Docker Execution Engine document §9.3 for why.

---

## 8. Socket.IO APIs

Three independent namespaces. Every connection authenticates via `auth: { token: <accessToken> }` in the handshake (§10).

### 8.1 Default Namespace (`/`) — Editor Collaboration

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `room:join` | C → S | `roomId` (a file's ID) | Join a file's collaboration room |
| `room:join-failed` | S → C | `{ roomId, message }` | Hydration failed for this room — see the Collaboration System document §7 |
| `room:leave` | C → S | `roomId` | Leave a file's room |
| `room:user-joined` / `room:user-left` | S → C | array of `{ userId, username, email }` | Updated room presence list |
| `editor:document-sync` | S → C | binary Yjs state | Full current document state, sent once on join |
| `editor:file-change` | C → S | `{ roomId, update }` (binary) | A local CRDT update to apply and broadcast |
| `editor:file-updated` | S → C | `{ socketId, update }` (binary) | A remote CRDT update to apply locally |
| `editor:typing-start` / `editor:typing-stop` | C → S | `roomId` | Typing signal |
| `editor:user-typing` / `editor:user-stopped-typing` | S → C | `{ socketId }` | Relayed typing signal |
| `editor:cursor-move` | C → S | `{ roomId, cursor }` | Local cursor/selection position |
| `editor:cursor-updated` | S → C | `{ socketId, userId, username, cursor }` | Relayed cursor position |
| `editor:selection-change` | C → S | `{ roomId, selection }` | Local selection range |
| `editor:selection-updated` | S → C | `{ socketId, selection }` | Relayed selection |
| `editor:file-lock` / `editor:file-unlock` | C → S | `{ roomId, fileId, projectId?, fileName? }` | Acquire/release the advisory edit lock |
| `editor:file-locked` / `editor:file-unlocked` | S → C | `{ fileId, lockedBy, userId }` | Lock state change |
| `editor:file-lock-failed` | S → C | `{ fileId, lockedBy }` | Lock acquisition denied (already held) |
| `editor:awareness-update` | C → S | `{ roomId, state }` | Generic Yjs Awareness field update |
| `editor:awareness-changed` | S → C | `{ socketId, state }` | Relayed awareness update |

### 8.2 `/workspace` Namespace — Project-Wide Events

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `workspace:join` / `workspace:leave` | C → S | `{ projectId }` | Join/leave a project's room |
| `workspace:file-created` / `-renamed` / `-deleted` / `-moved` | S → C | the affected file + actor username | Live file-tree sync |
| `workspace:folder-created` / `-renamed` / `-deleted` / `-moved` | S → C | the affected folder + actor username | Live folder-tree sync |
| `workspace:activity` | C → S | `{ projectId }` | Ping: "I just made a workspace mutation" |
| `workspace:user-active` | S → C | actor info | Relayed activity indicator |
| `workspace:file-presence` / `-leave` | C → S | `{ projectId, fileId, state? }` | Announce/retract "viewing"/"editing" a file |
| `workspace:file-present` / `-absent` | S → C | presence entry | Relayed file presence |
| `workspace:file-locked` / `-unlocked` | S → C | lock info | Project-wide echo of the default namespace's file lock |
| `workspace:snapshot-created` / `-renamed` / `-deleted` / `-restored` | S → C | snapshot info | Live snapshot sync (restore additionally implies a full tree resync) |
| `team-chat:send` | C → S | `{ projectId, message }` | Send a chat message |
| `team-chat:message` | S → C | persisted message | Broadcast (including back to the sender) |
| `team-chat:history` | S → C | `{ projectId, messages: [...] }` | Sent once on join — recent chat history |

### 8.3 `/terminal` Namespace — Interactive Execution

Full protocol detail (including payload fields and lifecycle position): [`08_Interactive_Terminal.md`](./08_Interactive_Terminal.md) §9.

| Event | Direction | Payload |
|---|---|---|
| `terminal:start` | C → S | `{ language, code, projectId? }` |
| `terminal:ready` | S → C | `{ sessionId, language }` |
| `terminal:output` | S → C | `{ sessionId, data }` |
| `terminal:input` | C → S | `{ sessionId, data }` |
| `terminal:resize` | C → S | `{ sessionId, cols, rows }` |
| `terminal:stop` | C → S | `{ sessionId }` |
| `terminal:exit` | S → C | `{ sessionId, exitCode, reason, truncated }` |
| `terminal:error` | S → C | `{ sessionId, message }` |

Every `terminal:input`/`terminal:resize`/`terminal:stop` is silently ignored unless it comes from the exact socket that created the referenced session (Interactive Terminal document §10).

---

## 9. Error Responses

### 9.1 Status Codes in Use

| Code | Meaning here | Example trigger |
|---|---|---|
| **400** | Bad request / validation failure | Missing required field, malformed ID, oversized input |
| **401** | Not authenticated | Missing/invalid/expired JWT, wrong login credentials |
| **403** | Authenticated but not authorized | Not a project member, wrong role, file/project mismatch on an AI request |
| **404** | Resource not found | Unknown project/file/folder/snapshot/invitation ID |
| **409** | Conflict | Duplicate email/username at registration |
| **429** | Rate limited | Not currently enforced on any route — reserved for when rate limiting is applied (see the Backend Architecture document §17) |
| **500** | Unhandled server error | An unexpected exception anywhere in the stack |
| **502** | Upstream failure | The Gemini API call failed |
| **503** | Service not configured/unavailable | The AI provider has no API key configured |

### 9.2 Error Shapes — Three Distinct Formats in Use

This API does **not** use one uniform error body. Documented honestly, as implemented:

**A. Thrown application errors** (caught by the global error handler):
```json
{ "success": false, "statusCode": 404, "message": "Workspace not found" }
```

**B. Validation errors — auth routes only:**
```json
{ "success": false, "statusCode": 400, "message": "Validation failed", "errors": { "email": "Please provide a valid email" } }
```

**C. Validation errors — every other validated route** (projects, invitations, snapshots, AI):
```json
{ "success": false, "errors": [ { "type": "field", "msg": "Project name is required", "path": "name", "location": "body" } ] }
```

Shape C is the raw `express-validator` error array, with no `statusCode` or `message` field at all. A client consuming this API generically should handle all three shapes — checking for `errors` as either an object or an array, and tolerating a missing `statusCode`/`message` — rather than assuming shape A everywhere.

---

## 10. Authentication Flow

Full detail: [`04_Authentication.md`](./04_Authentication.md). Summary as it applies to calling this API:

1. Obtain an access token via `POST /api/auth/register` or `/login` (§3.1–3.2).
2. Attach it as `Authorization: Bearer <accessToken>` on every subsequent REST request to a protected route.
3. Attach the **same** token as `auth: { token: <accessToken> }` when opening a Socket.IO connection to *any* of the three namespaces — each authenticates independently; there is no shared "already logged in" session state between REST and sockets, or between the three namespaces themselves.
4. When the access token expires, call `POST /api/auth/refresh` (relies on the `refreshToken` cookie, not a header) to obtain a new pair.
5. Call `POST /api/auth/logout` to end the session server-side (not just discard the token client-side).

---

## 11. API Best Practices

| Practice | How this API applies it |
|---|---|
| **Validation before business logic** | Every mutating route validates its input via middleware before a controller/service ever runs (§9.2) |
| **Consistent success responses** | Every endpoint except the five AI routes (§6.2) uses the same `{ success, statusCode, message, data }` envelope |
| **Error handling** | Centralized for thrown application errors (shape A); validation errors are handled per-validator (shapes B/C — an inconsistency to be aware of, not a best practice to emulate) |
| **Idempotency** | Not formally guaranteed anywhere (no idempotency-key mechanism); in practice, `PATCH` endpoints (rename, move, save) are naturally idempotent by virtue of what they do, but repeated `POST`s (e.g. creating a file with the same name twice) are not deduplicated |
| **Rate limiting** | `express-rate-limit` is a declared dependency but not currently applied to any specific route — see the Backend Architecture document §17 |
| **Security** | JWT on every protected route and socket namespace; project membership/role and file/session ownership checked per-resource, not just per-request (§10; Authentication document §10) |
| **Least-surprise language allowlisting** | The execution endpoint validates `language` against a fixed set (§7.1) rather than accepting arbitrary input that could otherwise reach Docker image resolution |

---

## 12. Future API Improvements

| Improvement | What it would add |
|---|---|
| **Versioning** (e.g. `/api/v1/...`) | A path for evolving request/response shapes without breaking existing consumers |
| **Pagination** | Currently, list endpoints (projects, activity, snapshots, chat history) return unbounded or fixed-window results — cursor- or offset-based pagination would be needed as data volume grows |
| **Filtering/sorting query parameters** | None of the current list endpoints accept filter/sort parameters — clients receive the full set and filter client-side |
| **Bulk operations** | File/folder mutations are currently one-at-a-time; a bulk move/delete endpoint would reduce round trips for multi-select operations |
| **A single, unified error/response envelope** | Closing the §6.2/§9.2 inconsistencies documented here would make generic client-side response handling meaningfully simpler |
| **OpenAPI/Swagger generation** | This document is currently maintained by hand; a generated spec (from route/validator definitions) would keep it mechanically in sync with the actual implementation over time |
| **Official client SDKs** | A generated or hand-written typed client (matching whatever OpenAPI spec would produce) would remove the need for consumers to hand-roll request/response types |

---

## 13. Conclusion

Code Ground's API surface is organized around one resource per route file, a single authentication mechanism (JWT) shared consistently across REST and three independent Socket.IO namespaces, and — with the two documented exceptions (§6.2's AI response shape, §9.2's three validation-error shapes) — one consistent success envelope. Those exceptions are recorded here deliberately rather than smoothed over, because a reference document that hides real inconsistencies is worse than one that names them plainly: this is the actual, current contract of the API, not an idealized one.

---

*This document should be kept in sync with the actual route/controller implementations as the API evolves — in particular, if the `/logout-all` wiring noted in §3.6 or the error-shape inconsistencies in §9.2 are corrected, this document should be updated to match.*
