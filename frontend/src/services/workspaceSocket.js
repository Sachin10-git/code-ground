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
 * A ref-counted singleton (Phase 6.0 — Team Chat): useWorkspaceSync
 * (FileExplorer) and useTeamChat (TeamChatPanel) both need this same
 * `/workspace` connection and the same project room at once — opening
 * a second physical connection per consumer would double auth
 * handshakes and room-join traffic for no reason, and the product spec
 * explicitly calls for reusing one connection. acquireWorkspaceSocket
 * hands out the same connection to every caller and only tears it down
 * once the last caller releases it; see useWorkspaceSync.js/
 * useTeamChat.js for the acquire-on-mount/release-on-unmount lifecycle
 * both hooks share.
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

  /* Phase 6.6 — file locking's project-wide echo (see
     backend/src/socket/socketConstants.js for why this is separate
     from the per-file-room lock events useYjs.js listens for). */
  FILE_LOCKED:   'workspace:file-locked',
  FILE_UNLOCKED: 'workspace:file-unlocked',

  /* Phase 6.0 — Team Chat (see backend/src/socket/socketConstants.js
     for why this reuses the WORKSPACE_JOIN room instead of a separate
     "join chat" step). */
  TEAM_CHAT_SEND:    'team-chat:send',
  TEAM_CHAT_MESSAGE: 'team-chat:message',
  TEAM_CHAT_HISTORY: 'team-chat:history',
};

async function connectWorkspaceSocket() {
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
       reconnect, both handled by useWorkspaceSync/useTeamChat. */
    reconnection: true,
  });
}

/* ── Ref-counted singleton ────────────────────────────────────────────
   Every consumer calls acquireWorkspaceSocket() on mount and
   releaseWorkspaceSocket() on unmount. The first acquire opens the
   connection; the promise is cached so concurrent acquires (both hooks
   mounting in the same tick) await the *same* connection instead of
   opening two. The last release disconnects it. In this app,
   FileExplorer and the right-sidebar TeamChatPanel mount/unmount
   together with the Editor page, so refCount only ever swings between
   0 and however many consumers are on screen at once — never left
   dangling. */
let sharedSocket = null;
let sharedSocketPromise = null;
let refCount = 0;

export async function acquireWorkspaceSocket() {
  refCount += 1;
  if (!sharedSocketPromise) {
    sharedSocketPromise = connectWorkspaceSocket().then((socket) => {
      sharedSocket = socket;
      return socket;
    });
  }
  return sharedSocketPromise;
}

export function releaseWorkspaceSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;

  /* Last consumer gone — tear the connection down once it's done
     connecting (it may still be mid-handshake if release races the
     initial connect). */
  const pending = sharedSocketPromise;
  sharedSocket = null;
  sharedSocketPromise = null;
  pending?.then((socket) => {
    /* A new acquire may have raced in and started a fresh connection
       after this one was cleared above — only disconnect the specific
       socket THIS release call was responsible for tearing down. */
    if (socket !== sharedSocket) socket.disconnect();
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

/* Phase 6.0 — Team Chat send. No optimistic local echo — the server
   broadcasts the persisted message back to the sender too (see
   backend/src/socket/workspaceSocket.js), so useTeamChat's message
   list is always built from that one round trip rather than a local
   guess reconciled against it later. */
export function sendChatMessage(socket, projectId, message) {
  if (!socket || !projectId || !message) return;
  socket.emit(WORKSPACE_EVENTS.TEAM_CHAT_SEND, { projectId, message });
}
