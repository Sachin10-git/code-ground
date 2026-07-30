const SOCKET_EVENTS = require("./socketConstants");
const { DEBUG_COLLAB } = require("../utils/debugFlags");
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
    releaseLocksForSocket,
    getLock,
} = require("./fileLockManager");

const {
    broadcastFileLocked,
    broadcastFileUnlocked,
} = require("./workspaceBroadcast");

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
const { saveDocument } = require("../crdt/persistenceManager");

const {
    hydrateDocument,
    clearHydration,
} = require("../crdt/hydration");

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

    /* Phase 5.5 — a single atomic pipeline (load CRDTDocument -> recover
       CRDTSnapshot -> seed from File.content) that only marks the room
       "hydrated" (yjsManager.hasDocument) once it has genuinely
       succeeded. Concurrent joins for the same brand-new room share one
       in-flight attempt (see crdt/hydration.js), so content is never
       duplicated and never treated as trustworthy before it actually is. */
    let doc;
    try {
        doc = await hydrateDocument(roomId);
    } catch (err) {
        console.error(`[CRDT] Failed to hydrate room ${roomId}:`, err);
        socket.emit(SOCKET_EVENTS.ROOM_JOIN_FAILED, {
            roomId,
            message: "Failed to load this file's collaborative session. Please try reopening it.",
        });
        leaveRoom(socket, roomId);
        return;
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

    /* Phase 6.6 — lock catch-up. A socket joining this file's room
       after someone else already locked it (by editing) needs to know
       immediately — it shouldn't have to try editing itself and get a
       FILE_LOCK_FAILED just to find out. Mirrors filePresenceManager's
       catch-up pattern on the /workspace namespace. */
    const existingLock = getLock(roomId);
    if (existingLock) {
        socket.emit(SOCKET_EVENTS.FILE_LOCKED, {
            fileId: roomId,
            lockedBy: existingLock.username,
            userId: existingLock.userId,
        });
    }

    console.log(`${socket.id} joined ${roomId}`);

    io.to(roomId).emit(
        SOCKET_EVENTS.USER_JOINED,
        getRoomUsers(roomId)
    );

});

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, async (roomId) => {

    leaveRoom(socket, roomId);

    /* Phase 6.6 — release this socket's lock (if any) on the file it's
       leaving. Covers "switching files" and "closing the file" — a
       plain disconnect is covered separately below via
       releaseLocksForSocket, since ROOM_LEAVE is never emitted for a
       hard disconnect (tab close, crash, network drop). */
    const { released, lock } = unlockFile(io, socket, roomId, roomId);
    if (released && lock.projectId) {
        await broadcastFileUnlocked(lock.projectId, roomId, lock.fileName, lock.username).catch((err) => {
            console.error("[socketEvents] Failed to broadcast unlock to workspace:", err);
        });
    }

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

        clearHydration(roomId);
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
    async ({ roomId, fileId, projectId, fileName }) => {
        const { acquired, lock } = lockFile(io, socket, roomId, fileId, projectId, fileName);
        if (acquired && lock.projectId) {
            await broadcastFileLocked(lock.projectId, fileId, lock.fileName, lock.username).catch((err) => {
                console.error("[socketEvents] Failed to broadcast lock to workspace:", err);
            });
        }
    }
);

  socket.on(
    SOCKET_EVENTS.FILE_UNLOCK,
    async ({ roomId, fileId }) => {
        const { released, lock } = unlockFile(io, socket, roomId, fileId);
        if (released && lock.projectId) {
            await broadcastFileUnlocked(lock.projectId, fileId, lock.fileName, lock.username).catch((err) => {
                console.error("[socketEvents] Failed to broadcast unlock to workspace:", err);
            });
        }
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

    /* Phase 6.6 — release every lock this socket holds, across every
       file, before anything else. This is the one path that catches a
       hard disconnect (crash, tab close, network drop) — ROOM_LEAVE is
       never emitted for those, so without this a lock would outlive
       its owner's connection (a stale lock, blocking everyone else
       from editing that file forever). */
    const releasedLocks = releaseLocksForSocket(io, socket);
    for (const { fileId, lock } of releasedLocks) {
        if (!lock.projectId) continue;
        await broadcastFileUnlocked(lock.projectId, fileId, lock.fileName, lock.username).catch((err) => {
            console.error("[socketEvents] Failed to broadcast unlock to workspace:", err);
        });
    }

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
        clearHydration(roomId);
    }
}

removeSocketFromAllRooms(socket);

    console.log(`Socket Disconnected: ${socket.id}`);

    });
  });
};

module.exports = registerSocketEvents;