const SOCKET_EVENTS = require("./socketConstants");

const registerSocketEvents = (io) => {
  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`Socket Connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
      console.log(`Socket Disconnected: ${socket.id}`);
    });
  });
};

module.exports = registerSocketEvents;