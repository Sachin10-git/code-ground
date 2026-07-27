/**
 * hooks/useFilePresence.js — Phase 6.4: file presence & conflict
 * awareness
 *
 * Shares the same `/workspace` connection as useWorkspaceSync and
 * useTeamChat (see acquireWorkspaceSocket in services/workspaceSocket.js)
 * — deliberately still separate from useYjs's per-file Yjs connection,
 * which lives on the default namespace for unrelated reasons (CRDT sync
 * vs. project-room broadcasts).
 *

 * Called once from Editor.jsx (the page that already knows both the
 * `projectId` and whichever `fileId` is currently open), not from
 * FileExplorer — the Explorer needs presence for EVERY file in the
 * project, not just the open one, so the single source of truth lives
 * here and is threaded down as a prop, the same way Editor.jsx already
 * threads `selectedFileId`/`onSelectFile` down.
 *
 * ── Two responsibilities ─────────────────────────────────────────────
 *
 *   1. ANNOUNCE — tell everyone else in the project which file *this*
 *      user has open, and whether they're currently typing in it
 *      (`isEditing`, driven by useYjs's `isLocalTyping`). A file-open
 *      is an explicit start/leave pair (WORKSPACE_FILE_PRESENCE /
 *      _LEAVE) — unlike typing, "viewing a file" has no natural
 *      timeout, so there's nothing to debounce. The editing⇄viewing
 *      transition for whichever file is already open reuses useYjs's
 *      own already-debounced isTyping flag rather than re-implementing
 *      a second decay timer.
 *
 *   2. LISTEN — maintain `filePresence`, a live
 *      `{ [fileId]: { [socketId]: { username, state } } }` map built
 *      from every OTHER project member's announcements (the backend
 *      excludes the sender via `socket.to()`, so the current user is
 *      never present in their own map — see FUNCTIONAL REQUIREMENTS,
 *      "the current user should not be shown").
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   const { filePresence } = useFilePresence({
 *     projectId, fileId: selectedFileId, isEditing: isLocalTyping,
 *   });
 */

import { useRef, useState, useEffect } from 'react';
import {
  acquireWorkspaceSocket,
  releaseWorkspaceSocket,
  joinProjectRoom,
  leaveProjectRoom,
  announceFilePresence,
  leaveFilePresence,
  WORKSPACE_EVENTS,
} from '../services/workspaceSocket.js';

export function useFilePresence({ projectId, fileId, isEditing }) {
  const socketRef = useRef(null);

  const [filePresence, setFilePresence] = useState({});

  /* Connection lifecycle — acquires the shared `/workspace` socket for
     the lifetime of the editor page (mirrors useWorkspaceSync's
     connect-once-then-join-per-project split), releasing it on
     unmount. */
  const [socketReadyTick, forceRoomEffect] = useState(0);
  useEffect(() => {
    let cancelled = false;

    acquireWorkspaceSocket().then((socket) => {
      if (cancelled) {
        releaseWorkspaceSocket();
        return;
      }
      socketRef.current = socket;
      forceRoomEffect((n) => n + 1);
    });

    return () => {
      cancelled = true;
      if (socketRef.current) releaseWorkspaceSocket();
      socketRef.current = null;
    };
  }, []);

  /* Project room membership + presence-update subscriptions — these
     cover every file in the project, not just the open one, so this
     effect is keyed on `projectId` alone (not `fileId`). */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    if (socket.connected) joinProjectRoom(socket, projectId);
    function handleConnect() { joinProjectRoom(socket, projectId); }

    function onPresent({ socketId, username, fileId: fid, state }) {
      if (!socketId || !fid) return;
      setFilePresence((prev) => ({
        ...prev,
        [fid]: { ...(prev[fid] || {}), [socketId]: { username, state } },
      }));
    }

    function onAbsent({ socketId, fileId: fid }) {
      if (!socketId || !fid) return;
      setFilePresence((prev) => {
        if (!prev[fid] || !(socketId in prev[fid])) return prev;
        const bucket = { ...prev[fid] };
        delete bucket[socketId];
        return { ...prev, [fid]: bucket };
      });
    }

    socket.on('connect', handleConnect);
    socket.on(WORKSPACE_EVENTS.FILE_PRESENT, onPresent);
    socket.on(WORKSPACE_EVENTS.FILE_ABSENT, onAbsent);

    return () => {
      socket.off('connect', handleConnect);
      socket.off(WORKSPACE_EVENTS.FILE_PRESENT, onPresent);
      socket.off(WORKSPACE_EVENTS.FILE_ABSENT, onAbsent);
      leaveProjectRoom(socket, projectId);
      setFilePresence({});
    };
  }, [projectId, socketReadyTick]);

  /* Announce presence for whichever file is open. `isEditingRef` lets
     the reconnect handler re-announce the *current* editing state
     without this effect re-running on every typing on/off toggle —
     that's handled by the separate effect below, which only sends an
     update, never a fresh "viewing" open / LEAVE close. */
  const isEditingRef = useRef(isEditing);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId || !fileId) return;

    const announce = () => announceFilePresence(
      socket, projectId, fileId, isEditingRef.current ? 'editing' : 'viewing',
    );

    if (socket.connected) announce();
    socket.on('connect', announce);

    return () => {
      socket.off('connect', announce);
      leaveFilePresence(socket, projectId, fileId);
    };
  }, [projectId, fileId, socketReadyTick]);

  /* Re-announce whenever the editing flag itself flips for the file
     that's already open — deliberately its own effect (not folded
     into the one above) so a typing start/stop never triggers a
     LEAVE/re-open of the view presence, which would flicker the
     viewer badge for every other collaborator on every keystroke. */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !projectId || !fileId) return;
    announceFilePresence(socket, projectId, fileId, isEditing ? 'editing' : 'viewing');
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately narrow, see comment above

  return { filePresence };
}

export default useFilePresence;
