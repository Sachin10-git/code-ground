const SOCKET_EVENTS = require("./socketConstants");
const { DEBUG_COLLAB } = require("../utils/debugFlags");
const {
  joinRoom,
  leaveRoom,
  getRoomUsers,
  removeSocketFromAllRooms,
} = require("./roomManager");

    const Y = require("yjs");
    const File = require("../models/file");

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
    getSharedText,
    removeDocument,
} = require("../crdt/yjsManager");
const { loadDocument, saveDocument } = require("../crdt/persistenceManager");

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

/**
 * Phase 5 bridge: a file's collaboration room has no history the very
 * first time it's joined (no CRDTSnapshot / CRDTDocument yet), so its
 * Y.Doc starts empty. Seed it once from the File's REST-persisted
 * `content` (Phase 4) so collaborators see the real file instead of a
 * blank document. Guarded by an in-flight-promise map so two users
 * opening the same brand-new room at once can't both insert the seed
 * text (which would duplicate it) — the map's get/set happen with no
 * `await` between them, so concurrent joins always share one promise.
 */
const fileSeedPromises = new Map();

const ensureFileSeed = async (roomId, doc) => {

    const sharedText = getSharedText(roomId);

    if (sharedText.length > 0) return;

    if (!fileSeedPromises.has(roomId)) {

        fileSeedPromises.set(
            roomId,
            File.findById(roomId)
                .select("content")
                .then((file) => {
                    if (file?.content && sharedText.length === 0) {
                        doc.transact(() => {
                            sharedText.insert(0, file.content);
                        });
                    }
                })
                .catch((err) => {
                    console.error("[CRDT] Failed to seed room from file content:", err);
                })
        );

    }

    return fileSeedPromises.get(roomId);

};

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

    await ensureFileSeed(roomId, doc);

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

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, async (roomId) => {

    leaveRoom(socket, roomId);

    const room = io.sockets.adapter.rooms.get(roomId);

    if (!room || room.size === 0) {

        /* Cancel the pending debounced save, then flush the room's
           in-memory Y.Doc to CRDTDocument ourselves, synchronously,
           before it's discarded below. Without this, any edits made
           in the last <2s (the debounce window) before the room goes
           empty were silently lost from CRDTDocument, and the next
           ROOM_JOIN would resurrect an older version of the file. */
        clearSaveTimer(roomId);

        const doc = getDocument(roomId);
        await saveDocument(roomId, doc);

        stopSnapshot(roomId);

        removeAwareness(roomId);

        removeDocument(roomId);

        fileSeedPromises.delete(roomId);
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

        if (DEBUG_COLLAB) {
            console.log("[CURSOR-DEBUG] CURSOR_MOVE received", {
                socketId: socket.id,
                username: socket.user?.username,
                roomId,
                cursor,
            });
        }

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

  socket.on("disconnecting", async () => {

    const rooms = [...socket.rooms];

    for (const roomId of rooms) {

    if (roomId === socket.id) continue;

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
        /* Same flush as ROOM_LEAVE above — a plain disconnect (tab
           close / refresh) must not lose the last <2s of edits either. */
        clearSaveTimer(roomId);

        const doc = getDocument(roomId);
        await saveDocument(roomId, doc);

        stopSnapshot(roomId);
        removeAwareness(roomId);
        removeDocument(roomId);
        fileSeedPromises.delete(roomId);
    }
}

removeSocketFromAllRooms(socket);

    console.log(`Socket Disconnected: ${socket.id}`);

    });
  });
};

module.exports = registerSocketEvents;