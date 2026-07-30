const { verifyAccessToken } = require("../utils/jwt");
const User = require("../db/models/User");
const SOCKET_EVENTS = require("./socketConstants");
const executionSession = require("../services/execution/executionSession.service");

/**
 * Phase 7 — Interactive Execution Terminal
 *
 * Runs on its own `/terminal` namespace, isolated from the default
 * namespace (Yjs editor collaboration, socketEvents.js) and from
 * `/workspace` (workspaceSocket.js) for the same reason those two are
 * already kept apart from each other: each domain's disconnect/cleanup
 * bookkeeping is specific to what it manages, and mixing them would
 * make one namespace's teardown logic misinterpret another's rooms/
 * connections. A terminal session's lifecycle (one container, one
 * socket - see executionSession.service.js) has nothing to do with
 * either.
 *
 * This file owns socket <-> session wiring only. All Docker
 * orchestration, queueing, metrics, and cleanup logic lives in
 * executionSession.service.js - reused here, not reimplemented.
 */

const terminalAuthMiddleware = async (socket, next) => {
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
      id: user._id.toString(),
      username: user.username,
      email: user.email,
    };

    next();
  } catch (err) {
    next(new Error("Authentication error: invalid or expired token"));
  }
};

const initializeTerminalNamespace = (io) => {
  const terminalNamespace = io.of("/terminal");

  terminalNamespace.use(terminalAuthMiddleware);

  terminalNamespace.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`[terminal] Socket connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.TERMINAL_START, ({ language, code, projectId } = {}) => {
      executionSession.createSession({
        socket,
        language,
        code,
        userId: socket.user?.id,
        projectId,
      });
    });

    /* Ownership check on every one of these: a sessionId is only ever
       honored from the exact socket that created it (see
       executionSession.service.js's isOwnedBy) - this is what keeps
       one user's terminal from being able to type into, resize, or
       stop another user's running session, even if it somehow learned
       that session's id. */
    socket.on(SOCKET_EVENTS.TERMINAL_INPUT, ({ sessionId, data } = {}) => {
      if (!sessionId || typeof data !== "string") return;
      if (!executionSession.isOwnedBy(sessionId, socket.id)) return;
      executionSession.writeInput(sessionId, data);
    });

    socket.on(SOCKET_EVENTS.TERMINAL_RESIZE, ({ sessionId, cols, rows } = {}) => {
      if (!sessionId || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
      if (!executionSession.isOwnedBy(sessionId, socket.id)) return;
      executionSession.resizeSession(sessionId, cols, rows);
    });

    socket.on(SOCKET_EVENTS.TERMINAL_STOP, ({ sessionId } = {}) => {
      if (!sessionId) return;
      if (!executionSession.isOwnedBy(sessionId, socket.id)) return;
      executionSession.stopSession(sessionId, "stopped");
    });

    /* Covers tab close, page refresh, navigation away, and network
       drops - every one of them ends the socket connection without
       ever giving the client a chance to emit TERMINAL_STOP first.
       Without this, a session's container would keep running for its
       full SESSION_TIMEOUT_MS (up to several minutes) with nobody
       ever going to see its output or send it input. */
    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
      console.log(`[terminal] Socket disconnected: ${socket.id}`);
      executionSession.cleanupSocketSessions(socket.id).catch((err) => {
        console.error("[terminal] Error cleaning up sessions on disconnect:", err);
      });
    });
  });

  return terminalNamespace;
};

module.exports = { initializeTerminalNamespace };
