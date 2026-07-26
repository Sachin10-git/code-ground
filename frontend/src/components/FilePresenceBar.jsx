/**
 * FilePresenceBar.jsx — Phase 6.4: per-file presence, Editor UI
 *
 * A small strip above the Monaco editor showing which OTHER
 * collaborators currently have the open file present — "viewing" or
 * "editing" — sourced from useFilePresence.js's `filePresence` map,
 * scoped by Editor.jsx to just the currently-open file's entry before
 * it reaches this component. Purely presentational; the current user
 * is never in this data in the first place (the backend excludes the
 * sender — see filePresenceManager.js), so there's no self-filtering
 * to do here.
 */

import React from 'react';
import styles from './FilePresenceBar.module.css';

function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/* Splits the per-file presence map into an "editing" line and a
   "viewing" line (a collaborator only ever appears in one — whichever
   `state` their most recent announcement carried). */
function buildParts(presence) {
  const editing = [];
  const viewing = [];

  for (const entry of Object.values(presence)) {
    if (!entry?.username) continue;
    (entry.state === 'editing' ? editing : viewing).push(entry.username);
  }

  const parts = [];
  if (editing.length > 0) {
    parts.push({
      key: 'editing',
      icon: '✏️',
      text: `${joinNames(editing)} ${editing.length === 1 ? 'is' : 'are'} editing this file`,
    });
  }
  if (viewing.length > 0) {
    parts.push({
      key: 'viewing',
      icon: '👁️',
      text: `${joinNames(viewing)} ${viewing.length === 1 ? 'is' : 'are'} viewing this file`,
    });
  }
  return parts;
}

export default function FilePresenceBar({ presence }) {
  const parts = buildParts(presence || {});
  if (parts.length === 0) return null;

  return (
    <div className={styles.root} role="status">
      {parts.map((part, i) => (
        <span className={styles.part} key={part.key}>
          {i > 0 && <span className={styles.sep} aria-hidden="true">•</span>}
          <span aria-hidden="true">{part.icon}</span>
          {part.text}
        </span>
      ))}
    </div>
  );
}
