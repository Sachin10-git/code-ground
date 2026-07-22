/**
 * SnapshotDrawer.jsx — Code Ground version control drawer
 *
 * A slide-out panel for saving and restoring named versions of a
 * document. This is Code Ground's lightweight alternative to git
 * commits — built for quick checkpoints during a pairing session
 * rather than full source control.
 *
 * ── What this component does ────────────────────────────────────────
 *
 *   1. Slides in from the right edge, overlaying part of the editor.
 *   2. Lets the user save the CURRENT editor content as a named
 *      snapshot (e.g. "working version before refactor").
 *   3. Lists all saved snapshots for this document, newest first,
 *      each showing: label, who saved it, relative timestamp,
 *      and a Restore button.
 *   4. Restoring requires an inline confirmation step — restoring
 *      overwrites the LIVE document for every connected user, so
 *      this is a deliberately "two-click" action, never one-click.
 *   5. Closes on: clicking the backdrop, pressing Escape, or the
 *      explicit close button.
 *
 * ── What this component does NOT own ────────────────────────────────
 *
 *   - The API calls (GET/POST snapshots, restore logic) — the parent
 *     (Editor.jsx) owns these and passes data + handlers as props.
 *   - The actual Yjs document — restoring is delegated to onRestore,
 *     which Editor.jsx implements by replacing the Yjs text content.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   open          {boolean}   — whether the drawer is visible
 *   onClose       {Function}  — called to close the drawer
 *
 *   snapshots     {Array}     — list of saved snapshots:
 *                               {
 *                                 id:          string,
 *                                 label:       string,
 *                                 created_by_name: string,
 *                                 created_at:  ISO string,
 *                                 language:    string (optional),
 *                                 content:     string,
 *                               }
 *
 *   loadingList   {boolean}   — true while snapshots are being fetched
 *
 *   onSave        {Function}  — called with (label: string) when the
 *                               user saves a new snapshot. Parent
 *                               handles the POST and updates the list.
 *   saving        {boolean}   — true while a save request is in flight
 *
 *   onRestore     {Function}  — called with (snapshot: Object) after
 *                               the user confirms a restore.
 *   restoringId   {string|null} — id of the snapshot currently being
 *                               restored (shows a spinner on that row)
 *
 *   onDelete      {Function?} — called with (id: string) to delete a
 *                               snapshot. Optional — if omitted, no
 *                               delete button is shown.
 *
 * ── Usage in Editor.jsx ─────────────────────────────────────────────
 *
 *   import SnapshotDrawer from '../components/SnapshotDrawer.jsx';
 *
 *   <SnapshotDrawer
 *     open={showSnapshots}
 *     onClose={() => setShowSnapshots(false)}
 *     snapshots={snapshots}
 *     loadingList={snapshotsLoading}
 *     onSave={handleSaveSnapshot}
 *     saving={savingSnapshot}
 *     onRestore={handleRestoreSnapshot}
 *     restoringId={restoringSnapshotId}
 *     onDelete={handleDeleteSnapshot}
 *   />
 */

import React, { useState, useRef, useEffect } from 'react';
import styles from './SnapshotDrawer.module.css';

/* ─────────────────────────────────────────────────────────────────────
   RELATIVE TIME — "just now" / "5 min ago" / "2 hr ago" / "Jan 14"
   Same hand-rolled implementation used across AIMessage.jsx and
   Dashboard.jsx — kept consistent rather than adding a date-fns dep.
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

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
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
   SAVE FORM — label input + save button at the top of the drawer.
   Extracted as its own component so its local input state doesn't
   cause the (potentially long) snapshot list to re-render on every
   keystroke.
───────────────────────────────────────────────────────────────────── */
function SaveForm({ onSave, saving }) {
  const [label, setLabel] = useState('');
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || saving) return;
    onSave(trimmed);
    setLabel('');
  }

  return (
    <form className={styles.save_form} onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        className={styles.save_input}
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="e.g. working version before refactor"
        maxLength={80}
        disabled={saving}
        aria-label="Snapshot label"
      />
      <button
        type="submit"
        className={styles.save_btn}
        disabled={saving || !label.trim()}
        aria-busy={saving}
      >
        {saving ? <Spinner size={13} /> : <CameraIcon />}
        Save
      </button>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SNAPSHOT ROW — one item in the list.
   Handles its own inline restore-confirmation state, the same
   pattern used for delete confirmation on Dashboard's DocCard.
───────────────────────────────────────────────────────────────────── */
function SnapshotRow({ snapshot, isRestoring, onRestore, onDelete }) {
  /* 'idle' | 'confirm-restore' | 'confirm-delete' */
  const [mode, setMode] = useState('idle');

  function handleRestoreClick() {
    setMode('confirm-restore');
  }
  function handleDeleteClick() {
    setMode('confirm-delete');
  }
  function handleCancel() {
    setMode('idle');
  }
  function handleConfirmRestore() {
    onRestore(snapshot);
    /* Don't reset mode — row stays in confirm state until the
       restoringId prop clears, showing the spinner throughout. */
  }
  function handleConfirmDelete() {
    onDelete(snapshot.id);
  }

  return (
    <li className={styles.row}>

      {/* ── Default view: label + meta + action buttons ── */}
      {mode === 'idle' && (
        <>
          <div className={styles.row_main}>
            <p className={styles.row_label}>{snapshot.label}</p>
            <div className={styles.row_meta}>
              <span className={styles.meta_item}>
                {snapshot.created_by_name || 'Unknown'}
              </span>
              <span className={styles.meta_dot} aria-hidden="true">·</span>
              <span className={styles.meta_item}>
                <ClockIcon />
                {relativeTime(snapshot.created_at)}
              </span>
            </div>
          </div>

          <div className={styles.row_actions}>
            <button
              className={styles.restore_btn}
              onClick={handleRestoreClick}
              disabled={isRestoring}
              aria-label={`Restore snapshot: ${snapshot.label}`}
            >
              {isRestoring ? <Spinner size={12} /> : <RestoreIcon />}
              Restore
            </button>

            {onDelete && (
              <button
                className={styles.delete_icon_btn}
                onClick={handleDeleteClick}
                disabled={isRestoring}
                aria-label={`Delete snapshot: ${snapshot.label}`}
                title="Delete"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Restore confirmation ── */}
      {mode === 'confirm-restore' && (
        <div className={styles.confirm_bar}>
          <span className={styles.confirm_text}>
            Overwrite the live document for everyone?
          </span>
          <div className={styles.confirm_actions}>
            <button
              className={styles.confirm_yes}
              onClick={handleConfirmRestore}
              disabled={isRestoring}
            >
              {isRestoring ? <Spinner size={12} /> : 'Restore'}
            </button>
            <button
              className={styles.confirm_no}
              onClick={handleCancel}
              disabled={isRestoring}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ── */}
      {mode === 'confirm-delete' && (
        <div className={styles.confirm_bar}>
          <span className={styles.confirm_text}>
            Delete "{snapshot.label}" permanently?
          </span>
          <div className={styles.confirm_actions}>
            <button className={styles.confirm_yes_danger} onClick={handleConfirmDelete}>
              Delete
            </button>
            <button className={styles.confirm_no} onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE — shown when there are no snapshots yet.
───────────────────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.empty_icon} aria-hidden="true">
        <CameraIcon />
      </div>
      <p className={styles.empty_heading}>No snapshots yet</p>
      <p className={styles.empty_sub}>
        Save a named version above to create your first checkpoint.
        You can restore it any time, even after big changes.
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
  onDelete,
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

        {/* Save form — always visible at the top */}
        <SaveForm onSave={onSave} saving={saving} />

        {/* Divider with count */}
        <div className={styles.list_header}>
          <span className={styles.list_count}>
            {loadingList
              ? 'Loading…'
              : `${snapshots.length} saved ${snapshots.length === 1 ? 'version' : 'versions'}`}
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
                  onRestore={onRestore}
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
