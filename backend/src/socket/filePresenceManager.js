const SOCKET_EVENTS = require("./socketConstants");

/**
 * Phase 6.4 — File Presence.
 *
 * Tracks, per `/workspace` socket, which single file it currently has
 * "present" (viewing or editing) — in memory only, exactly like
 * roomManager.js does for the default namespace's per-file rooms, and
 * for the same reason: presence is only ever true "while connected"
 * (see socketConstants.js), so nothing here should ever reach a
 * database.
 *
 * One entry per socket (not per file) since a browser tab only ever
 * has one file open in the editor at a time; this also makes the
 * disconnect cleanup trivial — one lookup, one broadcast, no need to
 * scan `socket.rooms`.
 */
const socketPresence = new Map(); // socketId -> { projectId, fileId, state, username }

const setPresence = (socket, projectId, fileId, state) => {
  const prev = socketPresence.get(socket.id);

  /* A client that jumps straight to a new file's WORKSPACE_FILE_PRESENCE
     without first sending WORKSPACE_FILE_PRESENCE_LEAVE for the old one
     (shouldn't happen — see useFilePresence.js — but self-healing here
     costs nothing) would otherwise leave the old file's badge stuck. */
  if (prev && prev.fileId !== fileId) {
    clearPresence(socket, prev.projectId, prev.fileId);
  }

  socketPresence.set(socket.id, { projectId, fileId, state, username: socket.user?.username });

  socket.to(projectId).emit(SOCKET_EVENTS.WORKSPACE_FILE_PRESENT, {
    socketId: socket.id,
    username: socket.user?.username,
    fileId,
    state,
  });
};

/**
 * Everyone currently present in `projectId`, across every file —
 * used to snapshot a newly-JOINed socket up to date (see
 * workspaceSocket.js's WORKSPACE_JOIN handler). Without this, a user
 * who opens the project *after* a collaborator already has a file
 * open would never learn about that existing presence: `setPresence`
 * above only broadcasts on a *change*, and a late joiner wasn't in
 * the room to receive that broadcast when it happened.
 */
const getProjectPresence = (projectId) => {
  const entries = [];
  for (const [socketId, entry] of socketPresence.entries()) {
    if (entry.projectId !== projectId) continue;
    entries.push({
      socketId, username: entry.username, fileId: entry.fileId, state: entry.state,
    });
  }
  return entries;
};

const clearPresence = (socket, projectId, fileId) => {
  const prev = socketPresence.get(socket.id);
  if (!prev || prev.fileId !== fileId) return;

  socketPresence.delete(socket.id);

  socket.to(projectId).emit(SOCKET_EVENTS.WORKSPACE_FILE_ABSENT, {
    socketId: socket.id,
    fileId,
  });
};

/**
 * Called from the namespace's "disconnecting" handler (fired while
 * the socket is still attached to its rooms — same event
 * socketEvents.js already uses for the equivalent default-namespace
 * cleanup) — a hard disconnect (crash, tab close, network drop) never
 * gets the chance to emit an explicit WORKSPACE_FILE_PRESENCE_LEAVE,
 * so this is what guarantees presence doesn't outlive the connection.
 */
const clearAllPresenceForSocket = (socket) => {
  const prev = socketPresence.get(socket.id);
  if (!prev) return;

  socketPresence.delete(socket.id);

  socket.to(prev.projectId).emit(SOCKET_EVENTS.WORKSPACE_FILE_ABSENT, {
    socketId: socket.id,
    fileId: prev.fileId,
  });
};

module.exports = {
  setPresence,
  clearPresence,
  clearAllPresenceForSocket,
  getProjectPresence,
};
