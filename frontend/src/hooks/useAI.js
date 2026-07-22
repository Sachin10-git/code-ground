/**
 * useAI.js — Code Ground AI pair programmer hook
 *
 * Extracted from the inline handleAISend function in Editor.jsx.
 * Owns the complete AI chat lifecycle: message state, SSE streaming,
 * token-by-token appending, abort handling, and context note text.
 *
 * ── What this hook does ──────────────────────────────────────────────
 *
 *   1. Maintains the full chat message list for the current session.
 *      Each message: { id, role, content, username, streaming, timestamp }
 *
 *   2. When the user sends a question (via the returned `send` function):
 *        a. Appends the user's message immediately (optimistic)
 *        b. Appends an empty AI placeholder with streaming: true
 *        c. POSTs to /api/ai/ask with the question + full session context
 *        d. Opens the SSE ReadableStream and appends tokens one by one
 *           to the placeholder message as they arrive
 *        e. When the stream closes, sets streaming: false on the message
 *
 *   3. Exposes an `abort` function to cancel a running stream — useful
 *      for a "Stop generating" button. Internally this uses AbortController,
 *      so the fetch + ReadableStream reader both stop cleanly.
 *
 *   4. Computes a `contextNote` string ("Watching your edits",
 *      "Watching you and Alice", "Watching 4 people") from the peers
 *      array — previously computed inline in Editor.jsx with useMemo.
 *
 * ── What this hook does NOT do ───────────────────────────────────────
 *
 *   - Does NOT call the Anthropic API directly. That lives on the backend
 *     at POST /api/ai/ask, which returns an SSE stream. This hook is the
 *     client-side consumer of that stream.
 *   - Does NOT read the editor value itself. Callers pass `code` and
 *     `language` into `send()` — this keeps the hook decoupled from Monaco.
 *   - Does NOT own the editLog (the ring buffer of recent edits). Callers
 *     pass `editLog` into `send()` so useYjs continues to own that data.
 *
 * ── SSE format expected from the backend ────────────────────────────
 *
 *   Each chunk from POST /api/ai/ask looks like:
 *     data: <token text>\n\n
 *
 *   A token can be any fragment — a word, a few characters, a newline.
 *   The stream ends with:
 *     data: [DONE]\n\n
 *
 *   We use fetch() + ReadableStream rather than EventSource because:
 *     - EventSource doesn't support POST or custom headers (no auth token)
 *     - fetch() + ReadableStream gives us clean AbortController support
 *     - The SSE format is simple enough to parse manually in ~10 lines
 *
 * ── Return value ─────────────────────────────────────────────────────
 *
 *   {
 *     messages:     Array    — full chat history, passed directly to AISidebar
 *     loading:      boolean  — true while an SSE stream is open
 *     send:         Function — send(question, { code, language, editLog,
 *                                              peers, lastOutput, username })
 *     abort:        Function — cancels the running stream
 *     clearHistory: Function — resets messages to []
 *     contextNote:  string   — human-readable "who the AI is watching" string
 *   }
 *
 * ── Usage in Editor.jsx ─────────────────────────────────────────────
 *
 *   import { useAI } from '../hooks/useAI.js';
 *
 *   const { messages, loading, send, abort, clearHistory, contextNote } = useAI({
 *     peers,
 *     endpoint: '/api/ai/ask',   // optional, defaults to '/api/ai/ask'
 *   });
 *
 *   // Replace handleAISend with:
 *   function handleAISend(question) {
 *     send(question, {
 *       code:       editorRef.current?.getValue() ?? '',
 *       language:   doc?.language ?? 'javascript',
 *       editLog:    editLogRef.current.slice(-20),
 *       peers:      peers.map(p => p.name),
 *       lastOutput: output
 *         ? { stdout: output.stdout?.slice(0, 500), stderr: output.stderr?.slice(0, 500) }
 *         : null,
 *       username:   user?.username,
 *     });
 *   }
 *
 *   // Remove from Editor.jsx:
 *   //   const [aiMessages, setAiMessages] = useState([]);
 *   //   const [aiLoading,  setAiLoading]  = useState(false);
 *   //   const contextNote = useMemo(...);
 *   //   async function handleAISend(...) { ... }
 *
 *   // Pass to AISidebar:
 *   <AISidebar
 *     messages={messages}
 *     loading={loading}
 *     onSend={handleAISend}
 *     onClear={clearHistory}
 *     contextNote={contextNote}
 *     currentUser={user}
 *   />
 */

import { useState, useRef, useCallback, useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   STABLE ID GENERATOR
   Date.now() alone collides if two messages are created in the same
   millisecond. This monotonically-increasing counter avoids that by
   combining the timestamp with a per-session sequence number.
───────────────────────────────────────────────────────────────────── */
let _seq = 0;
function nextId() {
  return `${Date.now()}-${++_seq}`;
}

/* ─────────────────────────────────────────────────────────────────────
   SSE PARSER
   Reads chunks from a ReadableStream and calls onChunk(text) for each
   "data: <text>" line received, stopping when "data: [DONE]" arrives
   or the signal is aborted.

   The standard SSE format:
     data: token text here\n
     \n
   Multiple data lines per event are also valid (joined with \n).

   We buffer incomplete lines between chunks so a "data: " token that
   spans two network packets is handled correctly.
───────────────────────────────────────────────────────────────────── */
async function readSSEStream(response, onChunk, signal) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  try {
    while (true) {
      /* AbortController fires signal.aborted between reads — check it
         here so we don't need to poll inside the chunk processing loop. */
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /* Split on newlines — the last element is always an incomplete
         line (possibly empty string), kept in the buffer for next time */
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        /* Skip empty lines (SSE event separators) and comment lines */
        if (!line || line.startsWith(':')) continue;

        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') return; /* stream ended cleanly */
          if (payload)             onChunk(payload);
        }
      }
    }
  } finally {
    /* Always release the lock so the body can be GC'd */
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/* ─────────────────────────────────────────────────────────────────────
   useAI — the hook
───────────────────────────────────────────────────────────────────── */
export function useAI({ peers = [], endpoint = '/api/ai/ask' } = {}) {
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(false);

  /* Holds the AbortController for the currently-in-flight request.
     Stored in a ref so `abort()` can reach it without stale closure
     issues and without triggering a re-render when it changes. */
  const abortRef = useRef(null);

  /* ── contextNote ──
     "Watching your edits" / "Watching you and Alice" / "Watching N people"
     Previously a useMemo in Editor.jsx — moved here since it's entirely
     about the AI's awareness context, not the editor's layout state. */
  const contextNote = useMemo(() => {
    if (peers.length === 0) return 'Watching your edits';
    if (peers.length === 1) return `Watching you and ${peers[0].name}`;
    return `Watching ${peers.length + 1} people`;
  }, [peers]);

  /* ── abort ──
     Cancels the current SSE stream immediately. The finally block in
     send() will still run, setting loading=false and streaming=false. */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ── clearHistory ──
     Also aborts any in-flight request before clearing, so a running
     stream can't append to the now-empty list. */
  const clearHistory = useCallback(() => {
    abort();
    setMessages([]);
  }, [abort]);

  /* ── send ──
     The main action. Takes the user's question and the session context,
     then manages the full lifecycle: append messages, open SSE stream,
     append tokens, handle errors, clean up.

     Parameters:
       question   {string}  — the user's question
       context    {object}  — {
         code       string    — current editor content
         language   string    — 'javascript' | 'python' | etc.
         editLog    Array     — last N edits (for AI awareness)
         peers      Array     — peer name strings
         lastOutput object    — last execution output (stdout/stderr)
         username   string    — the user's own name (for avatar)
       }
  */
  const send = useCallback(async (question, context = {}) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const {
      code       = '',
      language   = 'javascript',
      editLog    = [],
      lastOutput = null,
      username   = 'You',
    } = context;

    /* ── Build the two messages ── */
    const userMsgId = nextId();
    const aiMsgId   = nextId();

    const userMsg = {
      id:        userMsgId,
      role:      'user',
      content:   trimmed,
      username,
      streaming: false,
      timestamp: new Date().toISOString(),
    };

    const aiMsg = {
      id:        aiMsgId,
      role:      'assistant',
      content:   '',
      streaming: true,
      timestamp: new Date().toISOString(),
    };

    /* Append both immediately — user message is instant feedback,
       AI placeholder shows the "thinking" indicator in AISidebar */
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);

    /* Create a fresh AbortController for this request */
    const controller  = new AbortController();
    abortRef.current  = controller;

    try {
      const token = localStorage.getItem('cg_token');

      const response = await fetch(endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          question: trimmed,
          code,
          language,
          editLog,
          peers:      (context.peers ?? []).map(p =>
            typeof p === 'string' ? p : (p.name ?? '')
          ),
          lastOutput,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        /* Non-2xx — read the error body if available, then throw */
        let errText = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error) errText = body.error;
        } catch { /* body wasn't JSON, use the status string */ }
        throw new Error(errText);
      }

      /* ── Read the SSE stream ──
         Each call to onChunk appends the token to the AI message.
         We use functional state updates (prev => ...) so we're never
         reading stale closure state inside a tight streaming loop. */
      await readSSEStream(
        response,
        (chunk) => {
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId
              ? { ...m, content: m.content + chunk }
              : m
          ));
        },
        controller.signal,
      );

    } catch (err) {
      /* AbortError means the user (or clearHistory) cancelled — don't
         show an error message for a deliberate cancellation. */
      const wasCancelled = err?.name === 'AbortError';

      if (!wasCancelled) {
        const errContent =
          err?.message?.startsWith('HTTP 4')
            ? `Request failed: ${err.message}`
            : 'Something went wrong. Please try again.';

        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, content: errContent, streaming: false }
            : m
        ));
      }

    } finally {
      /* Mark the AI message as done — whether success, error, or abort */
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, streaming: false } : m
      ));
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, endpoint]);

  return {
    messages,
    loading,
    send,
    abort,
    clearHistory,
    contextNote,
  };
}

export default useAI;
