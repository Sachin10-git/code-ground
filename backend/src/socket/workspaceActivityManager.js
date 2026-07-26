const SOCKET_EVENTS = require("./socketConstants");

/**
 * Phase 6.2 — Workspace presence.
 *
 * Mirrors typingManager.js's shape (a thin socket.to() relay), but
 * carries `username` too since the presence banner needs a real name
 * ("Sachin is modifying the project...") rather than typingManager's
 * bare socketId — the editor's typing indicator renders against a
 * cursor it already has a name for, workspace presence has no such
 * companion signal to borrow a name from.
 */
const broadcastActivity = (socket, projectId) => {
  socket.to(projectId).emit(
    SOCKET_EVENTS.WORKSPACE_USER_ACTIVE,
    {
      socketId: socket.id,
      username: socket.user?.username,
    }
  );
};

module.exports = {
  broadcastActivity,
};
