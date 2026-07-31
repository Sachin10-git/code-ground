# Code Ground — Deployment & Operations Guide

> **Scope of this document:** How to set up, run, and operate Code Ground today, plus clearly-labeled recommendations for what a production deployment would additionally require. This document does not re-explain architecture (see the companion documents referenced throughout) and does not include full deployment scripts — it explains the process, the reasoning behind it, and what to check when something goes wrong.
>
> **Read this before assuming anything about production readiness:** as of this writing, Code Ground has **no implemented production deployment** — no Dockerfile, no `docker-compose.yml`, and no CI/CD pipeline exist in this repository. Every workflow in §5–§6 is the real, current local-development process. Section 7 onward is explicit, throughout, about which parts are implemented today and which are recommendations for a future production rollout.
>
> **Exception:** a *temporary*, execution-disabled cloud deployment (Vercel + Render, for UI/UX testing only) does exist as a documented path — see [`16_Deployment_Demo_Mode.md`](./16_Deployment_Demo_Mode.md). It is not the production deployment described in §7 below and intentionally runs with the Docker execution engine turned off.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Requirements](#2-system-requirements)
3. [Project Structure](#3-project-structure)
4. [Environment Configuration](#4-environment-configuration)
5. [Local Development Setup](#5-local-development-setup)
6. [Docker Requirements](#6-docker-requirements)
7. [Production Deployment](#7-production-deployment)
8. [Operational Monitoring](#8-operational-monitoring)
9. [Backup & Recovery](#9-backup--recovery)
10. [Troubleshooting](#10-troubleshooting)
11. [Security Considerations](#11-security-considerations)
12. [Future Deployment Improvements](#12-future-deployment-improvements)
13. [Conclusion](#13-conclusion)

---

## 1. Introduction

### 1.1 Purpose of This Guide

This is the operational reference for getting Code Ground running — locally today, and in a real production environment eventually. It exists so a new contributor (or a future version of the person who built this) can go from a fresh clone to a running, verifiable instance without re-deriving the process from source.

### 1.2 Supported Deployment Environments

| Environment | Status |
|---|---|
| **Local development** | Fully implemented and is how this project has been built and tested throughout its development (§5) |
| **Production** | **Not implemented.** No containerization of the app itself, no process manager configuration, no reverse proxy, and no CI/CD exist in this repository today. §7 documents *recommended* production practices, clearly marked as such |

### 1.3 Deployment Philosophy

Code Ground's own execution engine runs user code inside Docker (docs/07) — but the **platform itself** (the frontend build and the backend process) is not currently containerized or deployed anywhere. This is a deliberate scope boundary for the project as it stands: engineering effort went into the product's core technical differentiators (collaboration, execution, AI), not into production infrastructure that a real rollout would eventually need. This document is honest about that boundary rather than describing aspirational infrastructure as if it already existed.

### 1.4 Development vs. Production

| | Development (today) | Production (recommended, §7) |
|---|---|---|
| **Frontend serving** | Vite dev server with hot reload | A built static bundle (`vite build`) served by a real web server/CDN |
| **Backend process** | Run directly with `node`/`nodemon` in a terminal | Run under a process manager (or containerized) with restart policies |
| **Database** | MongoDB Atlas (already cloud-hosted — see §2) | The same, on a production-tier cluster with proper network access rules |
| **Docker execution engine** | Docker Desktop on the developer's own machine | A dedicated, properly-secured Docker host (§7.5) |
| **TLS/HTTPS** | None — plain HTTP on localhost | Required — terminated at a reverse proxy or load balancer |
| **Secrets** | A single local `.env` file (gitignored) | A managed secrets store, not a file on disk (§4.5) |

---

## 2. System Requirements

| Requirement | Version / detail | Why |
|---|---|---|
| **Operating system** | Windows, macOS, or Linux | The backend and frontend are both plain Node.js/Vite — no OS-specific code exists outside the Docker client's connection path (below) |
| **Node.js** | A current LTS release (developed and tested against Node 24.x) | Runs both the backend (Express) and the frontend build tooling (Vite) |
| **npm** | Bundled with the Node.js install in use | Package management for both `backend`/root and `frontend` |
| **MongoDB** | A MongoDB Atlas cluster (cloud-hosted) — no local MongoDB installation is used or required | The project connects to Atlas via `MONGODB_URI`; see the Database Design document for schema/collection detail |
| **Docker** | Docker Desktop (Windows/macOS) or the Docker Engine (Linux), with the daemon running | Required specifically for the execution engine (docs/07) — everything else in the platform functions without it, degraded (execution requests fail cleanly; see docs/07 §9) |
| **Git** | Any current version | Source control |
| **Browser** | A current version of Chrome, Edge, or Firefox | The frontend relies on modern browser APIs (WebSocket, `ResizeObserver`, clipboard access via xterm.js) — no legacy-browser support is targeted |
| **Recommended hardware** | 8 GB+ RAM, a multi-core CPU | Running Docker containers for code execution alongside the backend, frontend dev server, and a browser simultaneously is the realistic local development footprint |

---

## 3. Project Structure

Only what's relevant to running and deploying the project — full architectural detail is in the System Architecture and Backend/Frontend Architecture documents.

```
code-ground-partner/
├── .env                  Single root environment file (gitignored) — see §4
├── package.json           Root/backend package manifest and scripts (§5)
├── backend/src/           Express API + Socket.IO + execution engine (docs/02)
├── frontend/              React/Vite SPA (docs/03)
│   ├── package.json        Frontend scripts (dev, build)
│   └── vite.config.js      Dev-server proxy configuration (§5, §10)
└── docs/                  This documentation series
```

There is one `.env` file, at the repository root — **not** separate `backend/.env`/`frontend/.env` files (the `.gitignore` lists all three patterns defensively, but only the root file is actually used; the backend reads it via a path resolved relative to its own config module, and the frontend needs no server-side secrets at all).

---

## 4. Environment Configuration

### 4.1 Required Variables

| Variable | Purpose |
|---|---|
| `PORT` | The port the backend HTTP/Socket.IO server listens on (defaults to `5000` if unset) |
| `NODE_ENV` | `development` or `production` — gates whether error responses include a stack trace (Backend Architecture document §16) |
| `MONGODB_URI` | The MongoDB Atlas connection string |
| `JWT_ACCESS_SECRET` | Signing secret for short-lived access tokens (Authentication document §5.2) |
| `JWT_REFRESH_SECRET` | Signing secret for refresh tokens — **must differ** from the access secret |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime (e.g. a duration string the JWT library accepts) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime |
| `EMAIL_USER` / `EMAIL_PASS` / `EMAIL_FROM` | Outbound email credentials, used for password-reset and email-verification links (Authentication document §3.7–3.10) |
| `CLIENT_URL` | The frontend's own URL, used when constructing links inside those emails |
| `GEMINI_API_KEY` | The Gemini API key for the AI subsystem (AI Assistant document §6.1) — if unset, AI requests fail cleanly with a `503`; nothing else in the platform is affected |

### 4.2 Optional Execution-Tuning Variables

These are read directly by the execution subsystem itself (not part of the centralized config module above), each with a sensible built-in default if left unset:

| Variable | Purpose | Default |
|---|---|---|
| `EXECUTION_MAX_CONCURRENT` | The execution queue's concurrency cap (docs/07 §7) | 4 |
| `EXECUTION_SESSION_TIMEOUT_MS` | An interactive terminal session's maximum lifetime (docs/08 §3.2) | 5 minutes |

### 4.3 Development Configuration

For local development, all of the above live in one `.env` file at the repository root, loaded once at process start. No value in it needs to be anything more than "valid enough to work" — a real Gemini key and real email credentials are only needed if you're actively testing those two features; everything else (auth, projects, collaboration, execution) functions without them.

### 4.4 Production Considerations

None of the values above should ever be the same values used in development once a real deployment exists — JWT secrets in particular must be freshly generated, long, random values distinct from whatever was used locally, since a leaked development secret should never be able to forge a token accepted by a production system.

### 4.5 Secret Management Best Practices

| Practice | Why |
|---|---|
| **Never commit `.env`** | Already enforced via `.gitignore` — keep it that way |
| **Never log a secret value** | The existing structured logger (Backend Architecture document §7.1) logs event metadata, not raw request bodies or config — keep new logging consistent with that |
| **Rotate JWT secrets independently of other secrets** | Rotating `JWT_ACCESS_SECRET` invalidates every currently-issued access token; know that before rotating it in a live system |
| **Use a managed secrets store in production** | A single `.env` file on a production host is a single point of exposure — a managed secrets manager (cloud-provider-native, or a dedicated tool) is the recommended replacement (§12) |
| **Least-privilege database credentials** | The `MONGODB_URI`'s credentials should be scoped to only what the application needs, not a cluster-admin account |

This document deliberately does not include, and you should never place in any document, the actual contents of `.env` — only the names and purposes of the variables it holds.

---

## 5. Local Development Setup

### 5.1 Step-by-Step

```
1. Clone the repository
     git clone <repository-url>
     cd code-ground-partner

2. Install backend dependencies (root package.json)
     npm install

3. Install frontend dependencies
     cd frontend
     npm install
     cd ..

4. Create the root .env file
     Populate every variable listed in §4.1 (and, optionally, §4.2)

5. Confirm MongoDB Atlas connectivity
     No local database process to start — MONGODB_URI must already
     point at a reachable Atlas cluster

6. Ensure Docker Desktop is running
     Required for the execution engine specifically (§6) — everything
     else in the platform works without it

7. Start the backend
     npm run dev          (nodemon, auto-restarts on change)
     — or —
     npm start            (plain node, no auto-restart)

8. Start the frontend, in a second terminal
     cd frontend
     npm run dev

9. Verify both are running (§5.2)
```

### 5.2 Verification Steps

| Check | How | Expected result |
|---|---|---|
| **Backend is up and Docker is reachable** | `GET http://localhost:5000/api/health` (or whatever `PORT` is set to) | `200`, with `data.status: "ok"` and `data.docker.reachable: true` (API Reference document §7.3) |
| **MongoDB connected** | Check the backend's startup log | A `MongoDB Connected: <host>` line, with no connection error |
| **Frontend is serving** | Open `http://localhost:5173` (Vite's default port) in a browser | The Landing page renders |
| **Frontend can reach the backend** | Attempt to register/log in through the UI | A successful round trip — confirms the Vite dev-server proxy (`/api`, `/socket.io` → the backend port, configured in `frontend/vite.config.js`) is working |
| **Execution engine works end-to-end** | Open a file in the Editor, click Run on a trivial script | Live terminal output appears (docs/08) |

### 5.3 Running the Test Suites

```
npm run test:execution     one-shot + interactive execution tests (docs/07, docs/08)
npm run test:api           REST API integration tests
npm run test:crdt          collaboration hydration tests (docs/05)
```

All three require a reachable Docker daemon and/or MongoDB, matching what §6 and §5.2 already require for the app itself to function — there is no separate, additional test-environment setup (Testing document §4, §6).

---

## 6. Docker Requirements

Full architectural detail on how the execution engine uses Docker: [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md). This section covers only what's needed to have Docker *available* to the running application.

### 6.1 Installation

Install Docker Desktop (Windows/macOS) or the Docker Engine (Linux) and ensure the daemon is actually running before starting the backend — the backend connects to it over the platform-appropriate local socket (a named pipe on Windows, a Unix socket elsewhere) automatically; no Docker-related configuration value is required in `.env`.

### 6.2 Required Images

The six supported languages each resolve to a specific base image (docs/07 §3) — `node`, `python`, an Eclipse Temurin JDK, `gcc`, and `golang` (TypeScript reuses the `node` image). These are **not** pre-bundled or automatically pulled by any setup script today; they are pulled on demand the first time each is needed, or can be pulled ahead of time manually (`docker pull <image>`) to avoid a slow first execution per language.

### 6.3 Image and Daemon Verification

The backend itself checks both of these at startup (docs/07 §9.1–9.2) and fails the boot fast if Docker is entirely unreachable, or warns (non-fatally) naming any specific missing image — the same information is available at any later point via `GET /api/health` (§5.2, API Reference document §7.3). There is no separate, manual verification step needed beyond starting the backend and reading its own output.

### 6.4 Common Docker Issues

Covered in the troubleshooting table (§10) rather than repeated here.

### 6.5 Relationship to the Execution Engine

Docker is used **exclusively** by the execution engine (both the one-shot REST path and the interactive terminal) — no other feature of the platform (auth, projects, collaboration, AI) depends on it in any way. A developer working exclusively on, say, the collaboration system can run the full application with Docker Desktop stopped; only Run/terminal features will be unavailable, reported cleanly rather than crashing anything else (docs/07 §9, §15).

---

## 7. Production Deployment

> **Everything in this section is a recommendation, not a description of an existing deployment.** No Dockerfile, `docker-compose.yml`, CI/CD pipeline, or hosting configuration currently exists in this repository.

### 7.1 Frontend Deployment (Recommended)

Run `npm run build` inside `frontend/` to produce a static `dist/` bundle, then serve it from a static host or CDN (a platform like Netlify/Vercel/Cloudflare Pages, or a plain Nginx/static file server) — the frontend itself has no server-side runtime requirement in production.

### 7.2 Backend Deployment (Recommended)

Run the backend as a long-lived Node process under a process manager (e.g. `pm2`, or a container orchestrator's own restart policy if containerized) rather than a bare terminal `node` invocation — with automatic restart on crash, since there is currently no graceful-shutdown handling in the backend itself (Backend Architecture document §4.7).

### 7.3 Database (Recommended)

Continue using MongoDB Atlas, upgraded to a production-appropriate tier (dedicated cluster, IP allowlisting or VPC peering rather than an open network access rule, and Atlas's own automated backup enabled — Database Design document §11).

### 7.4 Environment Variables (Recommended)

Every variable in §4.1–4.2 must be set in the production environment with **production-specific values** — freshly generated JWT secrets, a production email sending account, a production Gemini key, and `NODE_ENV=production` (which also suppresses stack traces in error responses — Backend Architecture document §16).

### 7.5 Docker Host (Recommended)

The execution engine needs a Docker daemon it can reach in production exactly as it does locally — this means either the backend process runs on a host with its own Docker daemon (simplest, but ties execution capacity directly to that host's resources) or, at greater scale, a dedicated execution cluster (System Architecture document §19, docs/07 §19). Whichever is chosen, it must be reachable by the backend over the same `dockerode` connection mechanism already in use, and it must be **properly isolated** — this daemon runs arbitrary user-submitted code in containers, and the host running it should not also run anything sensitive outside those containers' isolation boundary.

### 7.6 Domain, SSL, and Reverse Proxy (Recommended)

A production deployment needs a reverse proxy (Nginx, Caddy, or a managed load balancer) in front of the backend to: terminate TLS/SSL (the backend itself speaks plain HTTP — there is no TLS termination in the application today), route `/api` and `/socket.io` to the backend the same way the Vite dev server's proxy does in development (§5.2), and serve the frontend's built static assets — none of this configuration currently exists in the repository and would need to be written for a real deployment.

### 7.7 Production Deployment Checklist

| Item | Status |
|---|---|
| Frontend built and served statically | ❌ Not implemented — recommended above |
| Backend running under a process manager | ❌ Not implemented — recommended above |
| Production MongoDB Atlas tier + network rules | ❌ Not implemented — recommended above |
| Fresh, production-specific secrets | ❌ Not implemented — recommended above |
| Isolated, reachable Docker host | ❌ Not implemented — recommended above |
| Reverse proxy with TLS termination | ❌ Not implemented — recommended above |
| CI/CD pipeline | ❌ Not implemented — see §12 |

---

## 8. Operational Monitoring

### 8.1 Application Logs

The backend uses a small structured logger (Backend Architecture document §7.1) writing to standard output/error — there is no centralized log aggregation today (§12); in development this means reading the terminal the backend is running in directly.

### 8.2 Docker Health

`GET /api/health` reports Docker daemon reachability and per-image availability on demand (docs/07 §9.3) — the single most useful operational check for whether the execution engine specifically is functioning.

### 8.3 Execution Health

The same endpoint additionally reports the execution queue's current active/waiting counts and a summary of recent execution outcomes (docs/07 §8) — useful for spotting a spike in timeouts or failures without needing to inspect logs directly.

### 8.4 Common Operational Checks

| Check | Command / endpoint |
|---|---|
| Is the backend up at all | `GET /api/health` returns any response |
| Is Docker specifically healthy | `data.docker.reachable` in that same response |
| Are executions queueing up | `data.executionQueue.waiting` |
| Are executions failing more than expected | `data.executionMetrics.summary` |
| Are there orphaned containers | `docker ps -a` (should show none accumulating over time — docs/07 §12) |

### 8.5 Routine Maintenance

There is currently no scheduled maintenance job (expired-refresh-token cleanup, workspace-activity pruning, etc.) running automatically — the capability to delete expired refresh tokens exists at the service layer (Authentication document §5.3) but is not wired to any scheduler; running it periodically is a manual or future-automation task (§12).

---

## 9. Backup & Recovery

Full detail: [`10_Database_Design.md`](./10_Database_Design.md) §11 — summarized here from an operational perspective:

| Concern | Current approach |
|---|---|
| **Database backups** | Rely entirely on MongoDB Atlas's own managed backup/replication — no separate, project-level backup tooling exists |
| **Configuration backups** | The single `.env` file is not backed up by any tooling in this project — losing it means manually reconstructing every value in §4.1–4.2 (keep a secure, personal copy outside version control) |
| **Recovery (data)** | An Atlas restore recovers everything consistently; a project-level Snapshot (Database Design document §3.8) is the finer-grained, user-facing recovery tool for a specific project's file tree |
| **Recovery (configuration)** | Entirely manual today — re-populate `.env` from wherever secrets are securely stored outside the repository |
| **Disaster recovery recommendation** | At minimum, store a secure, access-controlled copy of production environment variables outside both the repository and any single engineer's local machine, and confirm Atlas's backup retention window actually meets the project's real recovery-point requirements before depending on it |

---

## 10. Troubleshooting

| Issue | Symptoms | Likely cause | Resolution |
|---|---|---|---|
| **MongoDB connection failure** | Backend exits immediately at startup with a connection error logged | `MONGODB_URI` missing/incorrect, or the Atlas cluster's network access rules don't allow the connecting IP | Verify the connection string and that the current IP (or `0.0.0.0/0` in development) is allowlisted in Atlas |
| **Docker unavailable** | Backend either refuses to start (fails fast — docs/07 §9.1) or `/api/health` reports `docker.reachable: false` | Docker Desktop/daemon isn't running | Start Docker Desktop (or the daemon) and restart the backend, or just wait if only checking health mid-session |
| **Environment variable mistakes** | Vague failures specific to one feature (auth tokens failing to verify, emails never sending, AI requests always failing) | A required variable in §4.1 is missing, misspelled, or the two JWT secrets are identical | Re-check every variable name against §4.1 exactly; confirm `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET` |
| **Port conflicts** | Backend fails to bind, or the frontend dev server picks a different port than expected | Another process is already using the configured `PORT` (backend) or Vite's default port | Set a different `PORT` value, or stop the conflicting process; check the frontend's proxy target in `vite.config.js` still matches whatever port the backend actually bound to |
| **Authentication failures** | Every protected request returns `401` even with a token attached | An expired/mismatched JWT secret between when a token was issued and now (e.g. `JWT_ACCESS_SECRET` changed without re-logging in), or the token simply expired | Log in again to obtain a fresh token; confirm the JWT secrets haven't changed unexpectedly |
| **Execution failures** | `/api/execution/run` or the interactive terminal fails for every language | Docker unreachable (see above), or a specific language's image was never pulled and the environment has no network access to pull it | Check `/api/health`'s `requiredImages` list; run `docker pull <image>` manually for anything reported unavailable |
| **Frontend can't reach the API** | Every request from the UI fails, often as a CORS or network error in the browser console | The Vite dev server's proxy target (`vite.config.js`) doesn't match the port the backend is actually running on | Confirm the backend's actual `PORT` matches the proxy configuration, and that the backend is actually running |

---

## 11. Security Considerations

| Concern | Current state | Recommendation for production |
|---|---|---|
| **Secrets management** | A single local `.env` file | A managed secrets store (§4.5, §12) — never a plain file on a production host |
| **JWT secrets** | Development-only values in the local `.env` | Freshly generated, long, random, production-only values, never reused from development (§4.4) |
| **API keys** (Gemini, email) | Development credentials, often lower-privilege/free-tier | Production-tier credentials, scoped as narrowly as the provider allows |
| **HTTPS** | Not implemented — the backend serves plain HTTP | **Required** in production, terminated at a reverse proxy (§7.6) — never send a JWT or a refresh-token cookie over plain HTTP in production |
| **CORS** | Currently configured permissively (no origin restriction) — acceptable for local development, where frontend and backend origins are already trusted by the developer | Must be restricted to the actual production frontend origin before going live — an open CORS policy in production would let any site make authenticated-looking requests against the API |
| **Rate limiting** | `express-rate-limit` is a declared dependency but not applied to any route today (Backend Architecture document §17) | Should be applied specifically to authentication endpoints and the execution endpoint before a public production launch |
| **Least privilege** | The MongoDB user configured in `MONGODB_URI` should already be scoped narrowly | Extend the same principle to any production infrastructure credentials (the Docker host, any cloud provider IAM roles) |
| **Production hardening recommendations (summary)** | — | HTTPS everywhere, restricted CORS, rate limiting on sensitive routes, fresh secrets, an isolated Docker execution host, and centralized secret management — none of which exist today and all of which should be treated as launch blockers, not optional polish |

---

## 12. Future Deployment Improvements

| Improvement | What it would add |
|---|---|
| **CI/CD** | Automatically running the existing test suites (Testing document §2) on every push/PR, and automating the build/deploy steps in §7 rather than performing them manually |
| **Docker Compose** | A single `docker-compose.yml` to run the backend (and, in development, a local MongoDB if desired) with one command, rather than the current multi-terminal manual process (§5.1) |
| **Kubernetes** | The eventual home for distributed execution capacity (System Architecture document §19, docs/07 §19) — not warranted at the project's current scale, but the clear next step if execution demand outgrows a single Docker host |
| **Horizontal scaling** | Running more than one backend instance — requires moving the execution queue, active session registry, and Socket.IO room state out of a single process's memory first (System Architecture document §19) |
| **Load balancing** | A natural companion to horizontal scaling, with WebSocket-aware routing given the platform's heavy reliance on Socket.IO |
| **Centralized logging** | Shipping the backend's structured log output to a real log aggregation service, rather than reading a single process's stdout directly (§8.1) |
| **Monitoring dashboards** | Visualizing `/api/health`'s data (Docker status, queue depth, execution metrics) over time, rather than only reading its current snapshot on demand |
| **Infrastructure as Code** | Codifying the production recommendations in §7 (hosting, networking, secrets, the Docker host) as versioned, reviewable configuration rather than manually-performed setup steps |

---

## 13. Conclusion

Code Ground's current deployment story is honest and narrow: a fully working, thoroughly documented **local development** process, and a clearly-labeled set of **recommendations** for what production would require — with nothing in between presented as more finished than it actually is. That honesty is itself the operationally useful property of this document: a new contributor following §5 will have a genuinely working local instance in minutes, and anyone approaching an eventual production launch will find §7 and §11 naming exactly what still needs to be built, rather than discovering those gaps the hard way after already being live.

---

*This document should be revisited the moment any part of §7's recommendations is actually implemented — at that point, the corresponding row should move from "recommended" to "implemented," and the relevant checklist item in §7.7 updated to reflect it.*
