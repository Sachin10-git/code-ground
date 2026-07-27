/**
 * AIChatPanel.jsx — Code Ground AI chat panel (Phase 6.1 — AI Foundation)
 *
 * Replaces the old AISidebar.jsx placeholder. Visually matches
 * TeamChatPanel.jsx (same scrollable-list + input layout, same
 * auto-scroll-only-if-already-at-bottom rule, same Enter-to-send/
 * Shift+Enter-for-newline input) so the AI and Team tabs feel like one
 * product — just a slim contextNote strip up top instead of Team
 * Chat's bare list, since "who the AI is watching" is worth surfacing
 * and Team Chat has no equivalent concept.
 *
 * This component owns UI only: message list rendering, scroll state,
 * the input box, and the loading/empty states. The actual API call
 * lives in useAI.js (Editor.jsx wires the two together) — this keeps
 * the panel testable with plain mock props, same as AISidebar was.
 */

import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import AIChatMessage from './AIChatMessage.jsx';
import styles from './AIChatPanel.module.css';

/* ─────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────── */
const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/* Phase 6.6 — the four AI action icons, moved here from Navbar.jsx now
   that the actions themselves live in this panel instead of the top
   toolbar. */
const ExplainIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .9 1.6h5.2c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3z" />
  </svg>
);

const ReviewIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

const RefactorIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="8 21 3 21 3 16" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
);

const GenerateIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
    <path d="M19 15l.9 2.7L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.3z" />
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
   AI ACTIONS — Phase 6.6. Moved in from the top navbar so the AI panel
   is the single place all AI interactions happen. Table-driven (icon +
   label + prop name) rather than four near-identical JSX blocks; each
   entry's onClick/disabled just reads the matching prop passed down
   from Editor.jsx, which still owns the actual request logic
   (handleExplain/handleReview/handleRefactor/handleOpenGenerate) —
   this component only renders the trigger.
───────────────────────────────────────────────────────────────────── */
const ACTIONS = [
  { key: 'explain',  label: 'Explain',  Icon: ExplainIcon  },
  { key: 'review',   label: 'Review',   Icon: ReviewIcon   },
  { key: 'refactor', label: 'Refactor', Icon: RefactorIcon },
  { key: 'generate', label: 'Generate', Icon: GenerateIcon },
];

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE
───────────────────────────────────────────────────────────────────── */
const SUGGESTIONS = [
  'Explain what this code does',
  'Find bugs in this file',
  'How can this be optimised?',
  'Write tests for this function',
];

function EmptyState({ onSuggestion }) {
  return (
    <div className={styles.empty}>
      <div className={styles.empty_logo} aria-hidden="true">&lt;CG/&gt;</div>
      <p className={styles.empty_heading}>Your AI pair programmer</p>
      <p className={styles.empty_sub}>
        Ask anything about the currently open file. Responses are
        grounded in its real content — nothing is invented.
      </p>

      <div className={styles.suggestions} role="list">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            role="listitem"
            className={styles.suggestion_btn}
            onClick={() => onSuggestion(s)}
          >
            <span className={styles.suggestion_arrow} aria-hidden="true">›</span>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   AI CHAT PANEL — the root exported component.
───────────────────────────────────────────────────────────────────── */
export default function AIChatPanel({
  messages    = [],
  loading     = false,
  onSend,
  onRetry,
  onClear,
  contextNote = '',

  /* Phase 6.6 — AI actions (Explain/Review/Refactor/Generate), moved
     in from the navbar. Each is optional so this panel still renders
     fine without them (e.g. in isolation/tests); `actionsDisabled` is
     a single shared flag (true when no file is open) rather than one
     per action, since all four need exactly the same guard. */
  onExplain,
  onReview,
  onRefactor,
  onGenerate,
  actionsDisabled = false,
}) {
  const [input, setInput]       = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const listRef  = useRef(null);
  const inputRef = useRef(null);

  /* Auto-scroll to bottom on new messages, but only if the user is
     already near the bottom — never yank them away from history
     they've scrolled up to read. */
  useEffect(() => {
    if (atBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, atBottom]);

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
    const q = input.trim();
    if (!q || loading) return;
    onSend?.(q);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    inputRef.current?.focus();
  }, [input, loading, onSend]);

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

  function handleSuggestion(text) {
    setInput(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const ACTION_HANDLERS = { explain: onExplain, review: onReview, refactor: onRefactor, generate: onGenerate };

  return (
    <aside className={styles.root} aria-label="AI pair programmer">

      {/* ── Context strip — "who the AI is watching" + clear button ── */}
      {(contextNote || messages.length > 0) && (
        <div className={styles.context_note}>
          <span className={styles.context_dot} aria-hidden="true" />
          <span className={styles.context_text}>{contextNote}</span>
          {messages.length > 0 && (
            <button
              className={styles.clear_btn}
              onClick={onClear}
              aria-label="Clear chat history"
              title="Clear chat"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      )}

      {/* ── AI actions — Explain/Review/Refactor/Generate (Phase 6.6).
          Always visible (not just on the empty state) so they're
          available throughout a conversation, not only at its start. ── */}
      <div className={styles.actions_row} role="toolbar" aria-label="AI actions">
        {ACTIONS.map(({ key, label, Icon }) => {
          const handler = ACTION_HANDLERS[key];
          if (!handler) return null;
          return (
            <button
              key={key}
              type="button"
              className={styles.action_btn}
              onClick={handler}
              disabled={actionsDisabled || loading}
              title={actionsDisabled ? `Open a file to ${label.toLowerCase()}` : `${label} the selected code, or the whole file if nothing is selected`}
            >
              <Icon />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Message list ── */}
      <div
        ref={listRef}
        className={styles.messages}
        role="log"
        aria-label="AI conversation history"
        aria-live="polite"
        onScroll={handleScroll}
      >
        {messages.length === 0 && (
          <EmptyState onSuggestion={handleSuggestion} />
        )}

        {messages.map(msg => (
          <AIChatMessage key={msg.id} msg={msg} onRetry={onRetry} />
        ))}
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

      {/* ── Input area ── */}
      <div className={styles.input_wrap}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInputResize}
          placeholder="Ask about the code… (Enter to send)"
          rows={1}
          disabled={loading}
          aria-label="Message to AI pair programmer"
          aria-describedby="ai-input-hint"
        />
        <span id="ai-input-hint" className={styles.sr_only}>
          Press Enter to send. Press Shift and Enter for a new line.
        </span>

        <button
          className={styles.send_btn}
          onClick={handleSend}
          disabled={loading || !input.trim()}
          aria-label="Send message"
        >
          {loading ? <Spinner /> : <SendIcon />}
        </button>
      </div>

      <p className={styles.input_hint} aria-hidden="true">
        Enter ↵ to send · Shift+Enter for newline
      </p>

    </aside>
  );
}
