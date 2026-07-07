const SOCKET_EVENTS = require("./socketConstants");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
} = require("./roomManager");

const registerSocketEvents = (io) => {
  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`Socket Connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.ROOM_JOIN, (roomId) => {
      joinRoom(socket, roomId);

      console.log(`${socket.id} joined ${roomId}`);

      io.to(roomId).emit(
        SOCKET_EVENTS.USER_JOINED,
        getRoomUsers(roomId)
      );
    });

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, (roomId) => {
      leaveRoom(socket, roomId);

      console.log(`${socket.id} left ${roomId}`);

      io.to(roomId).emit(
        SOCKET_EVENTS.USER_LEFT,
        getRoomUsers(roomId)
      );
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
      console.log(`Socket Disconnected: ${socket.id}`);
    });
  });
};

module.exports = registerSocketEvents;