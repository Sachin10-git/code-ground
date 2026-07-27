/**
 * TeamChatMessage.jsx — Code Ground Team Chat single message bubble
 *
 * Renders one persisted chat message: avatar, username, relative
 * timestamp, and the message body. Markdown/code-block rendering is
 * delegated to the shared MarkdownLite component (also used by
 * AIChatMessage.jsx) so both chat surfaces render Markdown identically.
 */

import React, { memo } from 'react';
import MarkdownLite from './markdown/MarkdownLite.jsx';
import styles from './TeamChatMessage.module.css';

/* ─────────────────────────────────────────────────────────────────────
   AVATAR COLOR — same deterministic hash used across the app
   (AIChatMessage.jsx, Dashboard.jsx, Editor.jsx) so a given user always
   gets the same colour everywhere.
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
   RELATIVE TIME — "just now" / "2 min ago" / "1 hr ago" / "Jan 14"
───────────────────────────────────────────────────────────────────── */
function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 10)    return 'just now';
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─────────────────────────────────────────────────────────────────────
   TEAM CHAT MESSAGE — the exported component, wrapped in memo().
───────────────────────────────────────────────────────────────────── */
const TeamChatMessage = memo(function TeamChatMessage({ msg, isOwn }) {
  return (
    <div className={`${styles.msg} ${isOwn ? styles.msg_own : styles.msg_other}`}>
      <div
        className={styles.msg_avatar}
        aria-hidden="true"
        style={{ background: avatarColor(msg.username || 'u') }}
      >
        {msg.username?.[0]?.toUpperCase() ?? 'U'}
      </div>

      <div className={styles.msg_body}>
        <div className={styles.msg_meta}>
          <span className={styles.msg_username}>{isOwn ? 'You' : (msg.username || 'Unknown')}</span>
          {msg.createdAt && (
            <time
              className={styles.msg_time}
              dateTime={msg.createdAt}
              title={new Date(msg.createdAt).toLocaleString()}
            >
              {relativeTime(msg.createdAt)}
            </time>
          )}
        </div>

        <div className={styles.msg_content}>
          <MarkdownLite text={msg.message} />
        </div>
      </div>
    </div>
  );
});

export default TeamChatMessage;
