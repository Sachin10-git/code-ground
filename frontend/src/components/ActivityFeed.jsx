/**
 * ActivityFeed.jsx — Phase 6.3: live workspace activity panel
 *
 * Purely presentational — renders whatever `activity` array it's
 * given, newest entry first. All the real work (subscribing to the
 * Phase 6.1 workspace socket events, building entries, capping the
 * list at 100) lives in useWorkspaceSync.js; this component owns no
 * state of its own besides local formatting helpers, and is rendered
 * by FileExplorer.jsx as a dedicated panel below the file tree.
 */

import React from 'react';
import styles from './ActivityFeed.module.css';

/* ─────────────────────────────────────────────────────────────────────
   ICONS — one per operation, same inline-SVG style as FileExplorer.jsx.
   Kept local rather than imported from there since these are a
   different, operation-keyed set (create/rename/move/delete) rather
   than FileExplorer's file/folder/action icons.
───────────────────────────────────────────────────────────────────── */
const PlusIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);
const MoveIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 5 15 12 9 19" />
  </svg>
);
const TrashIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

const OPERATION_META = {
  created: { label: 'created', color: '#34D399', Icon: PlusIcon },
  renamed: { label: 'renamed', color: '#3B82F6', Icon: PencilIcon },
  moved:   { label: 'moved',   color: '#F59E0B', Icon: MoveIcon },
  deleted: { label: 'deleted', color: '#F87171', Icon: TrashIcon },
};

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/* Enhancement 1 — a rename entry with both names recorded renders as
   "oldName → newName"; anything else (including a rename entry from
   before this field existed) falls back to the plain target name. */
function isRenameWithNames(entry) {
  return entry.operation === 'renamed' && entry.oldName && entry.newName;
}

function targetSummary(entry) {
  return isRenameWithNames(entry) ? `${entry.oldName} → ${entry.newName}` : entry.name;
}

export default function ActivityFeed({ activity = [] }) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.header_title}>Activity</span>
      </div>

      <div className={styles.list}>
        {activity.length === 0 && (
          <div className={styles.empty}>No recent activity.</div>
        )}

        {activity.map(entry => {
          const meta = OPERATION_META[entry.operation];
          if (!meta) return null;
          const { Icon } = meta;

          return (
            <div className={styles.entry} key={entry.id}>
              <span className={styles.entry_icon} style={{ color: meta.color }}>
                <Icon />
              </span>
              <div className={styles.entry_body}>
                <span className={styles.entry_text} title={`${entry.username} ${meta.label} ${entry.type} ${targetSummary(entry)}`}>
                  <span className={styles.entry_user}>{entry.username}</span>
                  {' '}{meta.label} {entry.type}{' '}
                  {isRenameWithNames(entry) ? (
                    <>
                      <span className={styles.entry_name}>{entry.oldName}</span>
                      <span className={styles.entry_arrow} aria-hidden="true"> → </span>
                      <span className={styles.entry_name}>{entry.newName}</span>
                    </>
                  ) : (
                    <span className={styles.entry_name}>{entry.name}</span>
                  )}
                </span>
                <span className={styles.entry_time}>{formatTime(entry.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
