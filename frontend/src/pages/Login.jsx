/**
 * Login.jsx — Code Ground sign-in page
 *
 * Responsibilities:
 *   1. Render email + password form
 *   2. POST /auth/login via the shared Axios instance (src/utils/api.js)
 *   3. On success → save JWT to localStorage, save user to AuthContext, redirect to /dashboard
 *   4. On failure → display the server's error message inline (no alert())
 *   5. Show a loading state on the button while the request is in flight
 *
 * Auth flow:
 *   Login → api.post('/auth/login') → { token, user }
 *        → localStorage.setItem('cg_token', token)
 *        → AuthContext.setUser(user)
 *        → navigate('/dashboard')
 *
 * The JWT key is 'cg_token' throughout the app.
 * The AuthContext lives in src/hooks/useAuth.jsx (built separately).
 * This component reads from context but does NOT depend on it being
 * fully initialised — it calls the login() helper which handles both.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import styles from './Login.module.css';

/* ─────────────────────────────────────────
   Logo mark — duplicated from Landing so
   this page has no dependency on it.
   Single source of truth will be a shared
   component once the component folder exists.
───────────────────────────────────────── */
function Logo() {
  return (
    <Link to="/" className={styles.logo} aria-label="Code Ground — go to homepage">
      <span className={styles.logo_bracket}>&lt;</span>
      <span className={styles.logo_letters}>CG</span>
      <span className={styles.logo_bracket}>/&gt;</span>
    </Link>
  );
}

/* ─────────────────────────────────────────
   PasswordInput — a controlled input that
   toggles between type="password" and
   type="text" via the eye icon button.
   Extracted so the toggle logic stays clean.
───────────────────────────────────────── */
function PasswordInput({ value, onChange, disabled, inputRef }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={styles.password_wrap}>
      <input
        ref={inputRef}
        id="password"
        /* Switch the type attribute to reveal/hide */
        type={visible ? 'text' : 'password'}
        className={styles.input}
        value={value}
        onChange={onChange}
        placeholder="••••••••"
        autoComplete="current-password"
        disabled={disabled}
        required
        minLength={6}
        aria-describedby="password-hint"
      />

      {/* Toggle button — sits inside the input via absolute positioning */}
      <button
        type="button"
        className={styles.eye_btn}
        onClick={() => setVisible(v => !v)}
        /* Accessible label changes with state */
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1} /* Don't break Tab flow — Esc or clicking is fine */
        disabled={disabled}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   Inline SVG icons — no library dep.
   Stroke-based, inherits currentColor.
───────────────────────────────────────── */
function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/* Arrow icon used inside the submit button */
function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* Spinner — shown inside submit button while loading */
function Spinner() {
  return (
    <svg
      className={styles.spinner}
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      aria-hidden="true"
    >
      {/* Only part of the circle is stroked — gives the spinning arc look */}
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────────────────────────────────
   Login — the page component
───────────────────────────────────────── */
export default function Login() {
  /* Form field state */
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  /* UI state */
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');   /* server error message */
  const [fieldErr, setFieldErr] = useState({});   /* per-field validation */

  /* Refs */
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  /* Auth context — login() calls the API and updates global user state */
  const { login } = useAuth();
  const navigate  = useNavigate();

  /* Auto-focus email on mount */
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  /* ── Per-field client validation ──
     Runs on blur so errors appear after
     the user has had a chance to type,
     not immediately on focus. */
  function validateField(name, value) {
    const errs = { ...fieldErr };

    if (name === 'email') {
      if (!value) {
        errs.email = 'Email is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errs.email = 'Enter a valid email address.';
      } else {
        delete errs.email;
      }
    }

    if (name === 'password') {
      if (!value) {
        errs.password = 'Password is required.';
      } else if (value.length < 6) {
        errs.password = 'Password must be at least 6 characters.';
      } else {
        delete errs.password;
      }
    }

    setFieldErr(errs);
  }

  /* ── Submit handler ──
     1. Prevent native form submission
     2. Clear previous server error
     3. Call login() from AuthContext
     4. On success → /dashboard
     5. On failure → parse and display error */
  async function handleSubmit(e) {
    e.preventDefault();

    /* Clear server error on each attempt */
    setError('');

    /* Run full validation before hitting the network */
    const errs = {};
    if (!email)            errs.email    = 'Email is required.';
    if (!password)         errs.password = 'Password is required.';
    if (Object.keys(errs).length) {
      setFieldErr(errs);
      /* Focus the first errored field */
      if (errs.email) emailRef.current?.focus();
      else            passwordRef.current?.focus();
      return;
    }

    setLoading(true);

    try {
      /* login() is defined in useAuth.jsx.
         It calls POST /auth/login, saves the token,
         and updates the global user state. */
      await login(email.trim().toLowerCase(), password);

      /* Success — redirect to the workspace */
      navigate('/dashboard', { replace: true });

    } catch (err) {
      /* The Axios interceptor in api.js passes through
         the response body, so err.response.data.error
         contains the server's message string. */
      const msg =
        err.response?.data?.error ||
        'Something went wrong. Please try again.';

      setError(msg);

      /* If credentials are wrong, clear password
         and move focus back for the user to retry */
      if (err.response?.status === 401) {
        setPassword('');
        passwordRef.current?.focus();
      }

    } finally {
      /* Always re-enable the button */
      setLoading(false);
    }
  }

  /* ─────────────────────────────────────
     Render
  ───────────────────────────────────── */
  return (
    <div className={styles.root}>

      {/* Decorative background grid — purely visual */}
      <div className={styles.grid_bg} aria-hidden="true" />

      {/* Ambient glow behind the card */}
      <div className={styles.glow} aria-hidden="true" />

      <main className={styles.main}>

        {/* ── Card ── */}
        <div className={styles.card} role="main">

          {/* Logo at the top of the card — links back to landing */}
          <div className={styles.card_logo}>
            <Logo />
          </div>

          {/* Heading + sub */}
          <div className={styles.card_header}>
            <h1 className={styles.heading}>Welcome back</h1>
            <p className={styles.subheading}>
              Sign in to your workspace
            </p>
          </div>

          {/* ── Server-level error banner ──
              Only shown when the API returns an error.
              Per-field errors appear below each input. */}
          {error && (
            <div
              className={styles.error_banner}
              role="alert"          /* Screen readers announce this immediately */
              aria-live="assertive"
            >
              {/* Warning icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* ── Form ── */}
          <form
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate /* We handle validation ourselves */
          >

            {/* Email field */}
            <div className={styles.field}>
              <label htmlFor="email" className={styles.label}>
                Email
              </label>
              <input
                ref={emailRef}
                id="email"
                type="email"
                className={`${styles.input} ${fieldErr.email ? styles.input_err : ''}`}
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  /* Clear field error as user types — instant feedback */
                  if (fieldErr.email) validateField('email', e.target.value);
                }}
                onBlur={e => validateField('email', e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                disabled={loading}
                required
                aria-invalid={!!fieldErr.email}
                aria-describedby={fieldErr.email ? 'email-error' : undefined}
              />
              {/* Per-field error message */}
              {fieldErr.email && (
                <span id="email-error" className={styles.field_err} role="alert">
                  {fieldErr.email}
                </span>
              )}
            </div>

            {/* Password field */}
            <div className={styles.field}>
              <div className={styles.label_row}>
                <label htmlFor="password" className={styles.label}>
                  Password
                </label>
                {/* Forgot password — right-aligned next to label */}
                <Link to="/forgot-password" className={styles.forgot_link}>
                  Forgot password?
                </Link>
              </div>

              <PasswordInput
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  if (fieldErr.password) validateField('password', e.target.value);
                }}
                onBlur={() => validateField('password', password)}
                disabled={loading}
                inputRef={passwordRef}
              />
              <span id="password-hint" className={styles.sr_only}>
                Must be at least 6 characters
              </span>
              {fieldErr.password && (
                <span id="password-error" className={styles.field_err} role="alert">
                  {fieldErr.password}
                </span>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              className={styles.submit_btn}
              disabled={loading}
              /* Communicate loading state to assistive tech */
              aria-busy={loading}
            >
              {loading ? (
                /* Loading state — spinner replaces arrow */
                <>
                  <Spinner />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRightIcon />
                </>
              )}
            </button>

          </form>

          {/* ── Divider ── */}
          <div className={styles.divider} aria-hidden="true">
            <span className={styles.divider_line} />
            <span className={styles.divider_text}>or</span>
            <span className={styles.divider_line} />
          </div>

          {/* ── Register link ── */}
          <p className={styles.register_prompt}>
            Don't have an account?{' '}
            <Link to="/register" className={styles.register_link}>
              Create one free
            </Link>
          </p>

        </div>
        {/* end .card */}

        {/* Footer note — outside the card */}
        <p className={styles.footer_note}>
          {/* Mono comment style matches the brand voice */}
          <span className={styles.footer_comment}>
            // Free forever for small teams
          </span>
        </p>

      </main>
    </div>
  );
}
