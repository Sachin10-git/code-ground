/**
 * Presence.jsx — Code Ground live activity bar
 *
 * Shows who is currently in the session as a stack of overlapping
 * coloured avatar circles — the familiar "Google Docs / Figma" pattern.
 *
 * ── What this component does ────────────────────────────────────────
 *
 *   1. Renders the current user first, then each peer, as overlapping
 *      circles with their initial and a colour unique to their username.
 *   2. Shows a small pulsing ring on an avatar when that person is
 *      ACTIVELY EDITING right now (within the last few seconds).
 *   3. If there are more people than fit, collapses the rest into a
 *      "+N" circle.
 *   4. Clicking the avatar stack (or the +N circle) opens a dropdown
 *      listing EVERYONE in the session with their name and status —
 *      closes on outside click or Escape.
 *   5. Hovering any individual avatar shows a small tooltip with
 *      their full name.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   currentUser  {Object}   — { username: string }
 *                             Always rendered first, labelled "You".
 *
 *   peers        {Array}    — other people in the session. Each peer:
 *                             {
 *                               userId:     string,
 *                               name:       string,
 *                               color:      string (hex, optional —
 *                                           derived from name if absent),
 *                               active:     boolean (optional) —
 *                                           true if this person edited
 *                                           very recently. Shows a
 *                                           pulsing ring when true.
 *                             }
 *
 *   maxVisible   {number}   — how many avatars to show before
 *                             collapsing into "+N" (default: 4)
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   import Presence from '../components/Presence.jsx';
 *
 *   <Presence
 *     currentUser={user}
 *     peers={peers}
 *     maxVisible={4}
 *   />
 *
 * ── Notes for integration ───────────────────────────────────────────
 *
 *   This is a drop-in replacement for the inline <PresenceChips>
 *   in Editor.jsx. The `active` field is optional — if Editor doesn't
 *   track per-user typing activity yet, simply omit it and no pulsing
 *   ring will be shown. To wire it up later: in the Yjs awareness
 *   `change` handler, set a `lastEditAt` timestamp on each peer's
 *   awareness state, and pass `active: Date.now() - lastEditAt < 3000`.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './Presence.module.css';

/* ─────────────────────────────────────────────────────────────────────
   AVATAR COLOR — deterministic colour from a username string.
   Same algorithm used across Editor.jsx, Dashboard.jsx, AIMessage.jsx
   so a given user always gets the same colour everywhere in the app.
───────────────────────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  '#3B82F6', '#22D3EE', '#34D399', '#F59E0B',
  '#EC4899', '#8B5CF6', '#F87171', '#60A5FA',
];

function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────── */

/* Small chevron used on the dropdown trigger when more than maxVisible */
const ChevronDownIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   AVATAR — a single circle: coloured background, initial letter,
   optional pulsing "active" ring, optional "You" indicator.

   Rendered both in the overlapping stack AND inside the dropdown list,
   so it's a small reusable sub-component within this file.
───────────────────────────────────────────────────────────────────── */
function Avatar({ name, color, active, self, size = 'md' }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';

  return (
    <div
      className={`${styles.avatar} ${styles[`avatar_${size}`]} ${active ? styles.avatar_active : ''}`}
      style={{ '--ac': color }}
      /* Tooltip shows full name (+ "you" if self) on hover */
      data-tooltip={self ? `${name} (you)` : name}
    >
      {/* Pulsing ring — only rendered when actively editing.
          Separate element so the ring can animate independently
          of the avatar circle itself (avoids resizing the circle). */}
      {active && <span className={styles.active_ring} aria-hidden="true" />}

      <span className={styles.avatar_initial}>{initial}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   DROPDOWN — full list of everyone in the session.
   Opened by clicking the avatar stack. Closes on outside click,
   Escape key, or selecting nothing (it's informational, no action).
───────────────────────────────────────────────────────────────────── */
function PresenceDropdown({ people, onClose }) {
  const ref = useRef(null);

  /* Close on outside click */
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    /* Listen on the next tick — avoids closing immediately from the
       same click that opened it (the trigger's onClick fires first,
       then this listener would fire on the same event otherwise). */
    const id = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  /* Close on Escape */
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div ref={ref} className={styles.dropdown} role="menu" aria-label="People in this session">
      <div className={styles.dropdown_header}>
        {people.length} {people.length === 1 ? 'person' : 'people'} here
      </div>

      <ul className={styles.dropdown_list}>
        {people.map(p => (
          <li key={p.userId} className={styles.dropdown_item} role="menuitem">
            <Avatar name={p.name} color={p.color} active={p.active} self={p.self} size="sm" />
            <span className={styles.dropdown_name}>
              {p.name}
              {p.self && <span className={styles.you_tag}>you</span>}
            </span>
            {/* Status text: "editing" if active, otherwise "viewing" */}
            <span className={`${styles.status_text} ${p.active ? styles.status_active : ''}`}>
              {p.active ? 'editing' : 'viewing'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   PRESENCE — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function Presence({ currentUser, peers = [], maxVisible = 4 }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  /*
   * Build the unified list: current user first (marked `self`),
   * then peers. Each entry gets a colour — either provided by the
   * peer object (from Yjs awareness) or derived deterministically
   * from their name.
   */
  const all = [
    {
      userId: currentUser?.id ?? 'self',
      name:   currentUser?.username,
      color:  currentUser?.avatar_color || avatarColor(currentUser?.username ?? ''),
      self:   true,
      active: false, /* we don't show a ring on our own avatar */
    },
    ...peers.map(p => ({
      userId: p.userId,
      name:   p.name,
      color:  p.color || avatarColor(p.name ?? ''),
      self:   false,
      active: !!p.active,
    })),
  ].filter(p => p.name); /* drop entries with no name (not yet initialised) */

  /* Nothing to show — e.g. user object not loaded yet */
  if (all.length === 0) return null;

  const visible  = all.slice(0, maxVisible);
  const overflow = all.length - visible.length;

  const toggleDropdown = useCallback(() => setDropdownOpen(o => !o), []);

  return (
    <div className={styles.root} aria-label="People in this session">

      {/* ── Avatar stack — clickable, opens dropdown ── */}
      <button
        className={styles.stack}
        onClick={toggleDropdown}
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
        aria-label={`${all.length} ${all.length === 1 ? 'person' : 'people'} in this session. Click to see who.`}
      >
        {visible.map((p, i) => (
          /*
           * Overlapping effect: each avatar after the first gets a
           * negative left margin so it tucks behind the previous one.
           * z-index increases left-to-right so earlier avatars sit
           * on top — matches the natural reading order.
           */
          <div
            key={p.userId}
            className={styles.stack_item}
            style={{ zIndex: visible.length - i, marginLeft: i === 0 ? 0 : -8 }}
          >
            <Avatar name={p.name} color={p.color} active={p.active} self={p.self} size="md" />
          </div>
        ))}

        {/* "+N" overflow circle — same overlap treatment */}
        {overflow > 0 && (
          <div
            className={styles.stack_item}
            style={{ zIndex: 0, marginLeft: -8 }}
          >
            <div className={`${styles.avatar} ${styles.avatar_md} ${styles.avatar_overflow}`}>
              +{overflow}
            </div>
          </div>
        )}

        {/* Chevron — hints that this is clickable / expandable */}
        <span className={styles.chevron} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {/* ── Dropdown — full list, shown on click ── */}
      {dropdownOpen && (
        <PresenceDropdown people={all} onClose={() => setDropdownOpen(false)} />
      )}

    </div>
  );
}
