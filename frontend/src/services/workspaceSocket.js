/**
 * services/workspaceSocket.js — Phase 6.1 workspace sync transport
 *
 * A thin wrapper around a Socket.IO connection to the `/workspace`
 * namespace — deliberately a *different* namespace (and therefore a
 * different physical connection) than the one useYjs.js opens on the
 * default namespace for editor collaboration. Keeping them on
 * separate namespaces means separate rooms and separate disconnect
 * handling, so workspace sync can never interfere with a Yjs file
 * room (see backend/src/socket/workspaceSocket.js for the server-side
 * rationale).
 *
 * Not a singleton: `useWorkspaceSync` creates one instance per
 * FileExplorer mount and tears it down on unmount, mirroring the
 * lifecycle useYjs already uses for its own connection.
 */

export const WORKSPACE_EVENTS = {
  JOIN:  'workspace:join',
  LEAVE: 'workspace:leave',

  FILE_CREATED: 'workspace:file-created',
  FILE_RENAMED: 'workspace:file-renamed',
  FILE_DELETED: 'workspace:file-deleted',
  FILE_MOVED:   'workspace:file-moved',

  FOLDER_CREATED: 'workspace:folder-created',
  FOLDER_RENAMED: 'workspace:folder-renamed',
  FOLDER_DELETED: 'workspace:folder-deleted',
  FOLDER_MOVED:   'workspace:folder-moved',

  /* Phase 6.2 — workspace presence (see backend/src/socket/socketConstants.js
     for why there's no matching "stop" event). */
  ACTIVITY:    'workspace:activity',
  USER_ACTIVE: 'workspace:user-active',

  /* Phase 6.4 — file presence (see backend/src/socket/socketConstants.js
     for why this reuses the typing indicator's viewing⇄editing pattern
     rather than the per-file Yjs room itself). */
  FILE_PRESENCE:       'workspace:file-presence',
  FILE_PRESENCE_LEAVE: 'workspace:file-presence-leave',
  FILE_PRESENT:        'workspace:file-present',
  FILE_ABSENT:         'workspace:file-absent',
};

export async function createWorkspaceSocket() {
  /* Dynamic import, same as useYjs.js — keeps socket.io-client out of
     the initial bundle and avoids Vite splitting the same dependency
     into two chunks for two different static/dynamic import sites. */
  const { io } = await import('socket.io-client');
  const token = localStorage.getItem('cg_token');
  return io('/workspace', {
    auth:       { token },
    transports: ['websocket'],
    /* Built-in reconnection is fine here (unlike useYjs's manual
       backoff) — workspace events aren't part of a CRDT stream, so a
       brief gap just needs a room rejoin + optional tree resync on
       reconnect, both handled by useWorkspaceSync. */
    reconnection: true,
  });
}

export function joinProjectRoom(socket, projectId) {
  if (!socket || !projectId) return;
  socket.emit(WORKSPACE_EVENTS.JOIN, { projectId });
}

export function leaveProjectRoom(socket, projectId) {
  if (!socket || !projectId) return;
  socket.emit(WORKSPACE_EVENTS.LEAVE, { projectId });
}

/* Phase 6.2 — fire on every local workspace mutation (create/rename/
   delete/move). No debounce here: the receiving end (useWorkspaceSync)
   is what turns a burst of these into a single steady indicator via
   its own expiry timer, so the sender can just ping unconditionally. */
export function reportWorkspaceActivity(socket, projectId) {
  if (!socket || !projectId) return;
  socket.emit(WORKSPACE_EVENTS.ACTIVITY, { projectId });
}

/* Phase 6.4 — announce (or re-announce, e.g. after a reconnect) that
   this socket currently has `fileId` open with the given state
   ('viewing' | 'editing'). Safe to call repeatedly — the backend just
   overwrites this socket's single tracked file/state each time. */
export function announceFilePresence(socket, projectId, fileId, state) {
  if (!socket || !projectId || !fileId) return;
  socket.emit(WORKSPACE_EVENTS.FILE_PRESENCE, { projectId, fileId, state });
}

/* Phase 6.4 — the file is no longer open locally (switched away, or
   the editor/component unmounted). Explicit counterpart to
   announceFilePresence — the backend also self-heals this on a hard
   disconnect (see filePresenceManager.js), so this call is a courtesy
   for the common "still connected, just navigated away" case. */
export function leaveFilePresence(socket, projectId, fileId) {
  if (!socket || !projectId || !fileId) return;
  socket.emit(WORKSPACE_EVENTS.FILE_PRESENCE_LEAVE, { projectId, fileId });
}
