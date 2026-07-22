/**
 * Dashboard.jsx — Code Ground workspace home
 *
 * This is the first page a user lands on after logging in.
 * It is the control centre of the product.
 *
 * ── What this page renders ──────────────────────────────────────────
 *
 *   <TopNav>          sticky header — logo, username chip, sign-out
 *   <WelcomeBanner>   greeting + stats (doc count, session count)
 *   <DocumentGrid>    the user's documents as cards in a responsive grid
 *   <NewDocModal>     slide-in modal to create a new document
 *   <EmptyState>      shown when the user has zero documents
 *
 * ── Data flow ───────────────────────────────────────────────────────
 *
 *   On mount:
 *     1. GET /documents          → list of user's docs (with session summary)
 *     2. Render the grid
 *
 *   New document:
 *     1. User clicks "New document"
 *     2. <NewDocModal> opens — user enters title + picks language
 *     3. POST /documents         → { id, title, language, ... }
 *     4. Prepend new doc to local state (no re-fetch needed)
 *     5. navigate('/editor/:id') — go straight into the editor
 *
 *   Delete document:
 *     1. User clicks ✕ on a doc card
 *     2. Confirmation shown inline (not a browser alert)
 *     3. DELETE /documents/:id
 *     4. Remove from local state
 *
 * ── API contract ────────────────────────────────────────────────────
 *
 *   GET    /documents
 *     → Array<{
 *         id, title, language, is_public,
 *         content, updated_at, created_at,
 *         owner_name,           // from JOIN with users
 *         member_count,         // number of collaborators
 *         session_summary,      // AI-generated after last session (nullable)
 *         last_session_at,      // timestamp of last session (nullable)
 *       }>
 *
 *   POST   /documents          body: { title, language }   → Document
 *   DELETE /documents/:id                                  → { success: true }
 *
 * ── Local state ─────────────────────────────────────────────────────
 *
 *   docs         — the document list from the API
 *   loading      — true while the initial fetch is in flight
 *   fetchError   — non-null if the initial fetch failed
 *   creating     — true while POST /documents is in flight
 *   showModal    — controls NewDocModal visibility
 *   deleteTarget — id of the doc currently showing inline confirm
 *   deleting     — true while DELETE is in flight
 *
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate }                               from 'react-router-dom';
import { useAuth }                                         from '../hooks/useAuth.jsx';
import api                                                 from '../utils/api.js';
import styles                                              from './Dashboard.module.css';
/* ─────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────── */

/**
 * Supported languages.
 * Key   = value sent to the API and used to pick the execution Docker image.
 * Label = displayed in dropdowns and on doc cards.
 * Color = the dot on the doc card (matches GitHub's language colours loosely).
 */
const LANGUAGES = [
  { key: 'javascript', label: 'JavaScript', color: '#F7DF1E' },
  { key: 'typescript', label: 'TypeScript', color: '#3178C6' },
  { key: 'python',     label: 'Python',     color: '#3572A5' },
  { key: 'java',       label: 'Java',       color: '#B07219' },
  { key: 'cpp',        label: 'C++',        color: '#F34B7D' },
  { key: 'go',         label: 'Go',         color: '#00ADD8' },
];

/* Lookup map: language key → colour */
const LANG_COLOR = Object.fromEntries(LANGUAGES.map(l => [l.key, l.color]));

/* Human-readable language label */
const LANG_LABEL = Object.fromEntries(LANGUAGES.map(l => [l.key, l.label]));

/* ─────────────────────────────────────────────────────────────────────
   UTILITY HELPERS
───────────────────────────────────────────────────────────────────── */

/**
 * relativeTime — formats a date string as a human-friendly relative time.
 * Examples: "just now", "5 min ago", "3 hr ago", "2 days ago", "Jan 14"
 *
 * We roll our own instead of pulling in date-fns to keep the bundle small.
 * The dashboard only needs this one formatting function.
 */
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000; /* seconds */

  if (diff < 60)           return 'just now';
  if (diff < 3600)         return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400)        return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7)    return `${Math.floor(diff / 86400)} days ago`;

  /* Older than a week — show the date */
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * avatarColor — deterministically picks one of 8 accent colours
 * from a username string. Same username always gets the same colour.
 * Used for the user chip in the nav.
 */
const AVATAR_COLORS = [
  '#3B82F6', '#22D3EE', '#34D399', '#F59E0B',
  '#EC4899', '#8B5CF6', '#F87171', '#60A5FA',
];

function avatarColor(username = '') {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS  (inline SVG, no library)
───────────────────────────────────────────────────────────────────── */

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const UsersIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const BotIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 4 0v2" />
    <path d="M16 7V5a2 2 0 0 0-4 0v2" />
    <circle cx="9" cy="13" r="1" fill="currentColor" />
    <circle cx="15" cy="13" r="1" fill="currentColor" />
    <path d="M9 17h6" />
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const LogOutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   SPINNER — arc SVG that spins via CSS animation
───────────────────────────────────────────────────────────────────── */
function Spinner({ size = 16 }) {
  return (
    <svg className={styles.spinner} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      aria-hidden="true">
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   TOP NAV
   Sticky header with logo, username chip, and sign-out button.
   The user chip shows the first letter of the username in their
   deterministic avatar colour.
───────────────────────────────────────────────────────────────────── */
function TopNav({ user, onSignOut }) {
  const color = avatarColor(user?.username);

  return (
    <nav className={styles.topnav} role="navigation" aria-label="Main navigation">

      {/* Left — logo links back to landing */}
      <Link to="/" className={styles.nav_logo} aria-label="Code Ground home">
        <span className={styles.nav_logo_bracket}>&lt;</span>
        <span className={styles.nav_logo_letters}>CG</span>
        <span className={styles.nav_logo_bracket}>/&gt;</span>
      </Link>

      {/* Right — user identity + actions */}
      <div className={styles.nav_right}>

        {/* Username chip with coloured initial */}
        <div className={styles.user_chip} aria-label={`Signed in as ${user?.username}`}>
          <span
            className={styles.user_initial}
            style={{ background: color }}
            aria-hidden="true"
          >
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </span>
          <span className={styles.user_name}>{user?.username}</span>
        </div>

        {/* Sign out */}
        <button
          className={styles.signout_btn}
          onClick={onSignOut}
          aria-label="Sign out"
        >
          <LogOutIcon />
          <span>Sign out</span>
        </button>

      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   WELCOME BANNER
   Greeting + two stat pills (doc count, session count).
   The greeting changes based on time of day.
───────────────────────────────────────────────────────────────────── */
function WelcomeBanner({ user, docs }) {
  /* Time-of-day greeting */
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
                'Good evening';

  /* Count how many docs have a session summary */
  const sessionCount = docs.filter(d => d.session_summary).length;

  return (
    <div className={styles.welcome}>
      <div className={styles.welcome_text}>
        <h1 className={styles.welcome_heading}>
          {greeting},{' '}
          <span className={styles.welcome_name}>{user?.username}</span>
          {/* Terminal cursor — decorative, signals "code" world */}
          <span className={styles.cursor_blink} aria-hidden="true">_</span>
        </h1>
        <p className={styles.welcome_sub}>
          Your workspace is ready. Pick up where you left off.
        </p>
      </div>

      {/* Quick stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.stat_value}>{docs.length}</span>
          <span className={styles.stat_label}>
            {docs.length === 1 ? 'document' : 'documents'}
          </span>
        </div>
        <div className={styles.stat_divider} aria-hidden="true" />
        <div className={styles.stat}>
          <span className={styles.stat_value}>{sessionCount}</span>
          <span className={styles.stat_label}>
            {sessionCount === 1 ? 'session' : 'sessions'} logged
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   DOCUMENT CARD
   One card per document. Shows language dot, title, metadata row,
   session summary (if available), and action buttons.
   The delete flow uses an inline confirmation (no browser alert).
───────────────────────────────────────────────────────────────────── */
function DocCard({ doc, onOpen, onDelete, isDeleting }) {
  /* Controls whether the inline delete confirmation is showing */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const langColor = LANG_COLOR[doc.language] ?? '#64748B';
  const langLabel = LANG_LABEL[doc.language] ?? doc.language;

  function handleDeleteClick(e) {
    /* Stop the click from bubbling up to the card's onClick (open) */
    e.stopPropagation();
    setConfirmDelete(true);
  }

  function handleCancelDelete(e) {
    e.stopPropagation();
    setConfirmDelete(false);
  }

  function handleConfirmDelete(e) {
    e.stopPropagation();
    onDelete(doc.id);
    /* Don't reset confirmDelete — the card will unmount once deleted */
  }

  return (
    <article
      className={styles.doc_card}
      /* Clicking anywhere on the card opens the editor */
      onClick={() => !confirmDelete && onOpen(doc.id)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.title}`}
      /* Keyboard: Enter or Space opens the doc */
      onKeyDown={e => {
        if ((e.key === 'Enter' || e.key === ' ') && !confirmDelete) {
          e.preventDefault();
          onOpen(doc.id);
        }
      }}
    >
      {/* ── Card top row: language dot + label + delete button ── */}
      <div className={styles.card_top}>
        <div className={styles.lang_row}>
          {/* Coloured dot signals the language */}
          <span
            className={styles.lang_dot}
            style={{ background: langColor }}
            aria-hidden="true"
          />
          <span className={styles.lang_label}>{langLabel}</span>
        </div>

        {/* Delete — shows confirm prompt on first click */}
        {!confirmDelete ? (
          <button
            className={styles.delete_btn}
            onClick={handleDeleteClick}
            aria-label={`Delete ${doc.title}`}
            title="Delete document"
          >
            <TrashIcon />
          </button>
        ) : (
          /* Inline confirmation — replaces the trash icon */
          <div className={styles.delete_confirm} onClick={e => e.stopPropagation()}>
            <span className={styles.delete_confirm_text}>Delete?</span>
            <button
              className={styles.delete_confirm_yes}
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              aria-label="Confirm delete"
            >
              {isDeleting ? <Spinner size={12} /> : 'Yes'}
            </button>
            <button
              className={styles.delete_confirm_no}
              onClick={handleCancelDelete}
              aria-label="Cancel delete"
            >
              No
            </button>
          </div>
        )}
      </div>

      {/* ── Document title ── */}
      <h2 className={styles.card_title}>{doc.title}</h2>

      {/* ── Meta row: updated time + collaborator count ── */}
      <div className={styles.card_meta}>
        <span className={styles.meta_item}>
          <ClockIcon />
          {relativeTime(doc.updatedAt)}
        </span>
        {(doc.member_count ?? 0) > 0 && (
          <span className={styles.meta_item}>
            <UsersIcon />
            {doc.member_count} {doc.member_count === 1 ? 'collaborator' : 'collaborators'}
          </span>
        )}
        {doc.is_public && (
          <span className={styles.public_badge}>public</span>
        )}
      </div>

      {/* ── Session summary — the AI-generated note ──
          Only rendered when the backend has generated one
          (i.e. after at least one session has ended).
          This is the feature that makes Code Ground feel alive. */}
      {doc.session_summary && (
        <div className={styles.session_summary}>
          <div className={styles.summary_header}>
            <BotIcon />
            <span className={styles.summary_label}>Last session</span>
            {doc.last_session_at && (
              <span className={styles.summary_time}>
                {relativeTime(doc.last_session_at)}
              </span>
            )}
          </div>
          <p className={styles.summary_text}>
            {/* Truncate long summaries — full text visible inside editor */}
            {doc.session_summary.length > 140
              ? doc.session_summary.slice(0, 140) + '…'
              : doc.session_summary}
          </p>
        </div>
      )}

      {/* ── Open button — appears on hover via CSS ── */}
      <div className={styles.card_footer}>
        <span className={styles.open_hint}>
          Open editor <ArrowRightIcon />
        </span>
      </div>

    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE
   Shown when the user has no documents yet.
   Has a direct CTA to create the first one.
───────────────────────────────────────────────────────────────────── */
function EmptyState({ onCreate }) {
  return (
    <div className={styles.empty} role="status">

      {/* ASCII-art style terminal prompt — on-theme */}
      <div className={styles.empty_icon} aria-hidden="true">
        <span className={styles.empty_prompt}>$ </span>
        <span className={styles.empty_cursor}>_</span>
      </div>

      <h2 className={styles.empty_heading}>No documents yet</h2>
      <p className={styles.empty_sub}>
        Create your first document and invite a teammate.
        The AI pair programmer will be watching from the start.
      </p>

      <button className={styles.create_btn} onClick={onCreate}>
        <PlusIcon />
        Create first document
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   NEW DOC MODAL
   Slides up from the bottom on mobile, fades in centred on desktop.
   Contains: title input, language selector, submit button.
   Closes on Escape or clicking the backdrop.
───────────────────────────────────────────────────────────────────── */
function NewDocModal({ open, onClose, onCreate, creating }) {
  const [title,    setTitle]    = useState('');
  const [language, setLanguage] = useState('javascript');
  const [titleErr, setTitleErr] = useState('');

  const titleRef    = useRef(null);
  const modalRef    = useRef(null);

  /* Focus the title input when modal opens */
  useEffect(() => {
    if (open) {
      /* Small delay so the CSS transition finishes before focusing */
      const t = setTimeout(() => titleRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  /* Close on Escape key */
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Reset form when modal closes */
  useEffect(() => {
    if (!open) {
      setTitle('');
      setLanguage('javascript');
      setTitleErr('');
    }
  }, [open]);

  /* Prevent body scroll while modal is open */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();

    /* Validate title */
    if (!title.trim()) {
      setTitleErr('Please enter a document title.');
      titleRef.current?.focus();
      return;
    }
    if (title.trim().length > 80) {
      setTitleErr('Title must be 80 characters or fewer.');
      return;
    }

    setTitleErr('');

    /* Delegate to parent — parent handles the API call */
    await onCreate({ title: title.trim(), language });
  }

  /* Don't render to the DOM at all when closed */
  if (!open) return null;

  return (
    /* Backdrop — click outside closes the modal */
    <div
      className={styles.modal_backdrop}
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      {/* Modal panel — stopPropagation so clicks inside don't close it */}
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Modal header */}
        <div className={styles.modal_header}>
          <h2 id="modal-title" className={styles.modal_title}>
            New document
          </h2>
          {/* Close button */}
          <button
            className={styles.modal_close}
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>

          {/* Title input */}
          <div className={styles.modal_field}>
            <label htmlFor="doc-title" className={styles.modal_label}>
              Document title
            </label>
            <input
              ref={titleRef}
              id="doc-title"
              type="text"
              className={`${styles.modal_input} ${titleErr ? styles.modal_input_err : ''}`}
              value={title}
              onChange={e => {
                setTitle(e.target.value);
                /* Clear error as user types */
                if (titleErr && e.target.value.trim()) setTitleErr('');
              }}
              placeholder="e.g. auth-service, interview-prep"
              maxLength={80}
              disabled={creating}
              aria-invalid={!!titleErr}
              aria-describedby={titleErr ? 'title-error' : undefined}
            />
            {titleErr && (
              <span id="title-error" className={styles.modal_err} role="alert">
                {titleErr}
              </span>
            )}
          </div>

          {/* Language selector */}
          <div className={styles.modal_field}>
            <label htmlFor="doc-lang" className={styles.modal_label}>
              Language
            </label>
            <div className={styles.lang_grid}>
              {LANGUAGES.map(lang => (
                <button
                  key={lang.key}
                  type="button"
                  className={`${styles.lang_btn} ${language === lang.key ? styles.lang_btn_active : ''}`}
                  onClick={() => setLanguage(lang.key)}
                  disabled={creating}
                  aria-pressed={language === lang.key}
                >
                  {/* Coloured dot */}
                  <span
                    className={styles.lang_btn_dot}
                    style={{ background: lang.color }}
                    aria-hidden="true"
                  />
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className={styles.modal_submit}
            disabled={creating}
            aria-busy={creating}
          >
            {creating ? (
              <>
                <Spinner size={15} />
                Creating…
              </>
            ) : (
              <>
                <PlusIcon />
                Create document
              </>
            )}
          </button>

        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SKELETON CARDS
   Shown during the initial data fetch.
   Three pulsing placeholder cards so the layout doesn't jump.
───────────────────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className={styles.skeleton_card} aria-hidden="true">
      <div className={styles.sk_top} />
      <div className={styles.sk_title} />
      <div className={styles.sk_meta} />
      <div className={styles.sk_summary} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   DASHBOARD — page root
   Owns all state, makes all API calls, passes data down to children.
───────────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  /* ── State ── */
  const [docs,        setDocs]        = useState([]);
  const [loading,     setLoading]     = useState(true);   /* initial fetch  */
  const [fetchError,  setFetchError]  = useState('');     /* fetch failure  */
  const [showModal,   setShowModal]   = useState(false);  /* new doc modal  */
  const [creating,    setCreating]    = useState(false);  /* POST in flight */
  const [deletingId,  setDeletingId]  = useState(null);   /* which doc id   */

  /* ── Fetch documents on mount ── */
  useEffect(() => {
    let cancelled = false;

    async function fetchDocs() {
      setLoading(true);
      setFetchError('');
      try {
        const { data } = await api.get('/documents');
        if (!cancelled) setDocs(data);
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err.response?.data?.error ||
            'Failed to load documents. Please refresh.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDocs();

    /* Cleanup — prevent state update on unmounted component */
    return () => { cancelled = true; };
  }, []);

  /* ── Create document ──
     Called by NewDocModal on form submit.
     On success: prepend to docs list, close modal, navigate to editor. */
  const handleCreate = useCallback(async ({ title, language }) => {
    setCreating(true);
    try {
      const { data: newDoc } = await api.post('/documents', { title, language });

      /* Optimistic UI: add to front of list immediately */
      setDocs(prev => [newDoc, ...prev]);
      setShowModal(false);

      /* Go straight into the new document — no extra click needed */
      navigate(`/editor/${newDoc.id}`);

    } catch (err) {
      /* Keep modal open so user can retry */
      console.error('Create doc failed:', err);
    } finally {
      setCreating(false);
    }
  }, [navigate]);

  /* ── Delete document ──
     Removes from local state immediately (optimistic),
     then calls the API. If the API fails, the doc is
     restored and an error could be shown (kept simple here). */
  const handleDelete = useCallback(async (id) => {
    /* Optimistic: remove from list immediately */
    const prev = docs;
    setDocs(d => d.filter(doc => doc.id !== id));
    setDeletingId(id);

    try {
      await api.delete(`/documents/${id}`);
    } catch (err) {
      /* Rollback on failure */
      setDocs(prev);
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  }, [docs]);

  /* ── Open document in editor ── */
  const handleOpen = useCallback((id) => {
    navigate(`/editor/${id}`);
  }, [navigate]);

  /* ── Sign out ── */
  function handleSignOut() {
    logout();
    navigate('/', { replace: true });
  }

  /* ─────────────────────────────────────
     Render
  ───────────────────────────────────── */
  return (
    <div className={styles.root}>

      {/* ── Sticky top navigation ── */}
      <TopNav user={user} onSignOut={handleSignOut} />

      <main className={styles.main}>

        {/* ── Welcome banner ── */}
        {user && (
          <WelcomeBanner user={user} docs={docs} />
        )}

        {/* ── Section header: "Documents" title + New button ── */}
        <div className={styles.section_header}>
          <h2 className={styles.section_title}>
            {loading ? 'Loading…' : `Documents`}
          </h2>

          {/* New document button — always visible so user can create mid-load */}
          <button
            className={styles.new_doc_btn}
            onClick={() => setShowModal(true)}
            disabled={loading}
            aria-label="Create new document"
          >
            <PlusIcon />
            New document
          </button>
        </div>

        {/* ── Fetch error state ── */}
        {fetchError && (
          <div className={styles.fetch_error} role="alert">
            {fetchError}
            <button
              className={styles.retry_btn}
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {loading && (
          <div className={styles.grid} aria-busy="true" aria-label="Loading documents">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !fetchError && docs.length === 0 && (
          <EmptyState onCreate={() => setShowModal(true)} />
        )}

        {/* ── Document grid ── */}
        {!loading && docs.length > 0 && (
          <div className={styles.grid} role="list" aria-label="Your documents">
            {docs.map(doc => (
              <DocCard
                key={doc.id}
                doc={doc}
                onOpen={handleOpen}
                onDelete={handleDelete}
                isDeleting={deletingId === doc.id}
              />
            ))}
          </div>
        )}

      </main>

      {/* ── New document modal ── */}
      <NewDocModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreate={handleCreate}
        creating={creating}
      />

    </div>
  );
}
