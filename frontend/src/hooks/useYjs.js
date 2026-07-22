/**
 * useYjs.js — Code Ground real-time collaboration engine
 *
 * Extracted from the inline useYjs hook in Editor.jsx. This is the
 * single piece of code responsible for making multiple people see
 * the same document update live, with live cursors and presence.
 *
 * ── What this hook does ──────────────────────────────────────────────
 *
 *   1. Creates a Yjs CRDT document (Y.Doc) — the shared, conflict-free
 *      data structure that holds the document's text content.
 *   2. Creates a Yjs Awareness instance — ephemeral shared state for
 *      things that aren't part of the document itself: who's online,
 *      their name/colour, cursor position.
 *   3. Opens a Socket.io connection to the backend's real-time relay
 *      and wires up four message types in each direction:
 *        - sync-step-1   (server → us)   initial document snapshot
 *        - sync-update   (both ways)     incremental document changes
 *        - awareness-update (both ways)  presence/cursor changes
 *        - user-left     (server → us)   someone disconnected
 *   4. Exposes refs to the Yjs doc, awareness, and the MonacoBinding
 *      (set by the caller once Monaco mounts) so the parent component
 *      can wire up the editor and perform operations like snapshot
 *      restore (replacing the document's text content directly).
 *   5. Automatically reconnects with exponential backoff if the
 *      connection drops, and exposes `connected` so the UI can show
 *      a live status indicator.
 *   6. Cleans up everything (socket, awareness, doc, binding) when
 *      the component unmounts or docId/user changes.
 *
 * ── What this hook does NOT do ───────────────────────────────────────
 *
 *   - It does NOT touch Monaco directly. The caller is responsible
 *     for creating the MonacoBinding once the editor mounts, using
 *     the exposed `ydocRef` and `awarenessRef`, and storing it back
 *     into `bindingRef.current` so this hook can clean it up later.
 *   - It does NOT decide what `onUpdate`/`onPeersChange` DO with the
 *     data — those are plain callbacks supplied by the caller.
 *
 * ── Why dynamic imports ───────────────────────────────────────────────
 *
 *   yjs, socket.io-client, and y-protocols are only needed once a
 *   document is actually opened. Importing them eagerly at the top
 *   of Editor.jsx would bloat the initial bundle for every page that
 *   isn't the editor (Landing, Login, Dashboard, etc). Dynamic import
 *   means these libraries are fetched only when useYjs actually runs.
 *
 * ── Return value ─────────────────────────────────────────────────────
 *
 *   {
 *     ydocRef:      RefObject<Y.Doc | null>       — the shared document
 *     awarenessRef: RefObject<Awareness | null>   — presence/cursor state
 *     bindingRef:   RefObject<MonacoBinding | null> — set this yourself
 *                                                      once Monaco mounts
 *     connected:    boolean                        — live connection status
 *     getText:      () => string                   — current doc content,
 *                                                      '' if not ready yet
 *     replaceText:  (newText: string) => void       — atomically replaces
 *                                                      the document content
 *                                                      (used for snapshot
 *                                                      restore)
 *   }
 *
 * ── Usage in Editor.jsx ─────────────────────────────────────────────
 *
 *   import { useYjs } from '../hooks/useYjs.js';
 *
 *   const {
 *     ydocRef, awarenessRef, bindingRef, connected, getText, replaceText,
 *   } = useYjs({
 *     docId,
 *     user,
 *     onUpdate:      handleEditorUpdate,   // (text: string) => void
 *     onPeersChange: setPeers,             // (peers: Array) => void
 *   });
 *
 *   // `connected` replaces the old separately-managed `connected` state —
 *   // you can delete your own useState(false) for it and just use this.
 *
 *   // In handleEditorMount, after creating the MonacoBinding:
 *   bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), awarenessRef.current);
 *
 *   // In handleRestoreSnapshot, instead of manually reaching into
 *   // ydocRef.current.getText('content'), just call:
 *   replaceText(snapshot.content);
 */

import { useRef, useState, useEffect, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   AVATAR COLOR — deterministic colour from a username string.
   Same algorithm used across every other file in the app (Presence,
   Navbar, AIMessage, Dashboard) so a given user is always the same
   colour everywhere, including in their own Yjs awareness state.
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
   RECONNECT BACKOFF — how long to wait before each retry attempt.
   Starts fast (1s) so brief network blips recover quickly, then
   backs off to avoid hammering the server if it's genuinely down.
   Caps at 10s rather than growing unbounded.
───────────────────────────────────────────────────────────────────── */
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 10000];

/* ─────────────────────────────────────────────────────────────────────
   useYjs — the hook.
───────────────────────────────────────────────────────────────────── */
export function useYjs({ docId, user, onUpdate, onPeersChange }) {
  const ydocRef      = useRef(null);
  const socketRef    = useRef(null);
  const awarenessRef = useRef(null);
  const bindingRef   = useRef(null);

  /* Tracks how many reconnect attempts have happened since the last
     successful connection — resets to 0 on every successful connect. */
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef   = useRef(null);

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!docId || !user) return;
    let cancelled = false;

    /* Holds the Y namespace once loaded, so getText/replaceText
       (defined below, outside this effect) can use Y.applyUpdate
       and friends without re-importing. */
    let YRef = null;

    async function init() {
      /* Dynamic imports — keeps these heavy deps out of the main
         bundle until a document is actually opened. */
      const [Y, socketIOModule, awarenessModule] = await Promise.all([
        import('yjs'),
        import('socket.io-client'),
        import('y-protocols/awareness.js'),
      ]);

      if (cancelled) return;

      YRef = Y;
      const { io } = socketIOModule;
      const { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } = awarenessModule;

      /* ── Yjs document + awareness ── */
      const ydoc      = new Y.Doc();
      const awareness = new Awareness(ydoc);
      ydocRef.current      = ydoc;
      awarenessRef.current = awareness;

      /* Publish our own presence — name, colour, stable id */
      awareness.setLocalStateField('user', {
        name:   user.username,
        color:  avatarColor(user.username),
        userId: user.id ?? user.username,
      });

      /* ── Socket.io connection ──
         Wrapped in try/catch: if socket.io-client throws synchronously
         (e.g. malformed URL, environment issue), fail gracefully rather
         than crashing the whole Editor page. Collaboration simply won't
         work, but the editor itself remains usable solo. */
      let socket;
      try {
        const token = localStorage.getItem('cg_token');
        socket = io('/', {
          auth:               { token },
          transports:         ['websocket'],
          /* We manage our own reconnect/backoff below for full control
             over the `connected` state and attempt counting, rather
             than relying on socket.io's built-in reconnection. */
          reconnection:        false,
        });
      } catch (e) {
        console.warn('Socket.io connection skipped:', e.message);
        return;
      }

      socketRef.current = socket;

      function scheduleReconnect() {
        if (cancelled) return;
        const attempt = reconnectAttemptRef.current;
        const delayMs = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        reconnectAttemptRef.current = attempt + 1;

        reconnectTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          socket.connect();
        }, delayMs);
      }

      socket.on('connect', () => {
        if (cancelled) return;
        setConnected(true);
        reconnectAttemptRef.current = 0;
        socket.emit('join-document', { docId });
      });

      socket.on('disconnect', () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      });

      socket.on('connect_error', () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      });

      /* ── Incoming Yjs sync ── */

      /* Initial snapshot when we first join the document room */
      socket.on('sync-step-1', ({ update }) => {
        if (update) Y.applyUpdate(ydoc, new Uint8Array(update));
      });

      /* Incremental updates from other collaborators */
      socket.on('sync-update', ({ update }) => {
        Y.applyUpdate(ydoc, new Uint8Array(update), 'remote');
      });

      /* ── Incoming awareness (presence/cursors) ── */
      socket.on('awareness-update', ({ update }) => {
        applyAwarenessUpdate(awareness, new Uint8Array(update), 'server');
      });

      /* Someone disconnected — remove them from the peer list
         immediately rather than waiting for an awareness timeout */
      socket.on('user-left', ({ userId }) => {
        if (cancelled) return;
        onPeersChange?.(prev =>
          Array.isArray(prev) ? prev.filter(p => p.userId !== userId) : prev
        );
      });

      /* ── Outgoing Yjs sync ──
         Every local edit (origin !== 'remote') is broadcast to the
         server, which relays it to other connected clients. */
      ydoc.on('update', (update, origin) => {
        if (origin === 'remote') return; /* don't echo back what we just received */
        socket.emit('sync-update', { docId, update: Array.from(update) });
        onUpdate?.(ydoc.getText('content').toString());
      });

      /* ── Outgoing awareness ──
         Every local presence change (cursor move, etc.) is broadcast,
         and we also rebuild our local peer list from the full
         awareness state so the UI's presence list stays accurate. */
      awareness.on('change', () => {
        const update = encodeAwarenessUpdate(
          awareness,
          Array.from(awareness.getStates().keys())
        );
        socket.emit('awareness-update', { docId, update: Array.from(update) });

        const peers = [];
        awareness.getStates().forEach((state, clientId) => {
          if (clientId !== awareness.clientID && state.user) peers.push(state.user);
        });
        if (!cancelled) onPeersChange?.(peers);
      });
    }

    init().catch(err => console.warn('Yjs init error:', err));

    /* ── Cleanup ──
       Runs on unmount AND whenever docId/user.id changes (e.g.
       navigating from one document to another without a full
       page reload) — tears down the old session completely before
       the effect re-runs for the new one. */
    return () => {
      cancelled = true;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;

      bindingRef.current?.destroy();
      bindingRef.current = null;

      awarenessRef.current?.destroy();
      awarenessRef.current = null;

      socketRef.current?.disconnect();
      socketRef.current = null;

      ydocRef.current?.destroy();
      ydocRef.current = null;

      setConnected(false);
    };
  }, [docId, user?.id]);

  /* ── getText ──
     Reads the current document content. Returns '' if the Yjs doc
     hasn't initialised yet (e.g. called during the brief window
     before the dynamic imports resolve). */
  const getText = useCallback(() => {
    if (!ydocRef.current) return '';
    return ydocRef.current.getText('content').toString();
  }, []);

  /* ── replaceText ──
     Atomically replaces the entire document content with new text.
     Used by snapshot restore — wrapped in a Yjs transaction so the
     delete + insert is applied as one atomic update (one entry in
     the undo stack, one network message, not two separate ones that
     could be observed mid-way by another connected client). */
  const replaceText = useCallback((newText) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;

    const ytext = ydoc.getText('content');
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newText);
    });
  }, []);

  return {
    ydocRef,
    awarenessRef,
    bindingRef,
    connected,
    getText,
    replaceText,
  };
}

export default useYjs;
