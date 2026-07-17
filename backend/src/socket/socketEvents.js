const SOCKET_EVENTS = require("./socketConstants");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  removeSocketFromAllRooms,
} = require("./roomManager");

    const Y = require("yjs");

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

const {
    getAwareness,
    removeAwareness,
} = require("../crdt/awarenessManager");

const {
    getDocument,
    removeDocument,
} = require("../crdt/yjsManager");
const { loadDocument } = require("../crdt/persistenceManager");

const {
    recoverDocument,
} = require("../crdt/snapshotManager");

const {
    scheduleSnapshot,
    stopSnapshot,
} = require("../crdt/snapshotScheduler");

const {
    clearSaveTimer,
} = require("../crdt/debounceManager");

const {
    createSnapshot,
} = require("../crdt/snapshotManager");

const registerSocketEvents = (io) => {
  io.on(SOCKET_EVENTS.CONNECTION, (socket) => {
    console.log(`Socket Connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.ROOM_JOIN, async (roomId) => {

    joinRoom(socket, roomId);

    const doc = getDocument(roomId);

    const recovered = await recoverDocument(
        roomId,
        doc
    );

    if (!recovered) {
        await loadDocument(roomId, doc);
    }

    /**
     * Start periodic snapshots.
     * Only one scheduler will run per room.
     */
    scheduleSnapshot(
        roomId,
        async () => {
            await createSnapshot(roomId, doc);
        }
    );

    socket.emit(
        SOCKET_EVENTS.DOCUMENT_SYNC,
        Y.encodeStateAsUpdate(doc)
    );

    console.log(`${socket.id} joined ${roomId}`);

    io.to(roomId).emit(
        SOCKET_EVENTS.USER_JOINED,
        getRoomUsers(roomId)
    );

});

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, (roomId) => {

    leaveRoom(socket, roomId);

    const room = io.sockets.adapter.rooms.get(roomId);

    if (!room || room.size === 0) {

        clearSaveTimer(roomId);

        stopSnapshot(roomId);

        removeAwareness(roomId);

        removeDocument(roomId);
    }

    console.log(`${socket.id} left ${roomId}`);

    io.to(roomId).emit(
        SOCKET_EVENTS.USER_LEFT,
        getRoomUsers(roomId)
    );

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
    async ({ roomId, update }) => {

        await broadcastChanges(
            io,
            socket,
            roomId,
            update
        );

    }
);

socket.on(
    SOCKET_EVENTS.AWARENESS_UPDATE,
    ({ roomId, state }) => {

        const awareness = getAwareness(roomId);

        awareness.setLocalStateField(
            socket.id,
            state
        );

        socket.to(roomId).emit(
            SOCKET_EVENTS.AWARENESS_CHANGED,
            {
                socketId: socket.id,
                state,
            }
        );

    }
);

  socket.on("disconnecting", () => {

    const rooms = [...socket.rooms];

    rooms.forEach((roomId) => {

    if (roomId === socket.id) return;

    leaveRoom(socket, roomId);

    // Notify remaining users
    io.to(roomId).emit(
        SOCKET_EVENTS.USER_LEFT,
        getRoomUsers(roomId)
    );

    // Clear awareness
    const awareness = getAwareness(roomId);
    awareness.setLocalState(null);

    // Cleanup empty room
    const room = io.sockets.adapter.rooms.get(roomId);

    if (!room || room.size === 0) {
        clearSaveTimer(roomId);
        stopSnapshot(roomId);
        removeAwareness(roomId);
        removeDocument(roomId);
    }
});

removeSocketFromAllRooms(socket);

    console.log(`Socket Disconnected: ${socket.id}`);

    });
  });
};

module.exports = registerSocketEvents;