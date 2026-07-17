const Y = require("yjs");
const SOCKET_EVENTS = require("./socketConstants");
const { getDocument } = require("../crdt/yjsManager");
const { saveDocument } = require("../crdt/persistenceManager");

const {
    scheduleSave,
} = require("../crdt/debounceManager");
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
    try {

    Y.applyUpdate(doc, update);

} catch (err) {

    console.error(
        "[CRDT] Invalid update:",
        err
    );

    return;

}

/**
 * Schedule persistence after editing stops.
 */
scheduleSave(
    roomId,
    async () => {

        await saveDocument(roomId, doc);

        console.log(
            `[CRDT] Saved document for room ${roomId}`
        );

    }
);

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