const { verifyAccessToken } = require("../utils/jwt");
const User = require("../db/models/User");
const projectService = require("../services/projectService");
const SOCKET_EVENTS = require("./socketConstants");
const { broadcastActivity } = require("./workspaceActivityManager");
const {
  setPresence,
  clearPresence,
  clearAllPresenceForSocket,
  getProjectPresence,
} = require("./filePresenceManager");

const VALID_PRESENCE_STATES = new Set(["viewing", "editing"]);

/**
 * Phase 6.1 — Workspace Synchronization
 *
 * Runs on its own Socket.IO namespace (`/workspace`), completely
 * separate from the default namespace Phase 5 uses for Yjs editor
 * collaboration (see socketEvents.js). Kept isolated deliberately:
 * that file's ROOM_LEAVE/"disconnecting" handlers treat every room a
 * socket has joined as a per-file Yjs room and run CRDT save/cleanup
 * logic against it — joining a project-id room on the same connection
 * would corrupt that bookkeeping. A separate namespace means a
 * separate connection, separate rooms, and separate disconnect
 * handling, so the two collaboration domains can never interfere.
 */

let workspaceNamespace;

const workspaceAuthMiddleware = async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: no token provided"));
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select("username email");

    if (!user) {
      return next(new Error("Authentication error: user not found"));
    }

    socket.user = {
      id:       user._id.toString(),
      username: user.username,
      email:    user.email,
    };

    next();
  } catch (err) {
    next(new Error("Authentication error: invalid or expired token"));
  }
};

const initializeWorkspaceNamespace = (io) => {
  workspaceNamespace = io.of("/workspace");

  workspaceNamespace.use(workspaceAuthMiddleware);

  workspaceNamespace.on(SOCKET_EVENTS.CONNECTION, (socket) => {

    socket.on(SOCKET_EVENTS.WORKSPACE_JOIN, async ({ projectId } = {}) => {
      if (!projectId) return;

      const isMember = await projectService.isProjectMember(
        projectId,
        socket.user.id
      );

      if (!isMember) return;

      socket.join(projectId);

      /* Phase 6.4 — catch this socket up on presence that was
         already announced by other members before it joined (see
         getProjectPresence's docstring). Sent directly to this
         socket only — everyone else already knows about their own
         presence. */
      for (const entry of getProjectPresence(projectId)) {
        socket.emit(SOCKET_EVENTS.WORKSPACE_FILE_PRESENT, entry);
      }
    });

    socket.on(SOCKET_EVENTS.WORKSPACE_LEAVE, ({ projectId } = {}) => {
      if (!projectId) return;
      socket.leave(projectId);
    });

    /* Phase 6.2 — workspace presence ping. Guarded by room membership
       (not another isProjectMember DB round-trip) since WORKSPACE_JOIN
       already checked it before letting this socket into the room —
       a socket that never joined `projectId` has no business pinging
       it. */
    socket.on(SOCKET_EVENTS.WORKSPACE_ACTIVITY, ({ projectId } = {}) => {
      if (!projectId || !socket.rooms.has(projectId)) return;
      broadcastActivity(socket, projectId);
    });

    /* Phase 6.4 — file presence. Same room-membership guard as
       WORKSPACE_ACTIVITY above, plus a `state` whitelist since this
       value gets echoed straight into the UI's "viewing"/"editing"
       label for every other client in the project. */
    socket.on(SOCKET_EVENTS.WORKSPACE_FILE_PRESENCE, ({ projectId, fileId, state } = {}) => {
      if (!projectId || !fileId || !socket.rooms.has(projectId)) return;
      if (!VALID_PRESENCE_STATES.has(state)) return;
      setPresence(socket, projectId, fileId, state);
    });

    socket.on(SOCKET_EVENTS.WORKSPACE_FILE_PRESENCE_LEAVE, ({ projectId, fileId } = {}) => {
      if (!projectId || !fileId || !socket.rooms.has(projectId)) return;
      clearPresence(socket, projectId, fileId);
    });

    /* Phase 6.4 needs to know when a socket disconnects (to clear its
       file presence — see filePresenceManager.js); "disconnecting"
       fires while the socket is still attached to its rooms, same
       event socketEvents.js uses for the equivalent default-namespace
       cleanup. Nothing else in this namespace needs it — workspace
       sync/activity/presence-ping all have no per-socket state to
       tear down beyond what Socket.IO already does automatically. */
    socket.on("disconnecting", () => {
      clearAllPresenceForSocket(socket);
    });
  });

  return workspaceNamespace;
};

const getWorkspaceNamespace = () => {
  if (!workspaceNamespace) {
    throw new Error("Workspace socket namespace not initialized");
  }

  return workspaceNamespace;
};

module.exports = {
  initializeWorkspaceNamespace,
  getWorkspaceNamespace,
};
