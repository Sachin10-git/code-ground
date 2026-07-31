/**
 * utils/env.js — build-time environment flags (Vite `import.meta.env`)
 *
 * Centralizes the handful of env vars this app reads at build time so
 * every call site (api.real.js, the socket connection modules, the
 * Editor/Terminal UI) reads the same normalized values instead of each
 * parsing import.meta.env itself.
 *
 * ── API_URL / SOCKET_URL ─────────────────────────────────────────────
 *   Unset by default, which preserves the existing behaviour exactly:
 *   api.real.js's baseURL stays '/api' and every socket.io-client call
 *   stays a bare same-origin path ('/workspace', '/terminal', '/') —
 *   both rely on Vite's dev proxy (vite.config.js) / a same-origin
 *   production host, same as before this file existed.
 *
 *   Set VITE_API_URL / VITE_SOCKET_URL (no trailing slash) when the
 *   frontend and backend are deployed to different origins (e.g.
 *   frontend on Vercel, backend on Render) — see
 *   docs/16_Deployment_Demo_Mode.md.
 *
 * ── EXECUTION_ENABLED ────────────────────────────────────────────────
 *   Mirrors the backend's EXECUTION_ENABLED flag so the UI can hide/
 *   disable Run and the interactive terminal instead of letting the
 *   user hit a 503 or a websocket error. Defaults to enabled — must be
 *   explicitly set to 'false' to disable (same true-unless-'false'
 *   convention as the backend's env.js).
 */

function stripTrailingSlash(url) {
  return url ? url.replace(/\/+$/, "") : "";
}

export const API_URL = stripTrailingSlash(import.meta.env.VITE_API_URL);
export const SOCKET_URL = stripTrailingSlash(import.meta.env.VITE_SOCKET_URL);

export const EXECUTION_ENABLED = import.meta.env.VITE_EXECUTION_ENABLED !== "false";
