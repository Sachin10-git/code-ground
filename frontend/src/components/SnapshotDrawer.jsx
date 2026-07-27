/**
 * SnapshotDrawer.jsx — Code Ground project Snapshots panel (Phase 6.7)
 *
 * A slide-out panel for saving and restoring named checkpoints of the
 * WHOLE project — every file, every folder, at a point in time (not
 * just the currently open file/document, which is what this component
 * did before Phase 6.7 — see snapshotService.js on the backend for
 * what actually gets captured).
 *
 * ── What this component does ────────────────────────────────────────
 *
 *   1. Slides in from the right edge, overlaying part of the editor.
 *   2. Lets the user save the CURRENT project state as a named
 *      snapshot (name is optional — a blank one falls back to a
 *      generated label for display).
 *   3. Lists all saved snapshots for this project, newest first, each
 *      showing: name, creator, relative + absolute timestamp, total
 *      files captured, and how many of those files differ from the
 *      project's current content.
 *   4. Restoring and deleting both require an inline confirmation step
 *      — restoring overwrites the LIVE project for every connected
 *      collaborator, so this is deliberately "two-click", never
 *      one-click. Renaming is a lighter-weight inline edit with no
 *      confirmation step, matching FileExplorer's rename UX.
 *   5. Surfaces a dismissible error banner for a failed action (the
 *      "success/error feedback" requirement) — no new toast/
 *      notification system, just the same inline-banner convention
 *      Editor.jsx already uses for save/workspace errors.
 *   6. Closes on: clicking the backdrop, pressing Escape, or the
 *      explicit close button.
 *
 * ── What this component does NOT own ────────────────────────────────
 *
 *   - The API calls (GET/POST/PATCH/DELETE snapshots) — the parent
 *     (Editor.jsx) owns these and passes data + handlers as props.
 *   - Collaboration/Yjs sync on restore — entirely a backend concern
 *     (snapshotService.js) plus the existing useYjs.js FILE_UPDATED
 *     handler; this component just fires the restore request.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   open          {boolean}   — whether the drawer is visible
 *   onClose       {Function}  — called to close the drawer
 *
 *   snapshots     {Array}     — list of saved snapshots:
 *                               {
 *                                 id:                string,
 *                                 name:               string,
 *                                 createdByUsername:  string,
 *                                 createdAt:          ISO string,
 *                                 fileCount:          number,
 *                                 changedFiles:       number,
 *                               }
 *
 *   loadingList   {boolean}   — true while snapshots are being fetched
 *
 *   onSave        {Function}  — called with (name: string) — may be ''
 *   saving        {boolean}
 *
 *   onRestore     {Function}  — called with (snapshot: Object) after confirm
 *   restoringId   {string|null}
 *
 *   onRename      {Function}  — called with (id: string, name: string)
 *   renamingId    {string|null} — id currently being renamed (in flight)
 *
 *   onDelete      {Function}  — called with (id: string) after confirm
 *   deletingId    {string|null}
 *
 *   error         {string}    — last action's error message, if any
 *   onDismissError {Function?}
 */

import React, { useState, useRef, useEffect } from 'react';
import styles from './SnapshotDrawer.module.css';

/* ─────────────────────────────────────────────────────────────────────
   RELATIVE TIME — "just now" / "5 min ago" / "2 hr ago" / "Jan 14"
───────────────────────────────────────────────────────────────────── */
function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 10)    return 'just now';
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function absoluteTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function displayName(snapshot) {
  return snapshot.name?.trim() || `Snapshot – ${absoluteTime(snapshot.createdAt)}`;
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, inherit currentColor
───────────────────────────────────────────────────────────────────── */

const CameraIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const WarningIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/* Spinner — spinning arc */
const Spinner = ({ size = 13 }) => (
  <svg className={styles.spinner} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   ERROR BANNER — dismissible, top of drawer. Same inline-banner
   convention Editor.jsx already uses for saveError/workspaceNotice —
   not a new toast/notification system.
───────────────────────────────────────────────────────────────────── */
function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className={styles.error_banner} role="alert">
      <WarningIcon />
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          className={styles.error_dismiss_btn}
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SAVE FORM — optional-name input + save button at the top of the
   drawer. Extracted as its own component so its local input state
   doesn't cause the (potentially long) snapshot list to re-render on
   every keystroke.
───────────────────────────────────────────────────────────────────── */
function SaveForm({ onSave, saving }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    onSave(name.trim());
    setName('');
  }

  return (
    <form className={styles.save_form} onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        className={styles.save_input}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Snapshot name (optional) — e.g. Before Refactor"
        maxLength={100}
        disabled={saving}
        aria-label="Snapshot name"
      />
      <button
        type="submit"
        className={styles.save_btn}
        disabled={saving}
        aria-busy={saving}
      >
        {saving ? <Spinner size={13} /> : <CameraIcon />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SNAPSHOT ROW — one item in the list.
───────────────────────────────────────────────────────────────────── */
function SnapshotRow({ snapshot, isRestoring, isDeleting, isRenaming, onRestore, onRename, onDelete }) {
  /* 'idle' | 'renaming' | 'confirm-restore' | 'confirm-delete' */
  const [mode, setMode] = useState('idle');
  const [nameDraft, setNameDraft] = useState('');
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (mode === 'renaming') {
      setNameDraft(snapshot.name || '');
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [mode, snapshot.name]);

  /* isRenaming goes true -> false once the request settles (success OR
     failure — a failure's error is surfaced by the drawer-level banner,
     and the user can just click Rename again). Either way the inline
     form has done its job, so return to the idle row rather than
     leaving a submitted form sitting open with nothing left to do. */
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming) setMode('idle');
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  function handleRenameSubmit(e) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    onRename(snapshot.id, trimmed);
  }

  const busy = isRestoring || isDeleting || isRenaming;

  return (
    <li className={styles.row}>

      {mode === 'idle' && (
        <>
          <div className={styles.row_main}>
            <p className={styles.row_label} title={displayName(snapshot)}>
              {displayName(snapshot)}
            </p>
            <div className={styles.row_meta}>
              <span className={styles.meta_item}>{snapshot.createdByUsername || 'Unknown'}</span>
              <span className={styles.meta_dot} aria-hidden="true">·</span>
              <span className={styles.meta_item} title={absoluteTime(snapshot.createdAt)}>
                <ClockIcon />
                {relativeTime(snapshot.createdAt)}
              </span>
            </div>
            <div className={styles.meta_pills}>
              <span className={styles.meta_pill}>
                {snapshot.fileCount ?? 0} {snapshot.fileCount === 1 ? 'file' : 'files'}
              </span>
              {typeof snapshot.changedFiles === 'number' && snapshot.changedFiles > 0 && (
                <span className={`${styles.meta_pill} ${styles.meta_pill_changed}`}>
                  {snapshot.changedFiles} changed
                </span>
              )}
            </div>
          </div>

          <div className={styles.row_actions}>
            <button
              className={styles.restore_btn}
              onClick={() => setMode('confirm-restore')}
              disabled={busy}
              aria-label={`Restore snapshot: ${displayName(snapshot)}`}
            >
              {isRestoring ? <Spinner size={12} /> : <RestoreIcon />}
              Restore
            </button>
            <button
              className={styles.delete_icon_btn}
              onClick={() => setMode('renaming')}
              disabled={busy}
              aria-label={`Rename snapshot: ${displayName(snapshot)}`}
              title="Rename"
            >
              {isRenaming ? <Spinner size={12} /> : <PencilIcon />}
            </button>
            <button
              className={styles.delete_icon_btn}
              onClick={() => setMode('confirm-delete')}
              disabled={busy}
              aria-label={`Delete snapshot: ${displayName(snapshot)}`}
              title="Delete"
            >
              {isDeleting ? <Spinner size={12} /> : <TrashIcon />}
            </button>
          </div>
        </>
      )}

      {mode === 'renaming' && (
        <form className={styles.rename_form} onSubmit={handleRenameSubmit}>
          <input
            ref={renameInputRef}
            className={styles.save_input}
            type="text"
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setMode('idle'); }}
            maxLength={100}
            disabled={isRenaming}
            aria-label="Snapshot name"
          />
          <button type="submit" className={styles.confirm_yes} disabled={isRenaming}>
            {isRenaming ? <Spinner size={12} /> : 'Save'}
          </button>
          <button type="button" className={styles.confirm_no} onClick={() => setMode('idle')} disabled={isRenaming}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'confirm-restore' && (
        <div className={styles.confirm_bar}>
          <span className={styles.confirm_text}>
            Overwrite the live project for everyone?
          </span>
          <div className={styles.confirm_actions}>
            <button className={styles.confirm_yes} onClick={() => onRestore(snapshot)} disabled={isRestoring}>
              {isRestoring ? <Spinner size={12} /> : 'Restore'}
            </button>
            <button className={styles.confirm_no} onClick={() => setMode('idle')} disabled={isRestoring}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className={styles.confirm_bar}>
          <span className={styles.confirm_text}>
            Delete "{displayName(snapshot)}" permanently?
          </span>
          <div className={styles.confirm_actions}>
            <button className={styles.confirm_yes_danger} onClick={() => onDelete(snapshot.id)} disabled={isDeleting}>
              {isDeleting ? <Spinner size={12} /> : 'Delete'}
            </button>
            <button className={styles.confirm_no} onClick={() => setMode('idle')} disabled={isDeleting}>
              Cancel
            </button>
          </div>
        </div>
      )}

    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE
───────────────────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.empty_icon} aria-hidden="true">
        <CameraIcon />
      </div>
      <p className={styles.empty_heading}>No snapshots yet</p>
      <p className={styles.empty_sub}>
        Save a checkpoint of the whole project above. You can restore
        it any time, even after big changes — every file and folder is
        captured.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   LOADING STATE — three skeleton rows while the list is fetching.
───────────────────────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <li className={styles.skeleton_row} aria-hidden="true">
      <div className={styles.sk_label} />
      <div className={styles.sk_meta} />
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SNAPSHOT DRAWER — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function SnapshotDrawer({
  open,
  onClose,
  snapshots    = [],
  loadingList  = false,
  onSave,
  saving       = false,
  onRestore,
  restoringId  = null,
  onRename,
  renamingId   = null,
  onDelete,
  deletingId   = null,
  error        = '',
  onDismissError,
}) {
  const drawerRef = useRef(null);

  /* Close on Escape key */
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  /* Don't render to the DOM at all when closed —
     keeps the component out of the accessibility tree
     and avoids any layout cost when not in use. */
  if (!open) return null;

  return (
    <>
      {/* ── Backdrop ──
          Click anywhere outside the drawer to close it.
          Semi-transparent so the editor remains visible behind it,
          reinforcing that this is a panel ON TOP of the workspace,
          not a full navigation away from it. */}
      <div
        className={styles.backdrop}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Drawer panel ── */}
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snapshot-drawer-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 id="snapshot-drawer-title" className={styles.title}>
            <CameraIcon />
            Snapshots
          </h2>
          <button
            className={styles.close_btn}
            onClick={onClose}
            aria-label="Close snapshots panel"
          >
            <CloseIcon />
          </button>
        </div>

        <ErrorBanner message={error} onDismiss={onDismissError} />

        {/* Save form — always visible at the top */}
        <SaveForm onSave={onSave} saving={saving} />

        {/* Divider with count */}
        <div className={styles.list_header}>
          <span className={styles.list_count}>
            {loadingList
              ? 'Loading…'
              : `${snapshots.length} saved ${snapshots.length === 1 ? 'snapshot' : 'snapshots'}`}
          </span>
        </div>

        {/* Scrollable list */}
        <div className={styles.list_wrap}>
          {loadingList ? (
            <ul className={styles.list}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </ul>
          ) : snapshots.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className={styles.list}>
              {snapshots.map(snap => (
                <SnapshotRow
                  key={snap.id}
                  snapshot={snap}
                  isRestoring={restoringId === snap.id}
                  isDeleting={deletingId === snap.id}
                  isRenaming={renamingId === snap.id}
                  onRestore={onRestore}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </div>

      </aside>
    </>
  );
}
