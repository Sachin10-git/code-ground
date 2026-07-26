const { Server } = require("socket.io");
const registerSocketEvents = require("./socketEvents");
const { verifyAccessToken } = require("../utils/jwt");
const User = require("../db/models/User");
const { initializeWorkspaceNamespace } = require("./workspaceSocket");

let io;

/**
 * Authenticate the Socket.IO handshake using the same JWT access
 * token the REST API expects (see middleware/authenticate.js), and
 * attach the resolved user identity to the socket so downstream room
 * logic (roomManager.js) can expose real usernames instead of raw
 * socket ids.
 */
const socketAuthMiddleware = async (socket, next) => {
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

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Change to frontend URL later
      methods: ["GET", "POST"],
    },
  });

  io.use(socketAuthMiddleware);

  registerSocketEvents(io);
  initializeWorkspaceNamespace(io);

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }

  return io;
};

module.exports = {
  initializeSocket,
  getIO,
};