# Code Ground — Authentication Subsystem

> **Scope of this document:** A complete explanation of authentication as its own subsystem — identity establishment, token architecture, password security, authorization, and how the same identity is trusted consistently across the REST API and three independent Socket.IO namespaces. This document does not explain unrelated features (projects, execution, AI); it references them only at the exact point authentication or authorization touches them.
>
> Companion documents: [`01_System_Architecture.md`](./01_System_Architecture.md) §6 and [`02_Backend_Architecture.md`](./02_Backend_Architecture.md) §17 introduced authentication at the whole-system level. This document is the authoritative, detailed reference for the subsystem itself — the earlier documents' auth sections should be considered summaries of what is fully specified here.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Authentication Architecture](#2-authentication-architecture)
3. [Registration Flow](#3-registration-flow)
4. [Login Flow](#4-login-flow)
5. [JWT Architecture](#5-jwt-architecture)
6. [Protected Route Flow](#6-protected-route-flow)
7. [Frontend Authentication](#7-frontend-authentication)
8. [Socket.IO Authentication](#8-socketio-authentication)
9. [Password Security](#9-password-security)
10. [Authorization](#10-authorization)
11. [Security Considerations](#11-security-considerations)
12. [Error Handling](#12-error-handling)
13. [Authentication Lifecycle](#13-authentication-lifecycle)
14. [Design Decisions](#14-design-decisions)
15. [Future Improvements](#15-future-improvements)
16. [Conclusion](#16-conclusion)

---

## 1. Introduction

### 1.1 Purpose of Authentication

Authentication answers one question, correctly, for every single request the backend receives: **who is this?** Every other subsystem in Code Ground — project membership, file access, real-time collaboration, AI requests, code execution — is built on the assumption that this question has already been answered before their own logic ever runs. Authentication is therefore not a feature alongside the others; it is the foundation the rest of the platform is authorized against.

### 1.2 Why Authentication Is Necessary

Code Ground is a **multi-tenant, collaborative** system: many independent users, each with their own projects, some projects shared between specific people with specific roles, and a privileged execution engine that runs real code inside real containers. Without a reliable identity layer, none of the following could exist safely:

- Project ownership and membership (§10).
- Per-file collaboration correctly attributing edits/cursors/locks to the right person.
- An execution session that only its owner can send input to or stop.
- Any accountability at all for who ran what code, or who changed what file.

### 1.3 Security Goals

| Goal | What it means here |
|---|---|
| **Confidentiality of credentials** | A password is never stored, logged, or transmitted in a recoverable form |
| **Verifiability at every boundary** | Every REST route and every Socket.IO connection independently re-verifies identity — nothing is trusted merely because a prior request succeeded |
| **Revocability** | A compromised or logged-out session's refresh token can be invalidated server-side, not just forgotten client-side |
| **Least-trust tokens** | Access tokens are short-lived and carry minimal claims; long-lived trust lives only in the server-tracked refresh token, which can be revoked |
| **Defense at the account level, not just the token level** | Password complexity rules, hashing, and time-boxed reset/verification tokens protect the account itself, independent of how well the token layer is implemented |

### 1.4 Principles Followed

- **Stateless request verification, stateful session control.** An access token needs no database lookup to verify (fast, horizontally trivial) — but the refresh token that can mint new access tokens *is* tracked in the database, specifically so it can be revoked (§5, §10).
- **Authentication and authorization are two distinct steps, never conflated.** Knowing *who* someone is never implies knowing *what* they may do — that is always a second, separate check (§10).
- **Every transport re-verifies independently.** REST and Socket.IO share the same JWT and the same verification logic, but neither trusts the other's prior check (§8).

---

## 2. Authentication Architecture

```
                     ┌───────────────┐
                     │    Frontend      │
                     │  (stores JWT,     │
                     │   attaches it to    │
                     │   every request)     │
                     └───────┬───────┘
                             │  Authorization: Bearer <token>
                             │  (REST)   —or—   auth: { token } (Socket.IO handshake)
                             ▼
                  ┌─────────────────────┐
                  │       REST API           │
                  │   (Express routes)         │
                  └───────────┬─────────┘
                              ▼
                  ┌─────────────────────┐
                  │  Authentication            │
                  │  Middleware                  │
                  │  (`authenticate` for REST;    │
                  │   a per-namespace `io.use`      │
                  │   for Socket.IO)                 │
                  └───────────┬─────────┘
                              ▼
                  ┌─────────────────────┐
                  │         JWT                │
                  │  verify signature +           │
                  │  expiry against the             │
                  │  server's secret                 │
                  └───────────┬─────────┘
                              ▼
                  ┌─────────────────────┐
                  │       MongoDB              │
                  │  resolve the token's           │
                  │  `id` claim to a real User       │
                  │  document (rejecting a             │
                  │  token for a deleted user)           │
                  └───────────┬─────────┘
                              ▼
                  ┌─────────────────────┐
                  │  Protected Resources        │
                  │  (req.user / socket.user        │
                  │   now available to every            │
                  │   downstream controller/handler)      │
                  └─────────────────────┘
```

Every layer in this diagram is mandatory and ordered — a request cannot reach "Protected Resources" by skipping the JWT verification step, and JWT verification cannot succeed without a validly signed, unexpired token.

---

## 3. Registration Flow

### 3.1 Steps

1. **Client submits** a username, email, and password.
2. **Validation** (before any business logic runs): username 3–30 characters, alphanumeric/underscore only; email must be a syntactically valid address; password 8–64 characters, requiring at least one uppercase letter, one lowercase letter, one digit, and one special character. Any violation returns a `400` with field-specific messages, and no further processing occurs.
3. **Uniqueness checks**: the email and username are each checked against existing accounts; either collision is rejected with a `409 Conflict` before a password is ever hashed.
4. **Password hashing**: the plaintext password is hashed (bcrypt) — this is the last time the plaintext value exists anywhere in the system.
5. **Database storage**: a new `User` document is created with the hashed password (never the plaintext).
6. **Token issuance**: an access token and a refresh token are generated immediately, and the refresh token is persisted (§5.3) so the newly created account is immediately usable without a separate login step.
7. **Success response**: the access token and a sanitized user object (explicitly excluding the password) are returned in the response body; the refresh token is set as an `httpOnly` cookie, never exposed to client-side JavaScript.

### 3.2 Sequence Diagram

```
 Client                 Validators              AuthService              MongoDB
   │                        │                       │                       │
   │  POST /auth/register     │                       │                       │
   │ ───────────────────────▶ │                       │                       │
   │                        │  format/complexity check   │                       │
   │                        │  (400 on failure, stop here) │                       │
   │                        │ ───────────────────────▶ │                       │
   │                        │                       │  check email/username     │
   │                        │                       │  uniqueness                  │
   │                        │                       │ ───────────────────────▶ │
   │                        │                       │  (409 if taken)              │
   │                        │                       │ ◀───────────────────────  │
   │                        │                       │  hash password (bcrypt)        │
   │                        │                       │  create User document            │
   │                        │                       │ ───────────────────────▶ │
   │                        │                       │  issue access + refresh JWT        │
   │                        │                       │  persist refresh token               │
   │  201 { accessToken,      │                       │                       │
   │        user }              │                       │                       │
   │  Set-Cookie: refreshToken   │                       │                       │
   │ ◀─────────────────────── │                       │                       │
```

---

## 4. Login Flow

### 4.1 Steps

1. **Client submits** email and password (basic presence validation only — complexity rules apply at registration, not login, since an existing password may predate a rule change).
2. **User lookup** by email; a non-existent email and an incorrect password return the **same generic error** ("Invalid email or password") — never revealing which of the two was wrong, to avoid leaking which emails are registered.
3. **Password verification**: the submitted password is compared against the stored hash using bcrypt's constant-time comparison (§9).
4. **JWT creation**: a new access token and a new refresh token are issued (a login always mints a fresh pair, never reuses a prior session's tokens).
5. **Persistence**: the new refresh token is stored server-side with its expiry, associated with this user.
6. **Token response**: the access token and sanitized user object are returned in the body; the refresh token is set as an `httpOnly` cookie.
7. **Frontend storage**: the access token is stored client-side (in `localStorage`, per the Frontend Architecture document §13) and attached to every subsequent REST request and Socket.IO connection.

### 4.2 Sequence Diagram

```
 Client                      AuthService                 MongoDB
   │                              │                           │
   │  POST /auth/login              │                           │
   │ ───────────────────────────▶ │                           │
   │                              │  find User by email            │
   │                              │ ───────────────────────────▶ │
   │                              │  (404-equivalent generic error   │
   │                              │   if not found)                    │
   │                              │ ◀───────────────────────────  │
   │                              │  bcrypt.compare(password, hash)     │
   │                              │  (generic error on mismatch,           │
   │                              │   same message as "not found")           │
   │                              │  issue access + refresh JWT                │
   │                              │  persist refresh token                       │
   │                              │ ───────────────────────────▶ │
   │  200 { accessToken, user }      │                           │
   │  Set-Cookie: refreshToken          │                           │
   │ ◀─────────────────────────── │                           │
   │                              │                           │
   │  (frontend) store accessToken     │                           │
   │  attach as Authorization: Bearer     │                           │
   │  on every future request               │                           │
```

---

## 5. JWT Architecture

### 5.1 Token Structure

Code Ground issues **two distinct JWTs** at login/registration, each signed with its own secret and its own expiry, serving different purposes:

| Token | Claims | Lifetime | Where held | Purpose |
|---|---|---|---|---|
| **Access Token** | `{ id: <userId> }` | Short-lived (configured, typically minutes) | Client-side (`localStorage`), attached to every request | Proves identity for REST calls and Socket.IO handshakes — verified with no database lookup |
| **Refresh Token** | `{ id: <userId> }` | Longer-lived (7 days) | Server-side (`RefreshToken` collection) + `httpOnly` cookie | Used solely to mint a new access token when the old one expires; revocable independently of the access token |

Both tokens deliberately carry the **same minimal claim** — just the user's ID. No role, no email, no permission list is embedded in the token itself: authorization is always re-derived from the current database state at request time (§10), so a permission change takes effect immediately rather than waiting for a token to expire.

### 5.2 Signing and Verification

Each token type is signed with its **own secret** (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`), so a compromised access-token secret cannot be used to forge a refresh token, and vice versa. Verification is symmetric: the same secret and the same library call used to sign a token is used to verify it, rejecting anything with an invalid signature or an elapsed expiry.

### 5.3 Why the Refresh Token Is Also Database-Tracked

Unlike a purely stateless design, Code Ground's refresh tokens are **persisted server-side** (associated with a user, with an expiry and a revocation flag). This is a deliberate hybrid: the access token stays fully stateless (fast, no DB round-trip to verify), while the refresh token — the one credential with real, extended lifetime — gains the one property pure statelessness cannot provide: **the ability to revoke a session before its token naturally expires** (used by logout, and by the account-wide invalidation capability described in §10.4).

### 5.4 Refresh Token Rotation

Every time a refresh token is used to obtain a new access token, the **old refresh token is revoked and a brand-new one is issued** in its place (`refreshAccessToken` in the auth service: verify → look up → revoke the old one → issue and persist a new pair). This means a refresh token is effectively single-use — if a stolen refresh token is ever used by an attacker after the legitimate client has already rotated it, the stolen copy is already revoked and fails.

### 5.5 Why JWT Over Server-Side Sessions

| | JWT (chosen) | Server-side sessions |
|---|---|---|
| **Verifying a request** | No database round-trip — decode + signature check | Requires a session-store lookup on every request |
| **Scaling across processes** | Any backend instance can verify any token with the shared secret | Requires a shared session store (e.g. Redis) for multiple instances to agree |
| **Fits the multi-transport model** | The identical token verifies REST requests and Socket.IO handshakes uniformly | Would require session-cookie handling to be separately reconciled for WebSocket upgrades |
| **Trade-off accepted** | An access token can't be individually revoked before it expires (mitigated by keeping it short-lived and pairing it with a revocable refresh token) | Full server-side revocability at any instant, at the cost of a stateful lookup per request |

---

## 6. Protected Route Flow

### 6.1 Steps

1. A request arrives at a route requiring authentication.
2. The `authenticate` middleware reads the `Authorization` header; a missing header, or one not in `Bearer <token>` form, is rejected immediately with `401`.
3. The access token is verified against `JWT_ACCESS_SECRET` — an invalid signature or expired token is rejected with `401`.
4. The token's `id` claim is used to look up the corresponding `User` in MongoDB (excluding the password field) — **this step is why deleting a user immediately invalidates any of their still-unexpired access tokens**, since the lookup will fail even for a cryptographically valid token.
5. The resolved user is attached to the request (`req.user`), and control passes to the next middleware/controller — which, for project-scoped routes, is typically an authorization check (§10) before reaching business logic.

### 6.2 Sequence Diagram

```
 Client                Authenticate Middleware              MongoDB              Controller
   │                            │                              │                       │
   │  GET /api/projects            │                              │                       │
   │  Authorization: Bearer <token>  │                              │                       │
   │ ─────────────────────────▶  │                              │                       │
   │                            │  no/malformed header?             │                       │
   │                            │  ──▶ 401, stop here                 │                       │
   │                            │  verify JWT signature + expiry         │                       │
   │                            │  ──▶ 401 if invalid/expired, stop here   │                       │
   │                            │  find User by decoded id                    │                       │
   │                            │ ───────────────────────────────▶ │                       │
   │                            │  not found (deleted user)?              │                       │
   │                            │  ──▶ 401, stop here                       │                       │
   │                            │  found                                       │                       │
   │                            │ ◀─────────────────────────────── │                       │
   │                            │  req.user = user                              │                       │
   │                            │ ───────────────────────────────────────────────────────▶ │
   │                            │                              │                    controller runs
   │  200 (or further 403 from      │                              │                       │
   │   an authorization check)        │                              │                       │
   │ ◀───────────────────────── │                              │                       │
```

---

## 7. Frontend Authentication

*(The frontend's general hook/state architecture is covered in the [Frontend Architecture document](./03_Frontend_Architecture.md) §6 and §13; this section focuses on authentication-specific behavior only.)*

### 7.1 Login and Register Pages

Both pages are thin forms whose submit handlers call the single shared auth action (login or register), track their own local loading/error state for the submit button, and — on success — rely on the shared auth state updating application-wide, which is what causes route guards to immediately treat the user as signed in and redirect to the Dashboard.

### 7.2 Token Storage

The access token (and a cached copy of the user object, for instant optimistic rendering) is stored in `localStorage`. The refresh token is **never** handled by frontend JavaScript at all — it exists only as an `httpOnly` cookie, set directly by the server's `Set-Cookie` response header, unreadable by any client-side script. This split is deliberate: the token the frontend actively manages (the access token) is the short-lived, lower-value one; the long-lived, higher-value credential is kept out of JavaScript's reach entirely.

### 7.3 Session Restoration

On every app boot, the frontend checks `localStorage` for a previously stored token. If present, the cached user is shown immediately (optimistic), while a background call confirms the token is still valid (and refreshes the user object with any server-side changes) — an invalid/expired result clears the stored state and falls back to the signed-out UI.

### 7.4 Logout

Logout clears both `localStorage` keys client-side and calls the backend's logout endpoint, which revokes the associated refresh token server-side (§10.4) and clears the refresh-token cookie — ending the session on both ends, not just locally forgetting it.

### 7.5 Protected Routing

Route guards (Frontend Architecture document, §4.2) read the same shared auth state to decide what is renderable, redirecting an unauthenticated user away from protected pages and an already-authenticated user away from Login/Register.

---

## 8. Socket.IO Authentication

### 8.1 Handshake-Time Authentication

Every Socket.IO namespace — the default namespace (editor collaboration), `/workspace`, and `/terminal` — registers its **own** authentication middleware (`io.use(...)`), run once, at connection time, before any event handler for that connection is reachable. The client presents the same JWT access token used for REST calls, via the connection handshake's `auth` payload — there is no separate "socket token."

### 8.2 User Association

A successful handshake verification resolves the token to a real user (the same lookup pattern as the REST `authenticate` middleware) and attaches that identity to the socket instance (`socket.user`) for the **entire lifetime of that connection** — every subsequent event on that socket can trust `socket.user` without re-verifying per event.

### 8.3 Socket Ownership

Identity is what makes **ownership** enforceable for connection-scoped resources — most concretely, an interactive execution session (§10.3): a session is recorded against the exact socket connection that created it, and every later action against that session's ID (sending input, resizing, stopping it) is checked against that recorded ownership, not merely against "is this request authenticated at all."

### 8.4 Per-Namespace Independence

```
 Client
    │
    ├──▶ connect to default namespace  ──▶ its own auth middleware verifies token
    │                                        ──▶ its own socket.user
    │
    ├──▶ connect to /workspace          ──▶ its own auth middleware verifies token
    │                                        ──▶ its own socket.user
    │                                       (a DIFFERENT connection than the default
    │                                        namespace, even from the same browser tab)
    │
    └──▶ connect to /terminal           ──▶ its own auth middleware verifies token
                                             ──▶ its own socket.user
```

Each is a physically separate connection with its own handshake and its own independent verification — one namespace's authenticated state is never implicitly extended to another.

### 8.5 Security Considerations Specific to Sockets

- **A rejected handshake never completes** — there is no partially-authenticated socket state; a connection either fully authenticates at handshake time or is refused outright.
- **Long-lived connections still carry a token with a finite lifetime.** A socket connection can outlive its access token's expiry (a socket isn't re-verified on every single event) — this is an accepted trade specific to real-time connections (re-verifying per-event would be prohibitively expensive) and is the reason execution *sessions* additionally enforce their own absolute timeout (see the Backend Architecture document §11) independent of the token that authenticated the connection that started them.
- **No cross-namespace trust** means a vulnerability or bug in one namespace's event handling cannot be leveraged to act as an authenticated user on a different namespace's rooms.

### 8.6 Sequence Diagram

```
 Client                          /terminal namespace                MongoDB
   │                                     │                              │
   │  io.connect('/terminal',              │                              │
   │    { auth: { token } })                 │                              │
   │ ─────────────────────────────────▶  │                              │
   │                                     │  io.use(...) middleware runs     │
   │                                     │  verify JWT                        │
   │                                     │  find User by decoded id              │
   │                                     │ ───────────────────────────────▶ │
   │                                     │  found                                │
   │                                     │ ◀─────────────────────────────── │
   │                                     │  socket.user = user                    │
   │  connection established                 │                              │
   │ ◀───────────────────────────────── │                              │
   │                                     │                              │
   │  terminal:start                        │                              │
   │ ─────────────────────────────────▶  │  session recorded against         │
   │                                     │  THIS socket's id                    │
```

---

## 9. Password Security

### 9.1 Hashing and Salting

Passwords are hashed with **bcrypt**, an adaptive hashing algorithm purpose-built for password storage. Bcrypt generates and embeds a unique random salt per password automatically as part of its own hash output — there is no separate, manually-managed salt value to store or lose track of, and two users with the identical password produce different stored hashes.

### 9.2 Password Comparison

Login verification never decrypts the stored hash (it cannot be decrypted — hashing is one-way). Instead, bcrypt re-hashes the submitted password using the salt embedded in the stored hash and compares the two hash outputs — a comparison bcrypt performs in a way resistant to timing-based side-channel attacks.

### 9.3 Password Policy

Enforced at registration: 8–64 characters, at least one uppercase letter, one lowercase letter, one digit, and one special character — a baseline complexity floor applied before a password is ever hashed, reducing the number of trivially-guessable stored hashes even before considering bcrypt's own resistance to brute-forcing.

### 9.4 Why Plaintext Passwords Are Never Stored

If the user database were ever compromised, a plaintext (or reversibly-encrypted) password store would hand an attacker every user's actual password immediately — and, given common password reuse, likely access to those users' accounts on *other* services too. A one-way adaptive hash means a database compromise yields only hashes that are computationally expensive to brute-force one at a time, and yields nothing at all for the (already prevented) case of password reuse across different services being directly exposed.

---

## 10. Authorization

### 10.1 Authentication vs. Authorization

These are deliberately treated as two separate questions, answered by two separate mechanisms:

| | Authentication | Authorization |
|---|---|---|
| **Question answered** | Who is making this request? | Is this specific person allowed to do this specific thing? |
| **Mechanism** | JWT verification (`authenticate` middleware / socket handshake middleware) | Per-resource checks (`authorizeProject`, session-ownership checks) |
| **Runs** | Once per request/connection | Per resource being acted on — a single request can be authenticated but still fail multiple distinct authorization checks depending on what it's trying to do |

A request that fails authentication never reaches an authorization check at all — there is no identity yet to authorize.

### 10.2 Project-Level Authorization

Every project-scoped action checks the authenticated user against that project's membership list and, where relevant, a specific role:

| Check | Applies to |
|---|---|
| **Any member** | Read-level project actions (viewing the tree, reading chat/activity) |
| **Editor or Owner** | Mutating actions (creating/editing/moving files and folders) |
| **Owner only** | Renaming or deleting the project itself, and other ownership-exclusive actions |

A user who is authenticated but not a member of the project in question is rejected with `403`, distinct from the `401` an unauthenticated request would receive — the request's *identity* was fine; its *permission* was not.

### 10.3 File and Execution-Session Ownership

File access is authorized transitively through project membership — there is no separate per-file permission list; a file belongs to a project, and project membership/role governs it. Execution sessions are authorized differently, because they are not a durable resource with a membership list but a **live, connection-scoped** one: a session's only "member" is the exact socket that created it, checked on every input/resize/stop action (§8.3) — the tightest possible authorization scope, appropriate to a resource that only ever has one legitimate actor.

### 10.4 Account-Wide Session Control

Beyond per-request authorization, the auth subsystem supports **account-level session control**: a user (or a future admin capability) can invalidate a specific refresh token (single-session logout) or every refresh token associated with an account (logout of all sessions) — both implemented as revocation flags on the server-tracked refresh token records described in §5.3, giving a concrete, immediate way to end trust in a credential without waiting for its natural expiry.

### 10.5 Future Role-Based Access Possibilities

The current model (owner/editor/viewer per project) is already role-based at the project scope. A natural extension — not yet implemented — is a **platform-wide role** (e.g. distinguishing a regular user from an administrator) layered on top of the existing per-project roles, enabling capabilities like moderation, platform-wide execution-quota overrides, or account management, without changing how per-project authorization itself works.

---

## 11. Security Considerations

| Concern | How it's addressed |
|---|---|
| **JWT security** | Two independently-secreted token types (§5.2); minimal claims (no embedded permissions to go stale); short access-token lifetime bounds the damage window of a leaked access token |
| **HTTPS** | The token model assumes transport-layer encryption in any real deployment — a bearer token or a cookie sent over plaintext HTTP is interceptable regardless of how well-designed the token itself is; HTTPS termination is an infrastructure/deployment concern layered underneath this subsystem, not something the token design itself can substitute for |
| **Token expiration** | Access tokens are short-lived by configuration; refresh tokens expire in 7 days and are additionally revocable before that (§5.3, §5.4) |
| **Replay attack mitigation** | Refresh token rotation (§5.4) means a captured-and-reused refresh token fails once the legitimate client has already rotated past it; short access-token lifetimes bound how long a captured access token (e.g. via a compromised client) remains useful |
| **Input validation** | Registration/login payloads are validated (format, complexity) before any database or hashing work occurs (§3.1, §9.3) |
| **Environment variables** | JWT signing secrets, email credentials, and the database connection string are read once from centralized environment configuration (Backend Architecture document, §5) — never hard-coded |
| **Brute-force mitigation** | Login failures return an identical generic message regardless of whether the email or the password was wrong, preventing account enumeration via the error message itself; password complexity rules raise the cost of a successful guess |
| **Rate limiting** | `express-rate-limit` is part of the dependency stack for throttling repeated auth attempts; consistent enforcement specifically on authentication endpoints is tracked as near-term hardening rather than uniformly applied today — an honestly-flagged gap, not a claimed guarantee |

---

## 12. Error Handling

| Scenario | Response |
|---|---|
| **Invalid credentials** (wrong email or wrong password) | `401`, identical generic message either way (§9.4, §11) |
| **Expired access token** | `401` from JWT verification failing on expiry — the client is expected to use its refresh token to obtain a new access token |
| **Missing token** | `401` — no `Authorization` header (REST) or no `auth.token` in the handshake (Socket.IO) |
| **Malformed token** | `401` — a token that fails signature verification (tampered, wrong secret, or simply garbage) is treated identically to an expired one from the client's perspective |
| **Unauthorized socket handshake** | The connection is refused outright — no partial connection state exists to clean up |
| **Expired/invalid refresh token** | `401` on the refresh endpoint specifically — the client must fall back to a full login |
| **Expired/invalid password-reset or email-verification token** | `400`, since these are user-supplied one-time tokens (from an email link) rather than the primary auth tokens — a wrong or expired link is a client input problem, not an authentication failure of an otherwise-valid session |

**Consistency:** every one of these paths — whether raised by a validator, the `authenticate` middleware, or a service-level check — is ultimately funneled through the same global error-handling middleware described in the Backend Architecture document (§16), so a client never needs to parse more than one response shape regardless of which authentication failure occurred.

---

## 13. Authentication Lifecycle

```
                              User
                               │
                               ▼
                          Register  ──▶ hashed password stored, tokens issued
                               │            immediately (account is instantly usable)
                               ▼
                             Login  ──▶ (on a later visit, or a different device)
                               │            credentials verified, fresh token pair issued
                               ▼
                              JWT  ──▶ access token (short-lived, client-held)
                               │       refresh token (long-lived, server-tracked,
                               │       httpOnly cookie)
                               ▼
                          API Calls  ──▶ every REST request re-verifies the access
                               │            token independently; project-scoped calls
                               │            are additionally authorized per §10
                               ▼
                       Socket Connection  ──▶ each of 3 namespaces independently
                               │                 re-verifies the SAME access token at
                               │                 its own handshake
                               ▼
                        Project Access  ──▶ membership + role checked for every
                               │                project-scoped action, on both REST
                               │                and socket entry points
                               │
                     (access token expires) ──▶ refresh flow: old refresh token
                               │                  revoked, new pair issued (§5.4)
                               ▼
                             Logout  ──▶ refresh token revoked server-side,
                                             cookie cleared, client-side state cleared
                                             — trust in that session ends on both ends
```

---

## 14. Design Decisions

| Decision | Reason | Benefits | Trade-offs |
|---|---|---|---|
| **Why JWT** | A single, self-verifying credential needed to work uniformly across REST and three independent Socket.IO namespaces without a shared server-side session store | No per-request database lookup to verify identity; trivially horizontally scalable verification | An access token can't be individually revoked before it expires — mitigated by short lifetimes + a revocable refresh token |
| **Why bcrypt** | Industry-standard, purpose-built adaptive hashing for password storage, with per-hash salting built in | Resistant to rainbow-table and brute-force attacks; no separate salt management burden | Deliberately slow by design (a feature, not a bug) — unsuitable for anything other than infrequent password verification, which is exactly its only use here |
| **Why middleware-based enforcement** | Authentication and authorization are cross-cutting concerns needed by many otherwise-unrelated routes/handlers | One implementation of "verify a token" and "check a role," reused everywhere, rather than reimplemented per route | Requires every new route to remember to attach the right middleware — a convention, not a compiler-enforced guarantee |
| **Why stateless access-token verification** | Matches the system's broader preference for statelessness where correctness allows it (see the Backend Architecture document's service design) | Fast; no added database load on every single request | Necessitates the separate refresh-token revocation mechanism to regain the "end a session immediately" capability statelessness alone would lose |
| **Why authentication and authorization are strictly separate steps** | Conflating them would mean every place identity is checked would also need to know every possible permission rule, and vice versa | Authorization rules (project roles, session ownership) can evolve independently of how identity itself is established | An authenticated-but-unauthorized request still costs a full identity verification before being rejected — an accepted, minor cost for the clarity of the separation |

---

## 15. Future Improvements

| Improvement | Builds on |
|---|---|
| **OAuth / social login (Google, GitHub)** | Would sit alongside the existing email/password flow as an alternative registration/login path, still ultimately issuing the same internal access/refresh token pair — no change needed to how the rest of the system trusts a session once established |
| **Multi-factor authentication (MFA)** | A natural addition at the login step specifically, gated before token issuance — the token architecture itself (§5) would not need to change, only what must succeed before a token pair is minted |
| **Role-based access control (RBAC) beyond per-project roles** | Extending the existing owner/editor/viewer model with a platform-wide role (§10.5), reusing the same authorization-as-a-separate-step principle already established |
| **A session management dashboard** | The refresh-token infrastructure already tracks every issued session per user with revocation support (§5.3, §10.4) — surfacing that as a user-facing "these are your active sessions, revoke any of them" view is primarily a UI addition on top of already-existing backend capability, not new architecture |
| **Refresh token rotation across concurrent tabs/devices** | Current rotation (§5.4) assumes one refresh token per login; explicitly modeling multiple concurrent valid sessions per user (already partially true today) with clearer per-device labeling would improve both security visibility and UX |
| **Rate limiting specifically on auth endpoints** | Closing the gap noted in §11 — applying `express-rate-limit` (already a dependency) specifically to login/register/password-reset to blunt credential-stuffing and brute-force attempts |

---

## 16. Conclusion

Authentication in Code Ground is built on a small set of deliberately separated concerns: **identity** (a JWT, verified independently at every REST and Socket.IO boundary), **credential storage** (bcrypt, never reversible), **session control** (a database-tracked, rotating, revocable refresh token layered under an otherwise-stateless access token), and **authorization** (kept strictly distinct from authentication, checked per-resource rather than once-per-request). That separation is what lets three independent real-time namespaces and a full REST API all trust the exact same identity consistently, lets a compromised or logged-out session be shut down immediately rather than merely forgotten client-side, and lets project-level, file-level, and execution-session-level permission scopes each be authorized precisely where they're relevant rather than through one blunt, all-or-nothing check. The result is an authentication subsystem substantial enough to support a genuinely multi-user, real-time, privileged-execution platform — not merely a login form in front of it.

---

*This document should be revisited if any of the Future Improvements in §15 are implemented — in particular, adding OAuth providers or platform-wide roles extends, rather than replaces, the architecture described here.*
