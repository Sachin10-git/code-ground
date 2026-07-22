/**
 * api.js — Code Ground central Axios instance
 *
 * This is the REAL version that talks to the actual backend.
 * It replaces the hand-rolled mock object used during frontend
 * development. Every call site stays exactly the same — the same
 * method names, the same { data } response destructuring — because
 * this instance matches the Axios response shape the mock was
 * already mimicking.
 *
 * ── What this file does ─────────────────────────────────────────────
 *
 *   1. Creates an Axios instance with:
 *        - baseURL: '/api'  (Vite dev proxy → http://localhost:4000)
 *        - 15s default timeout (overridable per-request)
 *        - JSON Content-Type header on every request
 *
 *   2. REQUEST interceptor — runs before every outgoing request:
 *        - Reads the JWT from localStorage (key: 'cg_token')
 *        - Attaches it as 'Authorization: Bearer <token>'
 *        - If no token exists, the request goes through without the
 *          header — the backend will respond with 401 for protected
 *          routes, which the response interceptor catches below
 *
 *   3. RESPONSE interceptor — runs after every response:
 *        - 2xx:  pass through unchanged
 *        - 401:  clear localStorage + hard-redirect to /login
 *                (handles expired tokens, revoked sessions, and the
 *                 case where the user's Pro subscription was revoked)
 *        - else: re-throw so every call site's catch block receives
 *                the real Axios error with err.response.data.error
 *
 * ── Why /api as the baseURL ─────────────────────────────────────────
 *
 *   All backend routes are prefixed with /api on the server.
 *   In development, vite.config.js proxies /api → localhost:4000
 *   so there's no CORS issue and no need to hard-code ports.
 *   In production, Nginx proxies /api → the Node container.
 *   Neither environment ever needs a host in the baseURL.
 *
 * ── Why we don't use EventSource for SSE ────────────────────────────
 *
 *   The AI endpoint (/api/ai/ask) uses Server-Sent Events, but
 *   EventSource doesn't support POST or custom headers (no auth token).
 *   useAI.js uses fetch() + ReadableStream instead, which bypasses
 *   this Axios instance entirely for that one endpoint. That's fine —
 *   useAI.js reads the token directly from localStorage and attaches
 *   it the same way this interceptor does.
 *
 * ── Adding the Vite proxy ────────────────────────────────────────────
 *
 *   Add this to your vite.config.js so API calls work in development
 *   without hitting CORS errors:
 *
 *   export default defineConfig({
 *     plugins: [react()],
 *     server: {
 *       proxy: {
 *         '/api': {
 *           target:      'http://localhost:4000',
 *           changeOrigin: true,
 *         },
 *       },
 *     },
 *   });
 *
 * ── Migrating from the mock ──────────────────────────────────────────
 *
 *   1. Replace frontend/src/utils/api.js with this file.
 *   2. Run `npm install axios` (or `npm install` if it's already in
 *      package.json from the original setup).
 *   3. Add the Vite proxy above.
 *   4. Start the backend (npm run dev from the backend directory).
 *   5. Nothing else changes — every call site already uses the same
 *      method names and destructures { data } from the response.
 */

import axios from 'axios';

/* ─────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────── */

const TOKEN_KEY = 'cg_token';
const USER_KEY  = 'cg_user';

/*
 * Default request timeout. Keeps requests from hanging indefinitely
 * on a slow or unresponsive backend. Individual requests can override
 * this by passing { timeout: N } in their config object.
 *
 * useExecution.js has its own client-side deadline (35s) for the
 * /execute endpoint specifically — that fires via AbortController
 * before this Axios timeout would, under normal conditions.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/* ─────────────────────────────────────────────────────────────────────
   AXIOS INSTANCE
───────────────────────────────────────────────────────────────────── */

const api = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

/* ─────────────────────────────────────────────────────────────────────
   REQUEST INTERCEPTOR — attaches the JWT to every outgoing request.

   Why localStorage rather than a cookie?
   Cookies require SameSite/Secure configuration and interact with
   CSRF concerns. localStorage is simpler for an SPA where XSS is
   already mitigated by React's escaping, and keeps auth logic
   centralised here and in useAuth.jsx rather than spread across
   server cookie config.
───────────────────────────────────────────────────────────────────── */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (err) => Promise.reject(err),
);

/* ─────────────────────────────────────────────────────────────────────
   RESPONSE INTERCEPTOR — catches 401 Unauthorized globally.

   On 401:
     1. Clear both localStorage keys so stale auth state doesn't
        linger — useAuth.jsx reads 'cg_user' on boot, so leaving it
        would show the user as signed in despite a bad token.
     2. Hard-redirect to /login rather than using React Router's
        navigate() — a hard redirect resets all React state cleanly,
        which is exactly what we want when a session expires. A router
        navigate would leave stale component state mounted.

   We skip the redirect if we're already on /login or /register to
   avoid an infinite redirect loop (those pages call /auth/login and
   /auth/register which will 401 if the token is bad, but they're
   already on the right page).
───────────────────────────────────────────────────────────────────── */
api.interceptors.response.use(
  (response) => response,

  (err) => {
    const status  = err?.response?.status;
    const isAuth  = err?.config?.url?.startsWith('/auth/');

    if (status === 401 && !isAuth) {
      /* Clear local session */
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch { /* localStorage unavailable — proceed with redirect */ }

      /* Only redirect if we're not already on an auth page */
      const onAuthPage = ['/login', '/register'].some(path =>
        window.location.pathname.startsWith(path)
      );

      if (!onAuthPage) {
        window.location.href = '/login';
      }
    }

    return Promise.reject(err);
  },
);

export default api;
