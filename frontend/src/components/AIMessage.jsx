/**
 * AIMessage.jsx — Code Ground single chat message bubble
 *
 * Extracted from AISidebar.jsx so the message-rendering logic
 * (parsing, code blocks, streaming display) lives in one focused
 * file and can be reused or tested independently.
 *
 * ── What this component does ────────────────────────────────────────
 *
 *   1. Renders one message — either from a user or from the AI.
 *   2. For AI messages, parses the content into segments:
 *        - plain text segments
 *        - fenced code blocks (```lang ... ```)
 *      and renders each segment appropriately.
 *   3. THE KEY FEATURE — handles content that is STILL STREAMING:
 *        - If the AI is mid-way through writing a code block
 *          (an opening ``` has arrived but the closing ``` hasn't yet),
 *          the partial block is rendered as an in-progress code block
 *          with a "writing…" label and a blinking cursor INSIDE it —
 *          instead of showing raw, ugly backtick characters to the user.
 *        - If the AI is streaming plain text, a blinking cursor (▋)
 *          sits at the very end of the visible text.
 *   4. Shows a relative timestamp ("2 min ago") next to the sender name.
 *   5. Lets the user copy a code block, or the entire message, with
 *      one click — both show a temporary "Copied!" confirmation.
 *
 * ── Why this matters for "tokens arriving dynamically" ──────────────
 *
 *   The parent (AISidebar / Editor) appends raw text chunks to
 *   `msg.content` as they arrive over SSE. Each time `content` changes,
 *   THIS component re-parses it and re-renders. Because the component
 *   is wrapped in React.memo, it only re-renders when ITS OWN msg prop
 *   changes — so only the currently-streaming message re-renders on
 *   every token, while all previous messages stay static.
 *
 * ── Props ────────────────────────────────────────────────────────────
 *
 *   msg  {Object}  — {
 *     id:        string | number,
 *     role:      'user' | 'assistant',
 *     content:   string,            // grows over time while streaming
 *     username:  string,            // for user messages
 *     streaming: boolean,           // true while SSE is still open
 *     timestamp: string (ISO),      // optional
 *   }
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   import AIMessage from './AIMessage.jsx';
 *
 *   {messages.map(msg => <AIMessage key={msg.id} msg={msg} />)}
 */

import React, { useState, memo } from 'react';
import styles from './AIMessage.module.css';

/* ─────────────────────────────────────────────────────────────────────
   AVATAR COLOR — deterministic colour from a username string.
   Same algorithm used across Editor.jsx, Dashboard.jsx, AISidebar.jsx
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
   RELATIVE TIME — "just now" / "2 min ago" / "1 hr ago" / "Jan 14"
   Rolled by hand to avoid a date-fns dependency for one function.
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
   PARSE CONTENT — the core of "dynamic token rendering".

   Splits an AI response string into an ordered array of segments:
     { type: 'text', content }
     { type: 'code', lang, content, incomplete }

   Behaviour while `streaming` is true:
     If the text ends with an OPEN fence — i.e. it contains a ``` that
     has not been closed by a matching ``` yet — that trailing portion
     is treated as an in-progress code block (`incomplete: true`)
     rather than left as raw text containing literal backticks.

   This means as tokens stream in:
     "Here's the fix:\n\n```js\nconst x"
   renders as:
     text:  "Here's the fix:\n\n"
     code:  { lang: 'js', content: 'const x', incomplete: true }
   and a cursor blinks INSIDE the code block, not after stray backticks.

   Once the closing ``` arrives, the same block becomes a normal,
   completed code segment with a Copy button.
───────────────────────────────────────────────────────────────────── */
function parseContent(text, streaming = false) {
  if (!text) return [];

  const segments = [];
  /* Matches complete fenced blocks: ```lang\n...content...``` */
  const FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = FENCE_RE.exec(text)) !== null) {
    /* Text before this code block */
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    /* The completed code block */
    segments.push({
      type:       'code',
      lang:       match[1] || 'plaintext',
      content:    match[2].replace(/\n$/, ''), /* trim one trailing newline */
      incomplete: false,
    });
    lastIndex = match.index + match[0].length;
  }

  /* Whatever is left after the last complete fence (if any) */
  const remainder = text.slice(lastIndex);

  if (remainder) {
    /* Look for an OPEN fence at the end of the remainder:
       ``` followed by an optional language and then content
       with no closing ``` yet. */
    const openFence = remainder.match(/```(\w*)\n?([\s\S]*)$/);

    if (streaming && openFence) {
      /* Text before the open fence renders normally */
      const before = remainder.slice(0, openFence.index);
      if (before) segments.push({ type: 'text', content: before });

      /* The open fence becomes an in-progress code block */
      segments.push({
        type:       'code',
        lang:       openFence[1] || 'plaintext',
        content:    openFence[2],
        incomplete: true,
      });
    } else {
      /* Not streaming, or no open fence — just render as text.
         (A stray ``` in a completed message is rare and renders
         as literal text, which is acceptable.) */
      segments.push({ type: 'text', content: remainder });
    }
  }

  return segments;
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, inherit currentColor
───────────────────────────────────────────────────────────────────── */

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   COPY BUTTON — small reusable button used both for full-message
   copy and for individual code blocks. Shows "Copied!" for 1.5s.
───────────────────────────────────────────────────────────────────── */
function CopyButton({ text, label, className }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button className={className} onClick={handleCopy} aria-label={label}>
      <CopyIcon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CODE BLOCK — rendered for each `code` segment.

   Two visual states:
     - Completed (incomplete=false): language label + Copy button
     - In-progress (incomplete=true): pulsing "writing…" label,
       no Copy button (nothing useful to copy yet), and a blinking
       cursor at the end of the partial code.
───────────────────────────────────────────────────────────────────── */
function CodeBlock({ lang, content, incomplete }) {
  return (
    <div className={`${styles.code_block} ${incomplete ? styles.code_block_writing : ''}`}>

      {/* Header: language label OR "writing…" indicator */}
      <div className={styles.code_block_header}>
        {incomplete ? (
          <span className={styles.code_writing_label}>
            <span className={styles.code_writing_dot} aria-hidden="true" />
            writing {lang !== 'plaintext' ? lang : 'code'}…
          </span>
        ) : (
          <span className={styles.code_lang}>{lang}</span>
        )}

        {/* Copy button only makes sense once the block is complete */}
        {!incomplete && (
          <CopyButton
            text={content}
            label={`Copy ${lang} code`}
            className={styles.code_copy_btn}
          />
        )}
      </div>

      {/* The code itself — pre preserves whitespace and indentation */}
      <pre className={styles.code_content}>
        <code>
          {content}
          {/* Blinking cursor sits inside the code while it's being written */}
          {incomplete && (
            <span className={styles.stream_cursor} aria-hidden="true">▋</span>
          )}
        </code>
      </pre>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   AI MESSAGE — the exported component, wrapped in memo().
───────────────────────────────────────────────────────────────────── */
const AIMessage = memo(function AIMessage({ msg }) {
  const isUser = msg.role === 'user';

  /* Parse AI content into text/code segments.
     User messages are never parsed — shown as plain text. */
  const segments = isUser ? null : parseContent(msg.content, msg.streaming);

  return (
    <div className={`${styles.msg} ${isUser ? styles.msg_user : styles.msg_ai}`}>

      {/* ── Avatar ── */}
      <div
        className={styles.msg_avatar}
        aria-hidden="true"
        style={isUser ? { background: avatarColor(msg.username || 'u') } : {}}
      >
        {isUser
          /* User: coloured initial letter */
          ? (msg.username?.[0]?.toUpperCase() ?? 'U')
          /* AI: the <CG/> logo mark */
          : <span className={styles.ai_logo_mark}>&lt;CG/&gt;</span>
        }
      </div>

      {/* ── Message body ── */}
      <div className={styles.msg_body}>

        {/* Sender name + relative timestamp */}
        <div className={styles.msg_meta}>
          <span className={styles.msg_label}>
            {isUser ? (msg.username || 'You') : 'Code Ground AI'}
          </span>
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

        {/* ── Content ── */}
        {isUser ? (
          /* User messages — plain pre-wrap text, never parsed */
          <p className={styles.msg_content}>{msg.content}</p>

        ) : segments.length === 0 ? (
          /*
           * AI message with NO content yet — the very first moment
           * of streaming, before the first token has arrived.
           * Show just a blinking cursor so the user sees the AI
           * is "about to type" rather than a blank gap.
           */
          msg.streaming ? (
            <p className={styles.msg_content}>
              <span className={styles.stream_cursor} aria-hidden="true">▋</span>
            </p>
          ) : null

        ) : (
          /* Render each parsed segment in order */
          <div className={styles.msg_segments}>
            {segments.map((seg, i) => {
              const isLast = i === segments.length - 1;

              if (seg.type === 'code') {
                return (
                  <CodeBlock
                    key={i}
                    lang={seg.lang}
                    content={seg.content}
                    incomplete={seg.incomplete}
                  />
                );
              }

              /* Text segment — pre-wrap preserves newlines from the AI.
                 Show the blinking cursor only on the LAST segment,
                 and only if it's a text segment (code segments handle
                 their own cursor when incomplete). */
              return (
                <p key={i} className={styles.msg_content}>
                  {seg.content}
                  {msg.streaming && isLast && (
                    <span className={styles.stream_cursor} aria-hidden="true">▋</span>
                  )}
                </p>
              );
            })}
          </div>
        )}

        {/* ── Copy full message — only on completed AI messages ── */}
        {!isUser && !msg.streaming && msg.content && (
          <CopyButton
            text={msg.content}
            label="Copy full response"
            className={styles.msg_copy}
          />
        )}

      </div>
    </div>
  );
});

export default AIMessage;
