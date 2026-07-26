/**
 * useYjs.js — Code Ground real-time collaboration engine (Phase 5)
 *
 * One Y.Doc per FILE, never per project. The collaboration room
 * identity is the file's `_id`, matching the backend's already-generic
 * roomId-keyed CRDT system (backend/src/socket/socketEvents.js +
 * backend/src/crdt/*). Room membership (`peers`) is tracked via the
 * existing room:user-joined/room:user-left events (Phase 5.2). Each
 * peer's `active` (editing vs. viewing) flag is driven by the
 * editor:typing-start/stop + editor:user-typing/stopped-typing events
 * (Phase 5.3). Live cursor positions (Phase 5.4) are tracked the same
 * way — editor:cursor-move/cursor-updated — deliberately outside the
 * Y.Doc: cursor position is ephemeral view state, not document content,
 * so it's never part of a CRDT update and never persisted.
 *
 * `typingSocketIds` (Phase 5.5) reuses the same editor:user-typing /
 * editor:user-stopped-typing events Presence already consumed as a
 * blunt "someone is typing" boolean — since those events carry a real
 * socketId, and `cursors` is already keyed by socketId, the rendering
 * layer can attribute "is typing" to one specific remote cursor rather
 * than applying it to every peer. No new socket event, no polling.
 *
 * ── Two independent lifecycles ───────────────────────────────────────
 *
 *   1. The Socket.IO connection — created once per editor session
 *      (keyed by `user`) and kept alive across file switches.
 *   2. The per-file room — a fresh Y.Doc is created and the file's
 *      room is joined whenever `fileId` changes; the previous room is
 *      left and its Y.Doc destroyed first. This is what makes
 *      switching files "leave old room, join new room" instead of
 *      reconnecting the whole socket.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   const { connected, peers, getText, replaceText } = useYjs({
 *     fileId: selectedFile?._id,
 *     user,
 *     onDocReady: (doc, fileId) => { ...create/replace MonacoBinding... },
 *   });
 *
 *   `onDocReady` fires once the room's initial document-sync has been
 *   applied to the (freshly created) Y.Doc — i.e. once it already
 *   reflects the file's real content — so the caller can safely bind
 *   Monaco to it without y-monaco's initial sync clobbering the model
 *   back to an empty string.
 *
 *   `isLocalTyping` (Phase 6.4, returned) mirrors the LOCAL user's own
 *   isTyping flag at exactly the moments this hook already emits
 *   TYPING_START/TYPING_STOP (including the debounced stop and the
 *   room-cleanup flush) — added so Editor.jsx can relay the same
 *   already-debounced editing/viewing transition into
 *   useFilePresence.js as its `isEditing` input, instead of that hook
 *   re-deriving typing state from scratch.
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   SOCKET EVENT NAMES — must match backend/src/socket/socketConstants.js
   exactly. (The previous version of this hook used made-up event names
   that never matched the backend, so collaboration never actually
   worked; these are the real ones.)
───────────────────────────────────────────────────────────────────── */
const SOCKET_EVENTS = {
  ROOM_JOIN:           'room:join',
  ROOM_LEAVE:          'room:leave',
  USER_JOINED:         'room:user-joined',
  USER_LEFT:           'room:user-left',
  FILE_CHANGE:         'editor:file-change',
  FILE_UPDATED:        'editor:file-updated',
  DOCUMENT_SYNC:       'editor:document-sync',
  TYPING_START:        'editor:typing-start',
  TYPING_STOP:         'editor:typing-stop',
  USER_TYPING:         'editor:user-typing',
  USER_STOPPED_TYPING: 'editor:user-stopped-typing',
  CURSOR_MOVE:         'editor:cursor-move',
  CURSOR_UPDATED:      'editor:cursor-updated',
};

/* Cap outgoing cursor-position emits to ~30fps (the low end of the
   30-60fps range) so rapid mouse/keyboard cursor movement never floods
   the socket — trailing-edge so the final position is never dropped. */
const CURSOR_THROTTLE_MS = 33;

function createCursorThrottle(fn, wait) {
  let lastRun = 0;
  let timer = null;
  let pendingArg = null;

  const flush = () => {
    timer = null;
    lastRun = Date.now();
    fn(pendingArg);
    pendingArg = null;
  };

  const throttled = (arg) => {
    pendingArg = arg;
    const elapsed = Date.now() - lastRun;
    if (elapsed >= wait) {
      if (timer) { clearTimeout(timer); }
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, wait - elapsed);
    }
  };

  throttled.cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pendingArg = null;
  };

  return throttled;
}

/* Reconnect backoff — same schedule as before: fast first retry,
   capped growth so a genuinely down server isn't hammered. */
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 10000];

/* How long after the last keystroke to tell the room we've stopped
   typing — also what governs how long the Phase 5.5 typing indicator
   (blinking caret / pulsing badge dot) stays on after the last
   keystroke before fading out. */
const TYPING_STOP_DELAY = 1500;

export function useYjs({ fileId, user, onDocReady }) {
  const socketRef = useRef(null);
  const ydocRef   = useRef(null);
  const YRef      = useRef(null); // cached `yjs` module namespace

  /* Set inside the per-file room effect below to a throttled emitter
     bound to the current socket + fileId; cleared on room cleanup.
     Indirected through a ref (rather than returning the throttled
     function directly) so callers always reach the *current* file's
     room instead of a stale closure from a file that's since changed. */
  const sendCursorRef = useRef(null);

  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef   = useRef(null);

  const onDocReadyRef = useRef(onDocReady);
  useEffect(() => { onDocReadyRef.current = onDocReady; }, [onDocReady]);

  const [connected,       setConnected]       = useState(false);
  const [peersRoster,     setPeersRoster]     = useState([]); // [{ userId, name }]
  const [typingSocketIds, setTypingSocketIds] = useState(() => new Set());
  /* Phase 6.4 — see the docstring above for what this is and why. */
  const [isLocalTyping,   setIsLocalTyping]   = useState(false);
  /* Remote live-cursor positions for the current file room, keyed by
     socketId (not userId — each connection has its own caret).
     { [socketId]: { userId, username, position: {lineNumber, column} } } */
  const [cursors, setCursors] = useState({});

  /* The backend's editor:user-typing/stopped-typing events identify the
     typist by socketId, not userId, and peers are keyed by userId (see
     onRoomUsers below) — there's no payload linking the two. With this
     app's small per-file room sizes, "someone besides me is typing" is
     applied to every peer rather than attributed to one specific peer. */
  const peers = useMemo(
    () => peersRoster.map(p => ({ ...p, active: typingSocketIds.size > 0 })),
    [peersRoster, typingSocketIds]
  );

  /* ── Socket connection: one per editor session, independent of
     which file is currently open. Only re-created if the user
     changes (e.g. re-login). ── */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function init() {
      const [Y, socketIOModule] = await Promise.all([
        import('yjs'),
        import('socket.io-client'),
      ]);
      if (cancelled) return;
      YRef.current = Y;

      const { io } = socketIOModule;

      let socket;
      try {
        const token = localStorage.getItem('cg_token');
        socket = io('/', {
          auth:         { token },
          transports:   ['websocket'],
          /* Manual reconnect/backoff below, same as before, for full
             control over `connected` and attempt counting. */
          reconnection: false,
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
    }

    init().catch(err => console.warn('Yjs socket init error:', err));

    return () => {
      cancelled = true;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;

      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user?.id]);

  /* ── Per-file room: a fresh Y.Doc for the currently open file.
     Runs again every time `fileId` changes — the cleanup below leaves
     the previous room and destroys its Y.Doc before the new one joins,
     so switching files never leaves a stale subscription behind. ── */
  useEffect(() => {
    if (!fileId || !connected) return;

    const Y      = YRef.current;
    const socket = socketRef.current;
    if (!Y || !socket) return;

    let cancelled = false;
    const doc = new Y.Doc();
    ydocRef.current = doc;

    function onDocumentSync(update) {
      if (cancelled) return;
      Y.applyUpdate(doc, new Uint8Array(update), 'remote');
      onDocReadyRef.current?.(doc, fileId);
    }

    function onFileUpdated({ update }) {
      if (cancelled) return;
      Y.applyUpdate(doc, new Uint8Array(update), 'remote');
    }

    /* Room membership — USER_JOINED/USER_LEFT both carry the full,
       de-duplicated list of users currently in the room (see backend
       roomManager.getRoomUsers), so each event just replaces `peers`
       wholesale rather than patching it. The current user is excluded
       since Presence renders them separately as "you". */
    function onRoomUsers(users) {
      if (cancelled) return;
      const roster = users || [];
      setPeersRoster(
        roster
          .filter(u => u.userId !== user?.id)
          .map(u => ({ userId: u.userId, name: u.username || u.email }))
      );

      /* A user who is no longer in the room roster can't still have a
         live cursor here — drop it immediately rather than waiting for
         a cursor-specific "they left" event. Covers both an explicit
         room leave and a plain disconnect, since both paths emit
         USER_LEFT with the fresh roster (see socketEvents.js). */
      const stillPresent = new Set(roster.map(u => u.userId));
      let survivingCursorSocketIds; // filled in synchronously by the updater below
      setCursors(prev => {
        let changed = false;
        const next = {};
        for (const [socketId, c] of Object.entries(prev)) {
          if (stillPresent.has(c.userId)) {
            next[socketId] = c;
          } else {
            changed = true;
          }
        }
        survivingCursorSocketIds = new Set(Object.keys(next));
        return changed ? next : prev;
      });

      /* Same idea for the typing indicator (Phase 5.5): USER_TYPING/
         USER_STOPPED_TYPING carry only a socketId, not a userId (see
         onUserTyping/onUserStoppedTyping below), so typingSocketIds has
         no roster of its own to prune against directly. A socket that's
         actively typing is, by definition, also moving its cursor —
         every keystroke shifts the caret — so it will always have a
         live entry in `cursors` while genuinely connected; reusing that
         (just-pruned) socketId set as the source of truth here needs no
         new signal and handles the one real gap in this feature: a hard
         disconnect (crash, network drop) that never gets the chance to
         emit an explicit TYPING_STOP, which would otherwise leave a
         "typing" indicator stuck on for a peer who's no longer there. */
      setTypingSocketIds(prev => {
        if (!survivingCursorSocketIds) return prev;
        let changed = false;
        const next = new Set();
        for (const socketId of prev) {
          if (survivingCursorSocketIds.has(socketId)) {
            next.add(socketId);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    /* Someone else in the room moved their cursor (or selection). Never
       our own — the backend broadcasts via socket.to(roomId), which
       excludes the sender by construction. `cursor` is `{ position,
       selection }` — see Editor.jsx's onDidChangeCursorSelection —
       `selection` is null when it's just a caret, no real selection. */
    function onCursorUpdated({ socketId, userId, username, cursor }) {
      if (cancelled || !cursor?.position) return;
      setCursors(prev => ({
        ...prev,
        [socketId]: { userId, username, position: cursor.position, selection: cursor.selection ?? null },
      }));
    }

    /* Typing indicator — someone else in the room started/stopped
       typing. Tracked by socketId (see peers useMemo above for why). */
    function onUserTyping({ socketId }) {
      if (cancelled) return;
      setTypingSocketIds(prev => {
        if (prev.has(socketId)) return prev;
        const next = new Set(prev);
        next.add(socketId);
        return next;
      });
    }

    function onUserStoppedTyping({ socketId }) {
      if (cancelled) return;
      setTypingSocketIds(prev => {
        if (!prev.has(socketId)) return prev;
        const next = new Set(prev);
        next.delete(socketId);
        return next;
      });
    }

    /* Local typing state — plain closure variables scoped to this
       effect run (a fresh one per file/room join), not refs, since
       they never need to survive past this room's own cleanup. */
    let isTyping = false;
    let typingStopTimer = null;

    /* Every local edit (origin !== 'remote') is broadcast to the room,
       and also drives our own typing-start/stop emissions. */
    function onLocalUpdate(update, origin) {
      if (origin === 'remote') return;
      /* Send the raw Uint8Array — Socket.IO transmits typed arrays as a
         binary attachment. Array.from(update) previously sent a plain
         number array instead, which arrives on the backend without a
         real .buffer/.byteOffset, making Y.applyUpdate throw there
         (see liveUpdateManager.js) and silently drop every remote sync. */
      socket.emit(SOCKET_EVENTS.FILE_CHANGE, { roomId: fileId, update });

      if (!isTyping) {
        isTyping = true;
        socket.emit(SOCKET_EVENTS.TYPING_START, fileId);
        setIsLocalTyping(true);
      }
      if (typingStopTimer) clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => {
        isTyping = false;
        socket.emit(SOCKET_EVENTS.TYPING_STOP, fileId);
        setIsLocalTyping(false);
      }, TYPING_STOP_DELAY);
    }
    doc.on('update', onLocalUpdate);

    socket.on(SOCKET_EVENTS.DOCUMENT_SYNC, onDocumentSync);
    socket.on(SOCKET_EVENTS.FILE_UPDATED, onFileUpdated);
    socket.on(SOCKET_EVENTS.USER_JOINED, onRoomUsers);
    socket.on(SOCKET_EVENTS.USER_LEFT, onRoomUsers);
    socket.on(SOCKET_EVENTS.USER_TYPING, onUserTyping);
    socket.on(SOCKET_EVENTS.USER_STOPPED_TYPING, onUserStoppedTyping);
    socket.on(SOCKET_EVENTS.CURSOR_UPDATED, onCursorUpdated);
    socket.emit(SOCKET_EVENTS.ROOM_JOIN, fileId);

    /* Throttled cursor-position emitter for this file's room. Position
       + (optional) selection metadata only — never editor content —
       and this room's own socket.emit, not a new connection. `cursor`
       is opaque to the backend (see cursorManager.js — it never
       inspects the shape), so carrying `{ position, selection }`
       instead of a flat `{lineNumber, column}` needs no backend or
       socket-event change at all. */
    const throttledSendCursor = createCursorThrottle((cursorData) => {
      socket.emit(SOCKET_EVENTS.CURSOR_MOVE, { roomId: fileId, cursor: cursorData });
    }, CURSOR_THROTTLE_MS);
    sendCursorRef.current = throttledSendCursor;

    return () => {
      cancelled = true;

      doc.off('update', onLocalUpdate);
      if (typingStopTimer) clearTimeout(typingStopTimer);
      if (isTyping) socket.emit(SOCKET_EVENTS.TYPING_STOP, fileId);
      setIsLocalTyping(false);

      socket.off(SOCKET_EVENTS.DOCUMENT_SYNC, onDocumentSync);
      socket.off(SOCKET_EVENTS.FILE_UPDATED, onFileUpdated);
      socket.off(SOCKET_EVENTS.USER_JOINED, onRoomUsers);
      socket.off(SOCKET_EVENTS.USER_LEFT, onRoomUsers);
      socket.off(SOCKET_EVENTS.USER_TYPING, onUserTyping);
      socket.off(SOCKET_EVENTS.USER_STOPPED_TYPING, onUserStoppedTyping);
      socket.off(SOCKET_EVENTS.CURSOR_UPDATED, onCursorUpdated);
      socket.emit(SOCKET_EVENTS.ROOM_LEAVE, fileId);
      setPeersRoster([]);
      setTypingSocketIds(new Set());
      setCursors({});

      throttledSendCursor.cancel();
      if (sendCursorRef.current === throttledSendCursor) sendCursorRef.current = null;

      doc.destroy();
      if (ydocRef.current === doc) ydocRef.current = null;
    };
  }, [fileId, connected, user?.id]);

  /* Stable across renders — always forwards to whichever file's room
     is currently joined (or does nothing if none is). */
  const sendCursor = useCallback((position) => {
    sendCursorRef.current?.(position);
  }, []);

  /* ── getText / replaceText ──
     Read/replace the current file room's shared text. Kept for the
     existing (pre-Phase-4) title/snapshot call sites that already
     expect this shape; text name matches the backend's
     yjsManager.getSharedText ("editor"). */
  const getText = useCallback(() => {
    if (!ydocRef.current) return '';
    return ydocRef.current.getText('editor').toString();
  }, []);

  const replaceText = useCallback((newText) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;

    const ytext = ydoc.getText('editor');
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newText);
    });
  }, []);

  return {
    ydocRef,
    connected,
    peers,
    getText,
    replaceText,
    cursors,
    sendCursor,
    typingSocketIds,
    isLocalTyping,
  };
}

export default useYjs;
