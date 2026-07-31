# Code Ground — Temporary Cloud Demo Deployment (Execution-Disabled Mode)

> **Scope of this document:** a *temporary* deployment path — frontend on Vercel, backend on Render — built solely so another developer can exercise the UI/UX (editor, collaboration, AI, file explorer, snapshots, etc.) without needing a local Docker daemon. It does not replace [`12_Deployment.md`](./12_Deployment.md), which remains the source of truth for local development and for what a *real* production rollout would need. This document only covers what's different for this one demo path, and assumes §1–§6 of `12_Deployment.md` (system requirements, project structure, local setup) as background.
>
> **The full Docker execution engine is untouched.** `EXECUTION_ENABLED=true` (the default) reproduces the exact pre-existing behavior described in [`07_Docker_Execution_Engine.md`](./07_Docker_Execution_Engine.md) and [`08_Interactive_Terminal.md`](./08_Interactive_Terminal.md) — this mode exists to *bypass* that engine on hosts that can't run it, not to change it. Nothing under `backend/src/services/execution/` or `backend/src/docker/` was modified.

---

## 1. Why this exists

Render and Vercel don't expose a Docker daemon to the application process, but the execution engine (both the one-shot `POST /api/execution/run` and the interactive `/terminal` Socket.IO namespace) requires one — and until now, the backend refused to even start without Docker reachable (`server.js`'s `validateExecutionEngine`). That made it impossible to deploy *anything* to a Docker-less host, even just to demo collaboration/AI/editor features.

`EXECUTION_ENABLED` decouples "the backend starts and every other feature works" from "Docker is available," so this branch can run on Render for UI/UX testing while the real Docker-backed execution engine keeps living, unmodified, in its own branch.

## 2. What's gated vs. what isn't

| Feature | Behavior when `EXECUTION_ENABLED=false` |
|---|---|
| Backend startup | Skips `validateExecutionEngine()` entirely; logs `Execution engine disabled. Skipping Docker validation.` and boots normally |
| `POST /api/execution/run` | Returns `503` with `"Code execution is disabled in this deployment."` before `execution.controller.js`/`execution.service.js` ever run |
| `/terminal` Socket.IO namespace | Still accepts connections (auth still works) but `terminal:start` immediately replies with a `terminal:error` (`sessionId: null`) instead of calling `executionSession.service.js` |
| Frontend Run button (Navbar) | Disabled, with a tooltip: *"Code execution is unavailable in this public testing deployment."* |
| Frontend interactive terminal panel | Never mounts xterm.js or opens the `/terminal` socket; shows the same friendly message in place of the terminal |
| Auth, projects, collaboration (Yjs/CRDT), Socket.IO editor sync, AI assistant, file explorer, snapshots, team chat | **Unaffected** — none of this code was touched |

When `EXECUTION_ENABLED=true` (the default, matching every environment before this change), every one of the above behaves exactly as it did previously — the flag is purely additive.

## 3. New environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `EXECUTION_ENABLED` | Backend (root `.env`, see `.env.example`) | `true` | `false` skips Docker startup validation and 503s the execution REST/socket endpoints. Any value other than the literal string `"false"` is treated as enabled. |
| `VITE_EXECUTION_ENABLED` | Frontend (`frontend/.env`, see `frontend/.env.example`) | `true` | `false` disables/hides the Run button and the interactive terminal in the UI, mirroring the backend flag. Set this alongside the backend's `EXECUTION_ENABLED=false` — they're independent flags read by independent processes, not synchronized automatically. |
| `VITE_API_URL` | Frontend | *(unset → same-origin `/api`)* | Absolute origin of the deployed backend (e.g. `https://code-ground-backend.onrender.com`), no trailing slash. Required once frontend and backend are on different origins — see §5. |
| `VITE_SOCKET_URL` | Frontend | *(unset → same-origin)* | Absolute origin for all four Socket.IO connections (default namespace, `/workspace`, `/terminal`). Almost always the same value as `VITE_API_URL` — one backend process serves both HTTP and Socket.IO. |

Local development needs none of these set — every default reproduces today's behavior exactly (relative `/api` and `/socket.io` paths via the Vite dev proxy, execution enabled).

## 4. Render (backend) setup

1. **New Web Service**, pointed at this repository/branch, root directory = repository root (the backend's `package.json` is at the repo root, not `backend/`).
2. **Build command:** `npm install`
3. **Start command:** `npm start` (already defined in the root `package.json`, runs `node backend/src/server.js`).
4. **Environment variables** — set everything in §4.1 of `12_Deployment.md` (`MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `EMAIL_USER`/`EMAIL_PASS`/`EMAIL_FROM` if testing email flows, `CLIENT_URL` = the Vercel frontend's URL, `GEMINI_API_KEY` if testing AI), **plus**:
   ```
   EXECUTION_ENABLED=false
   ```
5. Render assigns `PORT` automatically — the backend already reads `process.env.PORT` (`env.js`), so no change needed there.
6. **Verify:** the deploy log should show `Execution engine disabled. Skipping Docker validation.` followed by the normal `🚀 Code Ground Backend running on http://localhost:<PORT>` line — if you instead see it exit or attempt a Docker connection, `EXECUTION_ENABLED` wasn't picked up (check for a stray `.env` file bundled into the deploy, or a typo — anything other than the literal string `false` is treated as enabled).

**Caveat:** Render's free tier spins a web service down after a period of inactivity and cold-starts it on the next request — expect the first request after idle time to be slow. Not something this change addresses or needs to; just worth knowing when demoing.

## 5. Vercel (frontend) setup

1. **New Project**, root directory = `frontend/`.
2. **Build command:** `npm run build` (Vercel auto-detects Vite). **Output directory:** `dist`.
3. **Environment variables:**
   ```
   VITE_API_URL=https://<your-render-service>.onrender.com
   VITE_SOCKET_URL=https://<your-render-service>.onrender.com
   VITE_EXECUTION_ENABLED=false
   ```
4. Redeploy after setting env vars — Vite inlines `import.meta.env.VITE_*` at build time, so they only take effect on a fresh build, not by editing them post-deploy.
5. **Verify:** open the deployed site's DevTools Network tab and confirm `POST` requests go to `https://<your-render-service>.onrender.com/api/...` (not the Vercel origin), and that the Socket.IO connections (Network → WS) target the same Render origin.

**Backend CORS:** already permissive (`cors()` with no origin restriction — see `12_Deployment.md` §11), so it accepts requests from the Vercel origin without any change on the backend side. This is the same posture flagged as a pre-existing production-hardening gap in `12_Deployment.md` — unchanged by this work and still something a real production launch would need to restrict.

## 6. Confirming parity when execution is enabled

To confirm this change is purely additive, run the backend locally with `EXECUTION_ENABLED` unset (or explicitly `true`) and the frontend with `VITE_EXECUTION_ENABLED` unset (or `true`):

- Backend startup log still shows the original Docker daemon/image validation output (`07_Docker_Execution_Engine.md` §9.1–9.2) — including still exiting non-zero if Docker is unreachable.
- `POST /api/execution/run` and the `/terminal` namespace behave exactly as documented in `07_Docker_Execution_Engine.md` / `08_Interactive_Terminal.md` — the new gates (`executionGate.js` middleware, the `terminalSocket.js` check) are no-ops when `EXECUTION_ENABLED` is true.
- The Run button and terminal panel render and function identically to before.

No file under `backend/src/services/execution/`, `backend/src/docker/`, `backend/src/controllers/execution.controller.js`, or `backend/src/routes/execution.routes.js`'s handler itself was modified — only a gate was added in front of them (`executionGate.js`) and inside the terminal socket handler (`terminalSocket.js`), so the full Docker branch remains mergeable without conflicts in the execution engine's own code.

## 7. Files touched by this change

**Backend**
- `backend/src/db/config/env.js` — added `EXECUTION_ENABLED`
- `backend/src/server.js` — skip Docker validation when disabled
- `backend/src/middleware/executionGate.js` — new; 503s the REST execution route
- `backend/src/routes/execution.routes.js` — wired the gate in front of `runCode`
- `backend/src/socket/terminalSocket.js` — gate inside the `terminal:start` handler
- `backend/src/.env.example`, `.env.example` (repo root) — documented the new variable

**Frontend**
- `frontend/src/utils/env.js` — new; centralizes `VITE_API_URL` / `VITE_SOCKET_URL` / `VITE_EXECUTION_ENABLED`
- `frontend/src/utils/api.real.js` — base URL now `${API_URL}/api`
- `frontend/src/services/workspaceSocket.js`, `frontend/src/services/terminalSocket.js`, `frontend/src/hooks/useYjs.js` — socket connections now `${SOCKET_URL}/<namespace>`
- `frontend/src/hooks/useTerminalSession.js` — `run()` short-circuits instead of opening a socket when disabled
- `frontend/src/components/Terminal.jsx`, `frontend/src/components/Terminal.module.css` — friendly message in place of the terminal when disabled; xterm.js never mounts
- `frontend/src/components/Navbar.jsx` — new `executionEnabled` prop; disabled-state tooltip on the Run button
- `frontend/src/pages/Editor.jsx` — wires `EXECUTION_ENABLED` into `handleRun`, `runDisabled`, and `executionEnabled`
- `frontend/.env.example` — new

**Not touched:** anything under `backend/src/services/execution/`, `backend/src/docker/`, authentication, project/file/folder services, collaboration/CRDT (`backend/src/crdt/`, `backend/src/socket/socketEvents.js`), the `/workspace` namespace's logic, the AI subsystem, or any database model/schema.
