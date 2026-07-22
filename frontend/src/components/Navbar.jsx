/**
 * Navbar.jsx — Code Ground editor top bar
 *
 * Extracted from Editor.jsx's inline <header className={styles.topbar}>.
 * This is the persistent header shown at the top of the editor workspace:
 * back button, logo, editable document title, a LANGUAGE SELECTOR
 * (upgraded from the old read-only badge to an actual dropdown so users
 * can switch languages), live presence, connection status, a button to
 * open the snapshots drawer, and the Run button.
 *
 * ── What this component owns ────────────────────────────────────────
 *
 *   - Title inline-edit UI (button ↔ input toggle, local input value)
 *   - Language dropdown UI (open/close state, option list, selection)
 *   - All visual layout of the top bar
 *
 * ── What this component does NOT own ────────────────────────────────
 *
 *   - Persisting the title change (onTitleChange — parent calls the API)
 *   - Persisting the language change (onLanguageChange — parent calls the API)
 *   - The actual Yjs/Socket.io connection state (passed in as `connected`)
 *   - Presence data (rendered via the separate <Presence> component,
 *     passed in as `peers` / `currentUser` so Navbar can render it)
 *   - The Run logic itself (onRunClick — parent owns execution)
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   title           {string}    — current document title
 *   onTitleChange   {Function}  — called with (newTitle: string) when
 *                                  the user finishes editing (blur/Enter)
 *   docLoading      {boolean}   — true while document metadata is loading
 *                                  (shows "…" in place of the title)
 *
 *   language        {string}    — current language key, e.g. 'javascript'
 *   onLanguageChange {Function} — called with (newLangKey: string) when
 *                                  the user picks a different language
 *
 *   connected       {boolean}   — Socket.io connection status
 *
 *   currentUser     {Object}    — { username } for Presence + profile chip
 *   peers           {Array}     — other connected users, passed to Presence
 *
 *   onOpenSnapshots {Function}  — called when the Snapshots button is clicked
 *
 *   onRunClick      {Function}  — called when Run is clicked
 *   running         {boolean}   — true while code is executing
 *   runDisabled     {boolean}   — true to force-disable Run (e.g. doc not loaded)
 *
 * ── Usage in Editor.jsx ─────────────────────────────────────────────
 *
 *   import Navbar from '../components/Navbar.jsx';
 *
 *   <Navbar
 *     title={doc?.title}
 *     onTitleChange={handleTitleChange}
 *     docLoading={docLoading}
 *     language={doc?.language}
 *     onLanguageChange={handleLanguageChange}
 *     connected={connected}
 *     currentUser={user}
 *     peers={peers}
 *     onOpenSnapshots={() => { setShowSnapshots(true); loadSnapshots(); }}
 *     onRunClick={handleRun}
 *     running={running}
 *     runDisabled={docLoading}
 *   />
 *
 *   Remove the inline <header className={styles.topbar}>...</header>
 *   block from Editor.jsx after wiring this in.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Presence from './Presence.jsx';
import styles    from './Navbar.module.css';
import InviteModal from "./InviteModal";
/* ─────────────────────────────────────────────────────────────────────
   LANGUAGE DATA — same set used across Dashboard's NewDocModal,
   kept in sync so the language list looks identical everywhere.
───────────────────────────────────────────────────────────────────── */
const LANGUAGES = [
  { key: 'javascript', label: 'JavaScript', color: '#F7DF1E' },
  { key: 'typescript', label: 'TypeScript', color: '#3178C6' },
  { key: 'python',     label: 'Python',     color: '#3572A5' },
  { key: 'java',       label: 'Java',       color: '#B07219' },
  { key: 'cpp',        label: 'C++',        color: '#F34B7D' },
  { key: 'go',         label: 'Go',         color: '#00ADD8' },
];

const LANG_BY_KEY = Object.fromEntries(LANGUAGES.map(l => [l.key, l]));

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, inherit currentColor
───────────────────────────────────────────────────────────────────── */

const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const PlayIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
    stroke="none" aria-hidden="true">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const StopIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
    stroke="none" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const CameraIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* Spinner — spinning arc */
const Spinner = ({ size = 14 }) => (
  <svg className={styles.spinner} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   EDITABLE TITLE — button ↔ input toggle.
   Click the title to edit; blur or Enter saves; Escape cancels.
   Extracted as its own sub-component so its local `value` state
   doesn't force the whole Navbar (and the language dropdown logic)
   to re-render on every keystroke.
───────────────────────────────────────────────────────────────────── */
function EditableTitle({ title, onChange, loading }) {
  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(title ?? '');
  const inputRef = useRef(null);

  /* Keep local value in sync if the title prop changes externally
     (e.g. another collaborator renamed the doc) while NOT editing. */
  useEffect(() => {
    if (!editing) setValue(title ?? '');
  }, [title, editing]);

  function startEditing() {
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      onChange(trimmed);
    } else {
      /* Revert to the original if empty or unchanged */
      setValue(title ?? '');
    }
  }

  function cancel() {
    setValue(title ?? '');
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.title_input}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  commit();
          if (e.key === 'Escape') cancel();
        }}
        maxLength={80}
        autoFocus
        aria-label="Document title"
      />
    );
  }

  return (
    <button
      className={styles.title_btn}
      onClick={startEditing}
      title="Click to rename"
      aria-label={`Title: ${title ?? '…'}. Click to rename.`}
    >
      {loading ? '…' : (title || 'Untitled')}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   LANGUAGE SELECTOR — dropdown that replaces the old read-only badge.
   Shows the current language as a coloured-dot pill; clicking opens
   a menu of all supported languages with a checkmark on the active one.
───────────────────────────────────────────────────────────────────── */
function LanguageSelector({ language, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = LANG_BY_KEY[language] ?? { label: language || 'Language', color: '#64748B' };

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  /* Close on Escape */
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  function handleSelect(langKey) {
    setOpen(false);
    if (langKey !== language) onChange(langKey);
  }

  return (
    <div className={styles.lang_select} ref={ref}>
      <button
        className={styles.lang_badge}
        style={{ '--lc': current.color }}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${current.label}. Click to change.`}
      >
        <span className={styles.lang_badge_dot} aria-hidden="true" />
        {current.label}
        <span className={styles.lang_chevron} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <ul className={styles.lang_menu} role="menu" aria-label="Choose language">
          {LANGUAGES.map(lang => (
            <li key={lang.key} role="none">
              <button
                className={styles.lang_option}
                role="menuitem"
                onClick={() => handleSelect(lang.key)}
              >
                <span
                  className={styles.lang_option_dot}
                  style={{ background: lang.color }}
                  aria-hidden="true"
                />
                <span className={styles.lang_option_label}>{lang.label}</span>
                {lang.key === language && (
                  <span className={styles.lang_option_check} aria-hidden="true">
                    <CheckIcon />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   NAVBAR — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function Navbar({
  title,
  onTitleChange,
  docLoading      = false,

  language,
  onLanguageChange,

  connected       = false,

  currentUser,
  peers           = [],

  onOpenSnapshots,

  onRunClick,
  running         = false,
  runDisabled     = false,
  documentId,
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <header className={styles.topbar}>

      {/* ── Left group: back, logo, title, language ── */}
      <div className={styles.left}>

        <Link to="/dashboard" className={styles.back_btn} aria-label="Back to dashboard">
          <BackIcon />
        </Link>

        <Link to="/" className={styles.logo} aria-label="Code Ground">
          <span className={styles.logo_bracket}>&lt;</span>
          <span className={styles.logo_letters}>CG</span>
          <span className={styles.logo_bracket}>/&gt;</span>
        </Link>

        <span className={styles.sep} aria-hidden="true">/</span>

        <EditableTitle
          title={title}
          onChange={onTitleChange}
          loading={docLoading}
        />

        {language && (
          <LanguageSelector
            language={language}
            onChange={onLanguageChange}
            disabled={docLoading}
          />
        )}
      </div>

      {/* ── Centre group: live presence ── */}
      <div className={styles.centre}>
        <Presence currentUser={currentUser} peers={peers} maxVisible={4} />
      </div>

      {/* ── Right group: connection, snapshots, run ── */}
      <div className={styles.right}>

        <div
          className={`${styles.conn_dot} ${connected ? styles.conn_on : styles.conn_off}`}
          title={connected ? 'Connected — real-time sync active' : 'Disconnected'}
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />

        {onOpenSnapshots && (
          <button
            className={styles.snapshots_btn}
            onClick={onOpenSnapshots}
            aria-label="Open snapshots panel"
          >
            <CameraIcon />
            <span className={styles.snapshots_label}>Snapshots</span>
          </button>
        )}

<button
    className={styles.snapshots_btn}
    onClick={() => setInviteOpen(true)}
>
    Invite
</button>

        <button
          className={`${styles.run_btn} ${running ? styles.run_btn_running : ''}`}
          onClick={onRunClick}
          disabled={running || runDisabled}
          aria-busy={running}
          aria-label={running ? 'Running…' : 'Run code'}
        >
          {running ? (
            <><StopIcon /> Running…</>
          ) : (
            <><PlayIcon /> Run</>
          )}
        </button>

      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        documentId={documentId}
      />
      
    </header>
  );
}
