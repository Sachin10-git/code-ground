/**
 * TeamChatPanel.jsx — Code Ground Team Chat panel (Phase 6.0)
 *
 * Discord-style room chat for everyone collaborating on the same
 * project. Sits in the right sidebar as a sibling of AIChatPanel,
 * switched between via the AI/Team tab strip in Editor.jsx — this
 * component itself has no idea tabs exist; it just renders whatever
 * `messages`/`loading` it's given and calls `onSend`.
 *
 * Layout and scroll behaviour deliberately mirror AIChatPanel.jsx (same
 * auto-scroll-only-if-already-at-bottom rule, same Enter-to-send/
 * Shift+Enter-for-newline input) so the two panels feel like the same
 * product, not two bolted-together features.
 */

import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import TeamChatMessage from './TeamChatMessage.jsx';
import styles from './TeamChatPanel.module.css';

/* ─────────────────────────────────────────────────────────────────────
   ICONS — inline SVG, stroke-based, matches AIChatPanel's icon set.
───────────────────────────────────────────────────────────────────── */
const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const Spinner = () => (
  <svg className={styles.spinner} width="14" height="14"
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE — shown once history has loaded and there's nothing yet.
───────────────────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.empty_icon} aria-hidden="true"><ChatIcon /></div>
      <p className={styles.empty_heading}>No messages yet</p>
      <p className={styles.empty_sub}>
        Say hello — everyone in this project will see it here.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   LOADING STATE — shown while history is still loading.
───────────────────────────────────────────────────────────────────── */
function LoadingState() {
  return (
    <div className={styles.loading} role="status" aria-label="Loading chat history">
      <Spinner />
      <span>Loading messages…</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   TEAM CHAT PANEL — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function TeamChatPanel({
  messages    = [],
  loading     = false,
  onSend,
  currentUser = null,
}) {
  const [input, setInput]       = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const listRef  = useRef(null);
  const inputRef = useRef(null);

  const currentUserId = currentUser?._id ?? currentUser?.id;

  /* Auto-scroll to bottom on new messages, but only if the user is
     already near the bottom — never yank them away from history
     they've scrolled up to read. */
  useEffect(() => {
    if (atBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, atBottom]);

  /* Jump to bottom once history finishes loading, regardless of
     whatever scrollTop the empty/loading state happened to leave. */
  useEffect(() => {
    if (!loading && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, [loading]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distFromBottom < 80);
  }

  function scrollToBottom() {
    if (listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
    setAtBottom(true);
  }

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    onSend?.(text);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    inputRef.current?.focus();
  }, [input, onSend]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputResize(e) {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  return (
    <aside className={styles.root} aria-label="Team chat">
      <div
        ref={listRef}
        className={styles.messages}
        role="log"
        aria-label="Team chat history"
        aria-live="polite"
        onScroll={handleScroll}
      >
        {loading ? (
          <LoadingState />
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((msg) => (
            <TeamChatMessage
              key={msg.id}
              msg={msg}
              isOwn={currentUserId != null && String(msg.userId) === String(currentUserId)}
            />
          ))
        )}
      </div>

      {!atBottom && (
        <button
          className={styles.scroll_btn}
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          title="Scroll to bottom"
        >
          <ChevronDownIcon />
        </button>
      )}

      <div className={styles.input_wrap}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInputResize}
          placeholder="Message your team… (Enter to send)"
          rows={1}
          aria-label="Message to team"
          aria-describedby="team-chat-input-hint"
        />
        <span id="team-chat-input-hint" className={styles.sr_only}>
          Press Enter to send. Press Shift and Enter for a new line.
        </span>

        <button
          className={styles.send_btn}
          onClick={handleSend}
          disabled={!input.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>

      <p className={styles.input_hint} aria-hidden="true">
        Enter ↵ to send · Shift+Enter for newline
      </p>
    </aside>
  );
}
