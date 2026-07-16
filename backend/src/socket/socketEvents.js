const SOCKET_EVENTS = require("./socketConstants");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  removeSocketFromAllRooms,
} = require("./roomManager");

const {
    startTyping,
    stopTyping,
} = require("./typingManager");

const {
    updateCursor,
} = require("./cursorManager");

const {
    updateSelection,
} = require("./selectionManager");

const {
    lockFile,
    unlockFile,
} = require("./fileLockManager");

const {
    broadcastChanges,
} = require("./liveUpdateManager");

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

    socket.on(SOCKET_EVENTS.TYPING_START, (roomId) => {
      console.log("Typing event received:", roomId);
    startTyping(io, socket, roomId);
});

  socket.on(SOCKET_EVENTS.TYPING_STOP, (roomId) => {
        console.log("Typing STOP event received:", roomId);
      stopTyping(io, socket, roomId);
  });

socket.on(
    SOCKET_EVENTS.CURSOR_MOVE,
    ({ roomId, cursor }) => {

        console.log("CURSOR_MOVE received");
        console.log(roomId);
        console.log(cursor);

        updateCursor(io, socket, roomId, cursor);
    }
);

  socket.on(
    SOCKET_EVENTS.SELECTION_CHANGE,
    ({ roomId, selection }) => {
        updateSelection(io, socket, roomId, selection);
    }
);

  socket.on(
    SOCKET_EVENTS.FILE_LOCK,
    ({ roomId, fileId }) => {
        lockFile(io, socket, roomId, fileId);
    }
);

  socket.on(
    SOCKET_EVENTS.FILE_UNLOCK,
    ({ roomId, fileId }) => {
        unlockFile(io, socket, roomId, fileId);
    }
);

  socket.on(
    SOCKET_EVENTS.FILE_CHANGE,
    ({ roomId, change }) => {

        broadcastChanges(
            io,
            socket,
            roomId,
            change
        );

    }
);

  socket.on(SOCKET_EVENTS.DISCONNECT, () => {
    removeSocketFromAllRooms(socket);
    console.log(`Socket Disconnected: ${socket.id}`);
});
  });
};

module.exports = registerSocketEvents;