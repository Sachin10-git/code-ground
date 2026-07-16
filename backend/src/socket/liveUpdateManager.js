const Y = require("yjs");
const SOCKET_EVENTS = require("./socketConstants");
const { getDocument } = require("../crdt/yjsManager");
const { saveDocument } = require("../crdt/persistenceManager");
const { createSnapshot } = require("../crdt/snapshotManager");

/**
 * Apply incoming CRDT update
 * and broadcast it.
 */
const broadcastChanges = async (
    io,
    socket,
    roomId,
    update
) => {

    const doc = getDocument(roomId);

    // Apply update to local document
    Y.applyUpdate(doc, update);
    await saveDocument(roomId, doc);
    await createSnapshot(roomId, doc);
    // Broadcast to everyone else
    socket.to(roomId).emit(
        SOCKET_EVENTS.FILE_UPDATED,
        {
            socketId: socket.id,
            update,
        }
    );

};

module.exports = {
    broadcastChanges,
};