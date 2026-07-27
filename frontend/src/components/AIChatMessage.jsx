/**
 * AIChatMessage.jsx — Code Ground AI chat single message bubble
 * (Phase 6.1 — AI Foundation)
 *
 * Renders one message in the AI conversation:
 *   - user messages: plain text, never Markdown-parsed (matches how a
 *     developer's own typed question is shown — only the AI's answer
 *     gets formatted).
 *   - assistant messages: rendered via the shared MarkdownLite
 *     component (also used by TeamChatMessage.jsx), so headings,
 *     lists, tables, and fenced code blocks with syntax highlighting +
 *     copy button all work the same way in both chat surfaces.
 *   - a failed assistant message (msg.error set) renders a clear error
 *     line with a Retry button instead of content.
 *
 * There is no streaming/incomplete state to handle — the backend
 * returns one complete response per request (see useAI.js), so unlike
 * the old AIMessage.jsx there's no mid-token cursor rendering here.
 */

import React, { memo, useState } from 'react';
import MarkdownLite from './markdown/MarkdownLite.jsx';
import styles from './AIChatMessage.module.css';

/* Display text for the action badge (Phase 6.2 Explain, Phase 6.3
   Review, ...) — keyed by the same action string useAI.js tags
   messages with, so a new action just needs an entry here. */
const ACTION_BADGE_LABEL = {
  explain:  'Explain',
  review:   'Review',
  refactor: 'Refactor',
  generate: 'Generate',
};

/* ─────────────────────────────────────────────────────────────────────
   AVATAR COLOR — same deterministic hash used across the app.
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
   RELATIVE TIME
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
   ICONS
───────────────────────────────────────────────────────────────────── */
const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const RetryIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const WarningIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

function CopyButton({ text, label, className }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button type="button" className={className} onClick={handleCopy} aria-label={label}>
      <CopyIcon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   AI CHAT MESSAGE — the exported component, wrapped in memo().
───────────────────────────────────────────────────────────────────── */
const AIChatMessage = memo(function AIChatMessage({ msg, onRetry }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`${styles.msg} ${isUser ? styles.msg_user : styles.msg_ai}`}>
      <div
        className={styles.msg_avatar}
        aria-hidden="true"
        style={isUser ? { background: avatarColor(msg.username || 'u') } : {}}
      >
        {isUser
          ? (msg.username?.[0]?.toUpperCase() ?? 'U')
          : <span className={styles.ai_logo_mark}>&lt;CG/&gt;</span>
        }
      </div>

      <div className={styles.msg_body}>
        <div className={styles.msg_meta}>
          <span className={styles.msg_label}>
            {isUser ? (msg.username || 'You') : 'Code Ground AI'}
          </span>
          {msg.action && (
            <span className={styles.action_badge}>{ACTION_BADGE_LABEL[msg.action] || msg.action}</span>
          )}
          {msg.timestamp && (
            <time
              className={styles.msg_time}
              dateTime={msg.timestamp}
              title={new Date(msg.timestamp).toLocaleString()}
            >
              {relativeTime(msg.timestamp)}
            </time>
          )}
        </div>

        {isUser ? (
          <p className={styles.msg_text}>{msg.content}</p>

        ) : msg.error ? (
          <div className={styles.error_box} role="alert">
            <WarningIcon />
            <span>{msg.error}</span>
            <button
              type="button"
              className={styles.retry_btn}
              onClick={() => onRetry?.(msg.id)}
              aria-label="Retry this request"
            >
              <RetryIcon /> Retry
            </button>
          </div>

        ) : msg.streaming ? (
          <div className={styles.thinking_dots} aria-label="AI is thinking">
            <span /><span /><span />
          </div>

        ) : (
          <>
            <div className={styles.msg_content}>
              <MarkdownLite text={msg.content} />
            </div>
            {msg.content && (
              <CopyButton
                text={msg.content}
                label="Copy full response"
                className={styles.msg_copy}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default AIChatMessage;
