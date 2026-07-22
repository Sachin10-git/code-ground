/**
 * Register.jsx — Code Ground account creation page
 *
 * Responsibilities:
 *   1. Render username + email + password + confirm-password form
 *   2. Run client-side validation on every field (on blur + on submit)
 *   3. Show a live password strength meter as the user types
 *   4. POST /auth/register via register() from AuthContext
 *   5. On success → JWT saved, user set in context, redirect to /dashboard
 *   6. On failure → display server error inline (409 = email/username taken)
 *
 * Auth flow:
 *   Register → register(username, email, password)   [from useAuth.jsx]
 *           → POST /auth/register
 *           → { token, user }
 *           → localStorage.setItem('cg_token', token)
 *           → AuthContext.setUser(user)
 *           → navigate('/dashboard', { replace: true })
 *
 * Differences from Login.jsx:
 *   - One extra field: username (3–20 chars, alphanumeric + underscore)
 *   - Confirm password field (client-side match check only — not sent to server)
 *   - Live password strength indicator (score 0–4 based on entropy rules)
 *   - autoComplete="new-password" instead of "current-password" so browsers
 *     offer to generate a strong password rather than autofill the saved one
 *
 * Shared CSS:
 *   Most styles (card, inputs, buttons, errors) are imported from
 *   Login.module.css via a shared import. Register.module.css only
 *   defines styles that are unique to this page (strength meter, etc.).
 *   This keeps the two pages visually consistent without duplicating CSS.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import shared from './Login.module.css';      /* shared card/form/input styles  */
import styles from './Register.module.css';   /* register-specific styles only  */

/* ─────────────────────────────────────────
   Logo — identical to Login.jsx.
   Will be extracted to src/components/Logo.jsx
   once that folder is created.
───────────────────────────────────────── */
function Logo() {
  return (
    <Link to="/" className={shared.logo} aria-label="Code Ground — go to homepage">
      <span className={shared.logo_bracket}>&lt;</span>
      <span className={shared.logo_letters}>CG</span>
      <span className={shared.logo_bracket}>/&gt;</span>
    </Link>
  );
}

/* ─────────────────────────────────────────
   Inline SVG icons — no library dep.
   All stroke-based, inherit currentColor.
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

function Spinner() {
  return (
    <svg
      className={shared.spinner}
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

/* Check icon — shown next to field when valid */
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ─────────────────────────────────────────
   PasswordInput — reused from Login pattern.
   id prop added so each instance (password
   and confirm) gets a unique HTML id.
───────────────────────────────────────── */
function PasswordInput({ id, value, onChange, onBlur, disabled, inputRef, placeholder = '••••••••', autoComplete = 'new-password' }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={shared.password_wrap}>
      <input
        ref={inputRef}
        id={id}
        type={visible ? 'text' : 'password'}
        className={shared.input}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required
        minLength={6}
      />
      <button
        type="button"
        className={shared.eye_btn}
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        disabled={disabled}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────
   passwordStrength — scores a password 0–4.

   Rules (each adds 1 point):
     1. Length ≥ 8
     2. Contains a number
     3. Contains a special character
     4. Contains both upper and lower case

   Returns: { score: 0|1|2|3|4, label: string, color: string }

   Used to drive both the visual meter bars
   and the accessible aria-label on the meter.
───────────────────────────────────────── */
function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: '' };

  let score = 0;
  if (pwd.length >= 8)                     score++;  /* length check */
  if (/[0-9]/.test(pwd))                   score++;  /* has digit */
  if (/[^a-zA-Z0-9]/.test(pwd))            score++;  /* has special char */
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++; /* mixed case */

  const levels = [
    { label: '',          color: '' },           /* 0 — empty         */
    { label: 'Weak',      color: '#F87171' },    /* 1 — red           */
    { label: 'Fair',      color: '#FBBF24' },    /* 2 — amber         */
    { label: 'Good',      color: '#34D399' },    /* 3 — green         */
    { label: 'Strong',    color: '#22D3EE' },    /* 4 — cyan (brand)  */
  ];

  return { score, ...levels[score] };
}

/* ─────────────────────────────────────────
   StrengthMeter — four bar segments that
   fill progressively as the score increases.
   Purely visual — no interactive behaviour.
───────────────────────────────────────── */
function StrengthMeter({ password }) {
  const { score, label, color } = passwordStrength(password);

  /* Don't render until user has started typing */
  if (!password) return null;

  return (
    <div
      className={styles.strength_wrap}
      /* Describe the strength level to screen readers */
      role="status"
      aria-label={`Password strength: ${label || 'too short'}`}
    >
      {/* Four bar segments */}
      <div className={styles.strength_bars} aria-hidden="true">
        {[1, 2, 3, 4].map(i => (
          <span
            key={i}
            className={styles.strength_bar}
            style={{
              /* Filled bars get the strength colour; empty bars stay dim */
              background: i <= score ? color : undefined,
              /* Slight transition so bars animate in as score increases */
              transition: 'background 0.25s ease',
            }}
          />
        ))}
      </div>

      {/* Text label — coloured to match the bars */}
      {label && (
        <span className={styles.strength_label} style={{ color }}>
          {label}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   VALIDATION RULES
   Centralised here so they're easy to update
   without hunting through the component.
───────────────────────────────────────── */
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;   /* alphanumeric + underscore only */

function validateAll(fields) {
  const { username, email, password, confirm } = fields;
  const errs = {};

  /* Username */
  if (!username.trim()) {
    errs.username = 'Username is required.';
  } else if (username.trim().length < 3) {
    errs.username = 'Username must be at least 3 characters.';
  } else if (username.trim().length > 20) {
    errs.username = 'Username must be 20 characters or fewer.';
  } else if (!USERNAME_RE.test(username.trim())) {
    errs.username = 'Only letters, numbers, and underscores allowed.';
  }

  /* Email */
  if (!email.trim()) {
    errs.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errs.email = 'Enter a valid email address.';
  }

  /* Password */
  if (!password) {
    errs.password = 'Password is required.';
  } else if (password.length < 6) {
    errs.password = 'Password must be at least 6 characters.';
  }

  /* Confirm password — client-side only, never sent to server */
  if (!confirm) {
    errs.confirm = 'Please confirm your password.';
  } else if (confirm !== password) {
    errs.confirm = 'Passwords do not match.';
  }

  return errs;
}

/* Single-field version — called on blur for per-field feedback */
function validateSingleField(name, value, allFields) {
  /* Run full validation then return only the error for this field */
  const allErrs = validateAll({ ...allFields, [name]: value });
  return allErrs[name] || null;
}

/* ─────────────────────────────────────────
   Register — the page component
───────────────────────────────────────── */
export default function Register() {
  /* ── Form field state ── */
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');

  /* ── UI state ── */
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');    /* server-level error  */
  const [fieldErr, setFieldErr] = useState({});    /* per-field errors    */
  const [touched,  setTouched]  = useState({});    /* which fields blurred */

  /* ── Refs for focus management ── */
  const usernameRef = useRef(null);
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);
  const confirmRef  = useRef(null);

  /* ── Auth context ── */
  const { register } = useAuth();
  const navigate     = useNavigate();

  /* Auto-focus username on mount */
  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  /* ── All fields as a single object ──
     Passed into validateAll / validateSingleField */
  const allFields = { username, email, password, confirm };

  /* ── Per-field blur handler ──
     Marks the field as touched and validates it. */
  function handleBlur(name) {
    setTouched(t => ({ ...t, [name]: true }));
    const err = validateSingleField(name, allFields[name], allFields);
    setFieldErr(prev => {
      const next = { ...prev };
      if (err) next[name] = err;
      else     delete next[name];
      return next;
    });
  }

  /* ── Per-field change handler ──
     Clears the field's error as soon as the user
     types a valid value — feels responsive. */
  function handleChange(name, value) {
    /* Update the right state setter */
    const setters = { username: setUsername, email: setEmail, password: setPassword, confirm: setConfirm };
    setters[name](value);

    /* Only re-validate if the field has already been touched
       (don't flash errors before the user has left the field) */
    if (touched[name]) {
      const updatedFields = { ...allFields, [name]: value };
      const err = validateSingleField(name, value, updatedFields);
      setFieldErr(prev => {
        const next = { ...prev };
        if (err) next[name] = err;
        else     delete next[name];
        return next;
      });
    }

    /* Special case: if confirm is already filled and user edits password,
       re-check the match immediately so the confirm error stays current */
    if (name === 'password' && touched.confirm && confirm) {
      setFieldErr(prev => ({
        ...prev,
        confirm: value !== confirm ? 'Passwords do not match.' : undefined,
      }));
    }
  }

  /* ── Submit handler ── */
  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    /* Mark all fields touched so all errors become visible */
    setTouched({ username: true, email: true, password: true, confirm: true });

    /* Full validation before hitting network */
    const errs = validateAll(allFields);
    if (Object.keys(errs).length) {
      setFieldErr(errs);
      /* Focus the first field that has an error */
      const order = ['username', 'email', 'password', 'confirm'];
      const firstErr = order.find(f => errs[f]);
      const refMap = { username: usernameRef, email: emailRef, password: passwordRef, confirm: confirmRef };
      refMap[firstErr]?.current?.focus();
      return;
    }

    setLoading(true);

    try {
      /* register() is defined in useAuth.jsx.
         It calls POST /auth/register, saves the token,
         and sets the user in global context.
         We do NOT send confirm — it's client-side only. */
      await register(username.trim(), email.trim().toLowerCase(), password);

      /* Success — send straight to the workspace */
      navigate('/dashboard', { replace: true });

    } catch (err) {
      const msg =
        err.response?.data?.error ||
        'Something went wrong. Please try again.';

      setError(msg);

      /* 409 = username or email already taken.
         The server message will say which one,
         so we just surface it in the banner. */
      if (err.response?.status === 409) {
        /* Keep the form filled — user just needs to change one value */
        usernameRef.current?.focus();
      }

    } finally {
      setLoading(false);
    }
  }

  /* ── Derived: is a field "valid and touched"?
     Used to show the green check icon. */
  function isValid(name) {
    return touched[name] && !fieldErr[name] && allFields[name];
  }

  /* ─────────────────────────────────────
     Render
  ───────────────────────────────────── */
  return (
    <div className={shared.root}>

      {/* Decorative dot-grid background */}
      <div className={shared.grid_bg} aria-hidden="true" />

      {/* Ambient glow orb behind the card */}
      <div className={shared.glow} aria-hidden="true" />

      <main className={shared.main} style={{ maxWidth: '440px' }}>

        {/* ── Card ── */}
        <div className={shared.card}>

          {/* Logo */}
          <div className={shared.card_logo}>
            <Logo />
          </div>

          {/* Heading + sub */}
          <div className={shared.card_header}>
            <h1 className={shared.heading}>Create your account</h1>
            <p className={shared.subheading}>
              Free forever · No credit card needed
            </p>
          </div>

          {/* Server-level error banner */}
          {error && (
            <div className={shared.error_banner} role="alert" aria-live="assertive">
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
          <form className={shared.form} onSubmit={handleSubmit} noValidate>

            {/* ── Username ── */}
            <div className={shared.field}>
              <div className={shared.label_row}>
                <label htmlFor="username" className={shared.label}>
                  Username
                </label>
                {/* Green check when valid */}
                {isValid('username') && (
                  <span className={styles.valid_check} aria-hidden="true">
                    <CheckIcon /> valid
                  </span>
                )}
              </div>

              <input
                ref={usernameRef}
                id="username"
                type="text"
                className={`${shared.input} ${fieldErr.username ? shared.input_err : ''}`}
                value={username}
                onChange={e => handleChange('username', e.target.value)}
                onBlur={() => handleBlur('username')}
                placeholder="cooldev_123"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={loading}
                required
                minLength={3}
                maxLength={20}
                aria-invalid={!!fieldErr.username}
                aria-describedby={fieldErr.username ? 'username-error' : 'username-hint'}
              />

              {/* Hint shown before any error — tells user the rules */}
              {!fieldErr.username && !touched.username && (
                <span id="username-hint" className={styles.field_hint}>
                  3–20 chars · letters, numbers, underscores
                </span>
              )}

              {fieldErr.username && (
                <span id="username-error" className={shared.field_err} role="alert">
                  {fieldErr.username}
                </span>
              )}
            </div>

            {/* ── Email ── */}
            <div className={shared.field}>
              <div className={shared.label_row}>
                <label htmlFor="email" className={shared.label}>
                  Email
                </label>
                {isValid('email') && (
                  <span className={styles.valid_check} aria-hidden="true">
                    <CheckIcon /> valid
                  </span>
                )}
              </div>

              <input
                ref={emailRef}
                id="email"
                type="email"
                className={`${shared.input} ${fieldErr.email ? shared.input_err : ''}`}
                value={email}
                onChange={e => handleChange('email', e.target.value)}
                onBlur={() => handleBlur('email')}
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                disabled={loading}
                required
                aria-invalid={!!fieldErr.email}
                aria-describedby={fieldErr.email ? 'email-error' : undefined}
              />

              {fieldErr.email && (
                <span id="email-error" className={shared.field_err} role="alert">
                  {fieldErr.email}
                </span>
              )}
            </div>

            {/* ── Password ── */}
            <div className={shared.field}>
              <div className={shared.label_row}>
                <label htmlFor="reg-password" className={shared.label}>
                  Password
                </label>
                {/* Show strength label next to the label once user has typed */}
                {password && !fieldErr.password && (
                  <span className={styles.strength_inline}
                    style={{ color: passwordStrength(password).color }}>
                    {passwordStrength(password).label}
                  </span>
                )}
              </div>

              <PasswordInput
                id="reg-password"
                value={password}
                onChange={e => handleChange('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                disabled={loading}
                inputRef={passwordRef}
                autoComplete="new-password"
              />

              {/* Strength meter — only shown while typing, hides on error */}
              {!fieldErr.password && <StrengthMeter password={password} />}

              {fieldErr.password && (
                <span id="password-error" className={shared.field_err} role="alert">
                  {fieldErr.password}
                </span>
              )}
            </div>

            {/* ── Confirm password ── */}
            <div className={shared.field}>
              <div className={shared.label_row}>
                <label htmlFor="confirm-password" className={shared.label}>
                  Confirm password
                </label>
                {isValid('confirm') && confirm === password && (
                  <span className={styles.valid_check} aria-hidden="true">
                    <CheckIcon /> match
                  </span>
                )}
              </div>

              <PasswordInput
                id="confirm-password"
                value={confirm}
                onChange={e => handleChange('confirm', e.target.value)}
                onBlur={() => handleBlur('confirm')}
                disabled={loading}
                inputRef={confirmRef}
                placeholder="repeat your password"
                autoComplete="new-password"
              />

              {fieldErr.confirm && (
                <span id="confirm-error" className={shared.field_err} role="alert">
                  {fieldErr.confirm}
                </span>
              )}
            </div>

            {/* ── Terms note ──
                Not a checkbox — just a notice.
                Keeps the form lightweight. */}
            <p className={styles.terms_note}>
              By creating an account you agree to our{' '}
              <a href="/terms" className={styles.terms_link}>Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className={styles.terms_link}>Privacy Policy</a>.
            </p>

            {/* Submit button */}
            <button
              type="submit"
              className={shared.submit_btn}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <Spinner />
                  Creating account…
                </>
              ) : (
                <>
                  Create account
                  <ArrowRightIcon />
                </>
              )}
            </button>

          </form>

          {/* Divider */}
          <div className={shared.divider} aria-hidden="true">
            <span className={shared.divider_line} />
            <span className={shared.divider_text}>or</span>
            <span className={shared.divider_line} />
          </div>

          {/* Already have an account */}
          <p className={shared.register_prompt}>
            Already have an account?{' '}
            <Link to="/login" className={shared.register_link}>
              Sign in
            </Link>
          </p>

        </div>
        {/* end .card */}

        {/* Footer note */}
        <p className={shared.footer_note}>
          <span className={shared.footer_comment}>
            // join thousands of developers coding together
          </span>
        </p>

      </main>
    </div>
  );
}
