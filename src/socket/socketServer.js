const { Server } = require("socket.io");
const registerSocketEvents = require("./socketEvents");

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Change to frontend URL later
      methods: ["GET", "POST"],
    },
  });

  registerSocketEvents(io);

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