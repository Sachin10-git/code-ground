/**
 * useAI.js — Code Ground AI chat hook (Phase 6.1 — AI Foundation)
 *
 * Owns the AI chat message list and talks to the real backend
 * contract: POST /api/ai/chat, a single non-streaming JSON response
 * (no SSE — streaming is out of scope for this phase). Conversation
 * lives only in this hook's React state: it survives switching
 * between the AI/Team tabs (Editor.jsx never unmounts either panel),
 * but resets on a full page refresh, per spec — no persistence layer
 * yet.
 *
 * ── What this hook does ──────────────────────────────────────────────
 *
 *   1. Maintains the chat message list: { id, role, content, username,
 *      streaming, error, timestamp }.
 *
 *   2. send(question, context) — context: { projectId, fileId,
 *      selectedCode, fileContent, username }. `fileContent` is the
 *      live Monaco buffer, sent so the AI sees unsaved edits too (not
 *      just the last explicit save) — it overrides the persisted
 *      File.content on the backend. Appends the user's message and an
 *      empty assistant placeholder (streaming: true), builds
 *      chatHistory from the prior turns already in state (excluding
 *      any failed attempts), then POSTs to /api/ai/chat. On success
 *      the placeholder gets the full response text; on failure it gets
 *      a clear `error` string instead of content.
 *
 *   3. explainCode(editorCtx, { username }) / reviewCode(editorCtx,
 *      { username }) / refactorCode(editorCtx, { username }) — Phase
 *      6.2 / 6.3 / 6.4. All three are thin wrappers over the shared
 *      runEditorAction() helper. editorCtx is whatever
 *      useEditorContext's getEditorContext() returns (or null). Same
 *      message list, same /api/ai/<action> POST plumbing as send(),
 *      just a synthetic user-facing label instead of a typed question,
 *      and action: 'explain'/'review'/'refactor' tagged on both
 *      messages so the UI can show they're distinct from a normal chat
 *      turn.
 *
 *   4. retry(messageId) — resends the exact request that produced a
 *      failed assistant message, in place (same message id, so it
 *      doesn't duplicate in the list). Works for send() and every
 *      runEditorAction()-based action.
 *
 *   5. clearHistory() — resets messages to [].
 *
 *   6. contextNote — "Watching your edits" / "Watching you and Alice" /
 *      "Watching N people", derived from `peers`, same as before.
 *
 * ── What this hook does NOT do ───────────────────────────────────────
 *
 *   - Does NOT stream tokens. The full response arrives in one
 *     response body and is set on the message in a single update.
 *   - Does NOT read the editor value itself — callers pass
 *     `selectedCode`/`editorCtx` in from useEditorContext.
 *   - Does NOT persist history server-side (out of scope this phase).
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import api from '../utils/api.js';

/* ─────────────────────────────────────────────────────────────────────
   STABLE ID GENERATOR — same scheme as before: timestamp + a
   monotonic counter so two messages created in the same millisecond
   never collide.
───────────────────────────────────────────────────────────────────── */
let _seq = 0;
function nextId() {
  return `${Date.now()}-${++_seq}`;
}

/* Cap on how many prior turns get sent as chatHistory — bounds the
   request payload/prompt size for a long-running conversation. */
const CHAT_HISTORY_LIMIT = 20;

/* One backend route per AI action. Phase 6.2 added 'explain', Phase
   6.3 added 'review', Phase 6.4 added 'refactor', Phase 6.5 adds
   'generate' — nothing else in this hook's request plumbing changes
   when a new action is added. */
const ENDPOINTS = {
  chat:     '/ai/chat',
  explain:  '/ai/explain',
  review:   '/ai/review',
  refactor: '/ai/refactor',
};

/* Per-action copy for the "editor action" requests below (explain,
   review, refactor, generate, ...) — everything else about how they're
   built and sent is identical, so adding a new one is just a new entry
   here plus a new ENDPOINTS entry plus a new backend prompt template.
   label/userPrompt are functions of the editor context so most actions
   need no user input; Generate is the exception — it always passes an
   explicit `instruction` (see runEditorAction below), which takes
   priority over these when present. */
const EDITOR_ACTIONS = {
  explain: {
    label:      (ctx) => ctx.hasSelection ? 'Explain the selected code' : `Explain this file${ctx.fileName ? ` — ${ctx.fileName}` : ''}`,
    userPrompt: (ctx) => ctx.hasSelection ? 'Explain the selected code.' : 'Explain this file.',
    noFileError: 'Open a file in this project before asking the AI to explain code.',
  },
  review: {
    label:      (ctx) => ctx.hasSelection ? 'Review the selected code' : `Review this file${ctx.fileName ? ` — ${ctx.fileName}` : ''}`,
    userPrompt: (ctx) => ctx.hasSelection ? 'Review the selected code.' : 'Review this file.',
    noFileError: 'Open a file in this project before asking the AI to review code.',
  },
  refactor: {
    label:      (ctx) => ctx.hasSelection ? 'Refactor the selected code' : `Refactor this file${ctx.fileName ? ` — ${ctx.fileName}` : ''}`,
    userPrompt: (ctx) => ctx.hasSelection ? 'Refactor the selected code.' : 'Refactor this file.',
    noFileError: 'Open a file in this project before asking the AI to refactor code.',
  },
};

export function useAI({ peers = [] } = {}) {
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(false);

  /* Remembers the exact request (question + context) behind each
     assistant message id, so retry(messageId) can resend it without
     the caller having to keep its own bookkeeping. Cleared entries
     are just left as harmless dead map keys until clearHistory(). */
  const requestArgsRef = useRef(new Map());

  /* ── contextNote ──
     "Watching your edits" / "Watching you and Alice" / "Watching N people" */
  const contextNote = useMemo(() => {
    if (peers.length === 0) return 'Watching your edits';
    if (peers.length === 1) return `Watching you and ${peers[0].name}`;
    return `Watching ${peers.length + 1} people`;
  }, [peers]);

  /* ── runRequest ──
     The actual network call, shared by every action (send/retry today;
     explain below) — they only differ in which endpoint they hit and
     what userPrompt text they send. */
  const runRequest = useCallback(async (aiMsgId, action, question, requestContext) => {
    setLoading(true);
    setMessages(prev => prev.map(m => (
      m.id === aiMsgId ? { ...m, content: '', error: null, streaming: true } : m
    )));

    try {
      const { data } = await api.post(ENDPOINTS[action] || ENDPOINTS.chat, {
        projectId:    requestContext.projectId,
        fileId:       requestContext.fileId,
        selectedCode: requestContext.selectedCode || '',
        fileContent:  requestContext.fileContent ?? '',
        userPrompt:   question,
        chatHistory:  requestContext.history,
      });

      setMessages(prev => prev.map(m => (
        m.id === aiMsgId ? { ...m, content: data.response, streaming: false } : m
      )));

    } catch (err) {
      const message =
        err.response?.data?.errors?.[0]?.msg ||
        err.response?.data?.message ||
        'Something went wrong. Please try again.';

      setMessages(prev => prev.map(m => (
        m.id === aiMsgId ? { ...m, content: '', error: message, streaming: false } : m
      )));

    } finally {
      setLoading(false);
    }
  }, []);

  /* ── send ──
     question   {string}
     context    { projectId, fileId, selectedCode, username } */
  const send = useCallback((question, context = {}) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMsgId = nextId();
    const aiMsgId   = nextId();

    const userMsg = {
      id:        userMsgId,
      role:      'user',
      content:   trimmed,
      username:  context.username || 'You',
      timestamp: new Date().toISOString(),
    };

    /* No project/file open yet — nothing to send the AI as context.
       Surface this as a normal (non-network) error immediately rather
       than letting the request 400 with a validation message the user
       didn't ask for. */
    if (!context.projectId || !context.fileId) {
      const aiMsg = {
        id: aiMsgId, role: 'assistant', content: '', streaming: false,
        error: 'Open a file in this project before chatting with the AI — it needs a file to answer questions about.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg, aiMsg]);
      return;
    }

    /* Prior turns only (not the question being asked right now),
       excluding any failed attempts — they carry no real content. */
    const history = messages
      .filter(m => !m.error)
      .slice(-CHAT_HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.content }));

    const requestContext = {
      projectId:    context.projectId,
      fileId:       context.fileId,
      selectedCode: context.selectedCode,
      fileContent:  context.fileContent,
      history,
    };

    const aiMsg = {
      id: aiMsgId, role: 'assistant', content: '', streaming: true, error: null,
      timestamp: new Date().toISOString(),
    };

    requestArgsRef.current.set(aiMsgId, { action: 'chat', question: trimmed, context: requestContext });
    setMessages(prev => [...prev, userMsg, aiMsg]);
    runRequest(aiMsgId, 'chat', trimmed, requestContext);
  }, [loading, messages, runRequest]);

  /* ── runEditorAction ──
     Shared by every "editor context" action — Explain (Phase 6.2) and
     Review (Phase 6.3) today. editorCtx comes straight from
     useEditorContext's getEditorContext() — { projectId, fileId,
     fileName, selectedCode, fileContent, hasSelection } or null if no
     file is open. Unlike send(), there's no user-typed question: the
     "user" bubble is a synthetic label (from EDITOR_ACTIONS) so the
     request still reads naturally in the conversation, and both
     messages are tagged `action` so the UI can visually distinguish
     them from a normal chat turn. Adding a new action is an
     EDITOR_ACTIONS + ENDPOINTS entry, a thin wrapper below, and a
     backend prompt template — nothing here changes.

     `instruction`, if passed, overrides EDITOR_ACTIONS' computed
     label/userPrompt outright — Generate (Phase 6.5) is user-driven
     rather than a fixed action on fixed code, so it always supplies
     its own typed instruction instead of a template string. */
  const runEditorAction = useCallback((action, editorCtx, { username = 'You', instruction } = {}) => {
    if (loading) return;
    const config = EDITOR_ACTIONS[action];

    if (!editorCtx || !editorCtx.projectId || !editorCtx.fileId) {
      const aiMsgId = nextId();
      setMessages(prev => [...prev, {
        id: aiMsgId, role: 'assistant', content: '', streaming: false,
        action,
        error: config.noFileError,
        timestamp: new Date().toISOString(),
      }]);
      return;
    }

    const { projectId, fileId, selectedCode, fileContent } = editorCtx;
    const label      = instruction || config.label(editorCtx);
    const userPrompt = instruction || config.userPrompt(editorCtx);

    const userMsgId = nextId();
    const aiMsgId   = nextId();

    const userMsg = {
      id: userMsgId, role: 'user', content: label, username, action,
      timestamp: new Date().toISOString(),
    };

    const history = messages
      .filter(m => !m.error)
      .slice(-CHAT_HISTORY_LIMIT)
      .map(m => ({ role: m.role, content: m.content }));

    const requestContext = { projectId, fileId, selectedCode, fileContent, history };

    const aiMsg = {
      id: aiMsgId, role: 'assistant', content: '', streaming: true, error: null,
      action,
      timestamp: new Date().toISOString(),
    };

    requestArgsRef.current.set(aiMsgId, { action, question: userPrompt, context: requestContext });
    setMessages(prev => [...prev, userMsg, aiMsg]);
    runRequest(aiMsgId, action, userPrompt, requestContext);
  }, [loading, messages, runRequest]);

  /* ── explainCode / reviewCode / refactorCode ──
     Thin, named wrappers over runEditorAction so callers (Editor.jsx)
     keep calling a self-explanatory function per action. */
  const explainCode = useCallback((editorCtx, opts) => (
    runEditorAction('explain', editorCtx, opts)
  ), [runEditorAction]);

  const reviewCode = useCallback((editorCtx, opts) => (
    runEditorAction('review', editorCtx, opts)
  ), [runEditorAction]);

  const refactorCode = useCallback((editorCtx, opts) => (
    runEditorAction('refactor', editorCtx, opts)
  ), [runEditorAction]);

  /* ── retry ──
     Resends the exact request stored for a failed assistant message. */
  const retry = useCallback((messageId) => {
    const stored = requestArgsRef.current.get(messageId);
    if (!stored || loading) return;
    runRequest(messageId, stored.action, stored.question, stored.context);
  }, [loading, runRequest]);

  /* ── clearHistory ── */
  const clearHistory = useCallback(() => {
    setMessages([]);
    requestArgsRef.current.clear();
  }, []);

  return {
    messages,
    loading,
    send,
    explainCode,
    reviewCode,
    refactorCode,
    retry,
    clearHistory,
    contextNote,
  };
}

export default useAI;
