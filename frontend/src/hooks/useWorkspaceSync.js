/**
 * hooks/useWorkspaceSync.js — Phase 6.1
 *
 * Owns the `/workspace` Socket.IO connection for a mounted
 * FileExplorer: connects once on mount, joins/leaves the current
 * project's room as `projectId` changes, subscribes to the 8
 * workspace mutation events, and disconnects fully on unmount.
 * Deliberately separate from useYjs.js — a different namespace, a
 * different connection, no shared state — so workspace sync can
 * never regress editor collaboration.
 *
 * Every event payload is forwarded verbatim to the matching callback;
 * the caller (FileExplorer) is responsible for applying it to tree
 * state via workspaceTreeUtils, whose functions are idempotent, so
 * duplicate/self-echoed events are always safe.
 *
 * Phase 6.2 adds workspace presence: returns `activeUsers` (a live
 * `{ [socketId]: username }` map of peers currently modifying the
 * project) and `reportActivity()`, which the caller invokes after
 * every local mutation to let peers know about it.
 *
 * Phase 6.3 adds the activity feed: returns `activity`, a newest-first
 * array (capped at ACTIVITY_LOG_LIMIT) built from the same 8 mutation
 * events this hook already subscribes to for tree sync — no separate
 * subscription, no new socket traffic.
 *
 * Phase 6.4 persists that feed server-side (WorkspaceActivity model,
 * `GET /projects/:projectId/activity`). On project open this hook
 * fetches the latest 100 records and seeds `activity` with them; the
 * 8 live listeners below are attached on exactly the same schedule
 * they always were (tree sync must never wait on an activity fetch —
 * see the module docstring's separation-of-concerns note), so any
 * mutation that lands while the fetch is still in flight is buffered
 * in `pendingActivityRef` and merged in once the fetch resolves,
 * rather than being silently overwritten by it.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import api from '../utils/api.js';
import {
  createWorkspaceSocket,
  joinProjectRoom,
  leaveProjectRoom,
  reportWorkspaceActivity,
  WORKSPACE_EVENTS,
} from '../services/workspaceSocket.js';

/* Phase 6.2 — how long a peer stays "active" after their last activity
   ping with no follow-up. ~2s per the product spec; also doubles as
   the disconnect/crash recovery window, since a peer who vanishes
   mid-edit just stops pinging rather than emitting an explicit
   "stopped" event (see socketConstants.js). */
const ACTIVITY_EXPIRY_MS = 2000;

/* Phase 6.3 — activity feed cap. Older entries are dropped as new ones
   arrive (see recordActivity below), never trimmed by a separate pass. */
const ACTIVITY_LOG_LIMIT = 100;

/* Phase 6.4 — maps a persisted WorkspaceActivity record (backend
   models/workspaceactivity.js, via GET /projects/:projectId/activity)
   into the same entry shape recordActivity builds for a live event,
   so ActivityFeed.jsx never has to know which source an entry came
   from. */
function mapPersistedActivity(record) {
  return {
    id: record._id,
    type: record.targetType,
    operation: record.operation,
    name: record.targetName,
    username: record.username,
    oldName: record.oldName,
    newName: record.newName,
    timestamp: new Date(record.createdAt).getTime(),
  };
}

export function useWorkspaceSync({
  projectId,
  onResync,
  onFileCreated,
  onFileRenamed,
  onFileDeleted,
  onFileMoved,
  onFolderCreated,
  onFolderRenamed,
  onFolderDeleted,
  onFolderMoved,
}) {
  const socketRef = useRef(null);

  /* Phase 6.2 — workspace presence: { [socketId]: username } for peers
     currently "active" (pinged within the last ACTIVITY_EXPIRY_MS).
     One expiry timer per socketId, tracked outside React state since
     timer ids aren't render data. */
  const [activeUsers, setActiveUsers] = useState({});
  const activityTimersRef = useRef({});

  const clearActivityTimers = () => {
    for (const timerId of Object.values(activityTimersRef.current)) {
      clearTimeout(timerId);
    }
    activityTimersRef.current = {};
  };

  /* Phase 6.3 — activity feed. `id` is a simple monotonic counter
     (not the event's own file/folder _id, which repeats across a
     file's create/rename/move/delete entries and can't be a React
     key here) rather than Date.now()-based, since two mutations can
     land within the same millisecond. Prefixed 'live-' so it can
     never collide with a persisted record's Mongo _id (also used as
     `id` — see mapPersistedActivity) once the two are merged. */
  const [activity, setActivity] = useState([]);
  const activityIdRef = useRef(0);

  /* Phase 6.4 — while the history fetch for the current project is
     still in flight, live entries are held here (newest-first, same
     order as `activity` itself) instead of going straight into state;
     the fetch's .then() below prepends them once it resolves so
     nothing arrives out of order or gets clobbered by the fetch's
     setActivity(history) call. */
  const historyLoadedRef = useRef(false);
  const pendingActivityRef = useRef([]);

  const recordActivity = useCallback((type, operation, payload) => {
    if (!payload?.name) return;
    activityIdRef.current += 1;
    const entry = {
      id: `live-${activityIdRef.current}`,
      type,
      operation,
      name: payload.name,
      username: payload.username || 'Someone',
      oldName: payload.oldName,
      newName: payload.newName,
      timestamp: Date.now(),
    };

    if (!historyLoadedRef.current) {
      pendingActivityRef.current = [entry, ...pendingActivityRef.current];
      return;
    }
    setActivity((prev) => [entry, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
  }, []);

  const callbacksRef = useRef({});
  useEffect(() => {
    callbacksRef.current = {
      onResync, onFileCreated, onFileRenamed, onFileDeleted, onFileMoved,
      onFolderCreated, onFolderRenamed, onFolderDeleted, onFolderMoved,
    };
  }, [
    onResync, onFileCreated, onFileRenamed, onFileDeleted, onFileMoved,
    onFolderCreated, onFolderRenamed, onFolderDeleted, onFolderMoved,
  ]);

  /* Connection lifecycle — one socket per FileExplorer mount, kept
     alive across project switches (mirrors useYjs's connection/room
     split: connect once, then join/leave rooms as the target changes).
     Socket creation is async (dynamic import), so a cancelled flag
     guards against the component unmounting before it resolves. */
  const [socketReadyTick, forceRoomEffect] = useState(0);
  useEffect(() => {
    let cancelled = false;

    createWorkspaceSocket().then((socket) => {
      if (cancelled) {
        socket.disconnect();
        return;
      }
      socketRef.current = socket;
      /* The room-join effect below may have already run (and no-oped,
         since socketRef.current was still null) before this resolved
         — nudge it to re-run now that there's a real socket. */
      forceRoomEffect((n) => n + 1);
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  /* Project room membership + event subscriptions — re-run whenever
     the project changes: leaves the previous room, removes its
     listeners, joins the new one. */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    let hasConnectedBefore = socket.connected;
    if (socket.connected) {
      joinProjectRoom(socket, projectId);
    }

    function handleConnect() {
      joinProjectRoom(socket, projectId);
      /* A reconnect (not the initial connect) may have missed events
         while the socket was down — resync the whole tree as a
         correctness net rather than trying to replay history. */
      if (hasConnectedBefore) {
        callbacksRef.current.onResync?.();
      }
      hasConnectedBefore = true;
    }

    /* Phase 6.2 — a peer's activity ping (re)starts their own expiry
       timer; unrelated peers' timers are untouched. */
    function onUserActive({ socketId, username }) {
      if (!socketId || !username) return;

      setActiveUsers((prev) => (
        prev[socketId] === username ? prev : { ...prev, [socketId]: username }
      ));

      clearTimeout(activityTimersRef.current[socketId]);
      activityTimersRef.current[socketId] = setTimeout(() => {
        delete activityTimersRef.current[socketId];
        setActiveUsers((prev) => {
          if (!(socketId in prev)) return prev;
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
      }, ACTIVITY_EXPIRY_MS);
    }

    const handlers = {
      [WORKSPACE_EVENTS.FILE_CREATED]:   (payload) => { callbacksRef.current.onFileCreated?.(payload); recordActivity('file', 'created', payload); },
      [WORKSPACE_EVENTS.FILE_RENAMED]:   (payload) => { callbacksRef.current.onFileRenamed?.(payload); recordActivity('file', 'renamed', payload); },
      [WORKSPACE_EVENTS.FILE_DELETED]:   (payload) => { callbacksRef.current.onFileDeleted?.(payload); recordActivity('file', 'deleted', payload); },
      [WORKSPACE_EVENTS.FILE_MOVED]:     (payload) => { callbacksRef.current.onFileMoved?.(payload); recordActivity('file', 'moved', payload); },
      [WORKSPACE_EVENTS.FOLDER_CREATED]: (payload) => { callbacksRef.current.onFolderCreated?.(payload); recordActivity('folder', 'created', payload); },
      [WORKSPACE_EVENTS.FOLDER_RENAMED]: (payload) => { callbacksRef.current.onFolderRenamed?.(payload); recordActivity('folder', 'renamed', payload); },
      [WORKSPACE_EVENTS.FOLDER_DELETED]: (payload) => { callbacksRef.current.onFolderDeleted?.(payload); recordActivity('folder', 'deleted', payload); },
      [WORKSPACE_EVENTS.FOLDER_MOVED]:   (payload) => { callbacksRef.current.onFolderMoved?.(payload); recordActivity('folder', 'moved', payload); },
      [WORKSPACE_EVENTS.USER_ACTIVE]:    onUserActive,
    };

    socket.on('connect', handleConnect);
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);

    /* Phase 6.4 — load this project's persisted history. Deliberately
       kicked off *after* the listeners above are already attached
       (not before/gating them) so tree sync's responsiveness is
       exactly what it was pre-6.4; any live activity that lands
       before this resolves is buffered by recordActivity above and
       merged in below instead of being lost. */
    let cancelled = false;
    historyLoadedRef.current = false;
    pendingActivityRef.current = [];

    api.get(`/projects/${projectId}/activity`)
      .then(({ data }) => {
        if (cancelled) return;
        const history = (data.data ?? []).map(mapPersistedActivity);
        const pending = pendingActivityRef.current;
        pendingActivityRef.current = [];
        historyLoadedRef.current = true;
        setActivity([...pending, ...history].slice(0, ACTIVITY_LOG_LIMIT));
      })
      .catch((err) => {
        console.error('[useWorkspaceSync] Failed to load activity history:', err);
        if (cancelled) return;
        const pending = pendingActivityRef.current;
        pendingActivityRef.current = [];
        historyLoadedRef.current = true;
        if (pending.length) setActivity((prev) => [...pending, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
      });

    return () => {
      cancelled = true;
      socket.off('connect', handleConnect);
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      leaveProjectRoom(socket, projectId);

      /* Leaving the room (project switch/unmount) invalidates any
         peers we thought were active in it. */
      clearActivityTimers();
      setActiveUsers({});

      /* Phase 6.4 — the *next* project's effect run fetches its own
         history and repopulates `activity`; until then (and for a
         plain unmount) there's nothing to show. */
      historyLoadedRef.current = false;
      pendingActivityRef.current = [];
      setActivity([]);
    };
  }, [projectId, socketReadyTick, recordActivity]);

  const reportActivity = useCallback(() => {
    reportWorkspaceActivity(socketRef.current, projectId);
  }, [projectId]);

  return { activeUsers, reportActivity, activity };
}
