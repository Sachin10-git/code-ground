/**
 * useAuth.jsx — Code Ground authentication context
 *
 * Provides global auth state to the entire app: the current user,
 * and the login / register / logout actions. Every page that needs
 * to know "who is signed in" or needs to sign someone in/out reads
 * from this single source of truth via the useAuth() hook.
 *
 * ── Consumers in this codebase (exact shape each one expects) ───────
 *
 *   Login.jsx     → const { login }         = useAuth();
 *                    await login(email, password)
 *
 *   Register.jsx  → const { register }      = useAuth();
 *                    await register(username, email, password)
 *
 *   Dashboard.jsx → const { user, logout }  = useAuth();
 *
 *   Editor.jsx    → const { user }          = useAuth();
 *
 *   Pricing.jsx   → const { user }          = useAuth();
 *                    reads user?.is_paid to distinguish Free vs Pro
 *
 * ── How session persistence works ───────────────────────────────────
 *
 *   1. On login/register success, the backend returns { token, user }.
 *   2. The token is saved to localStorage under 'cg_token'.
 *      api.js's request interceptor reads this on every request and
 *      attaches it as `Authorization: Bearer <token>`.
 *   3. The user object is ALSO cached in localStorage under 'cg_user'
 *      so a page refresh can show the UI immediately (optimistic),
 *      while a background call to GET /auth/me confirms the token
 *      is still valid and refreshes the user object with any
 *      server-side changes (e.g. upgraded to Pro in another tab).
 *   4. On logout, both localStorage keys are cleared and the user
 *      state resets to null, which every PrivateRoute checks to
 *      redirect back to /login.
 *
 * ── Loading state ────────────────────────────────────────────────────
 *
 *   `loading` is true only during the INITIAL session check on app
 *   boot (verifying a stored token before deciding whether to show
 *   the signed-in or signed-out UI). It is NOT used for individual
 *   login/register calls — Login.jsx and Register.jsx track their
 *   own local `loading` state for button spinners, since each form
 *   needs independent control over its own submit button.
 *
 * ── Why api.js's interceptor doesn't conflict with this file ────────
 *
 *   api.js already attaches the Bearer token to every outgoing
 *   request and already redirects to /login on a 401 response.
 *   This file is the ONLY place that WRITES the token to localStorage
 *   (on login/register success) and CLEARS it (on logout) — api.js
 *   only reads it. That separation means swapping api.js's mock
 *   implementation for a real Axios instance later requires no
 *   changes here at all, as long as the real backend's response
 *   shape matches { token, user } on /auth/login and /auth/register,
 *   and returns a user object on GET /auth/me.
 */

import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import api from '../utils/api.js';

/* ─────────────────────────────────────────────────────────────────────
   STORAGE KEYS — centralised so api.js and this file never drift
   out of sync on what the token/user are actually called.
───────────────────────────────────────────────────────────────────── */
const TOKEN_KEY = 'cg_token';
const USER_KEY  = 'cg_user';

/* ─────────────────────────────────────────────────────────────────────
   STORAGE HELPERS
   Wrapped in try/catch because localStorage can throw in some
   browser privacy modes (e.g. Safari private browsing) — auth
   should degrade gracefully rather than crash the whole app.
───────────────────────────────────────────────────────────────────── */
function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* Storage unavailable — session simply won't persist
       across reloads, but the current tab still works. */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* no-op */
  }
}

/* ─────────────────────────────────────────────────────────────────────
   CONTEXT
───────────────────────────────────────────────────────────────────── */
const AuthContext = createContext(null);

/* ─────────────────────────────────────────────────────────────────────
   AUTH PROVIDER — wraps the whole app in App.jsx.
───────────────────────────────────────────────────────────────────── */
export function AuthProvider({ children }) {
  /* Optimistic initial state — read whatever was cached from the
     last session so the UI doesn't flash "signed out" on every
     page refresh while we verify the token in the background. */
  const [user,    setUser]    = useState(() => readStoredUser());
  const [loading, setLoading] = useState(true);

  /* ── Verify the session on app boot ──
     If a token exists, confirm it's still valid and refresh the
     user object (e.g. picks up a Pro upgrade made in another tab).
     If there's no token, or verification fails, we end up signed out. */
  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      const token = localStorage.getItem(TOKEN_KEY);

      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) {
          setUser(data);
          /* Keep the cached copy fresh too */
          writeSession(token, data);
        }
      } catch {
        /* Token invalid/expired — fully sign out.
           api.js's response interceptor may already redirect on 401,
           but we clear local state here too so this works even if
           that interceptor is ever removed or changed. */
        if (!cancelled) {
          clearSession();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    verifySession();
    return () => { cancelled = true; };
  }, []);

  /* ── login ──
     POST /auth/login with email + password.
     On success: persist session, update context, return the user.
     On failure: throw so the calling form can read err.response.data.error
     (matches the pattern already used in Login.jsx's catch block). */
  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    writeSession(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  /* ── register ──
     POST /auth/register with username + email + password.
     Same persistence pattern as login — a successful registration
     signs the user in immediately, no separate login step needed. */
  const register = useCallback(async (username, email, password) => {
    const { data } = await api.post('/auth/register', { username, email, password });
    writeSession(data.token, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  /* ── logout ──
     Clears local session immediately (synchronous, so the UI
     updates instantly) and fires a best-effort POST to let the
     backend invalidate the token server-side. The network call
     is NOT awaited by callers — logout should never feel slow,
     and we don't want a flaky network to block signing out. */
  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    /* Fire-and-forget — ignore failures, the user is already
       signed out locally regardless of whether this succeeds. */
    api.post('/auth/logout', {}).catch(() => {});
  }, []);

  /* ── updateUser ──
     Lets other parts of the app (e.g. after a successful Stripe
     checkout redirect) patch the cached user object without a full
     re-fetch — for example setting is_paid: true immediately so
     Pricing.jsx reflects the upgrade without waiting on /auth/me. */
  const updateUser = useCallback((patch) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) writeSession(token, next);
      return next;
    });
  }, []);

  const value = { user, loading, login, register, logout, updateUser };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   useAuth — the hook every component imports.
   Throws a clear error if used outside <AuthProvider>, rather than
   silently returning null and producing a confusing "cannot read
   property 'user' of null" error somewhere unrelated.
───────────────────────────────────────────────────────────────────── */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth() must be used inside an <AuthProvider>. Wrap your app root with <AuthProvider> in App.jsx.');
  }
  return ctx;
}
