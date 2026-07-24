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

    /* `update` arrives as a plain array of byte values (see
       useYjs.js's FILE_CHANGE emit), not a real Uint8Array/Buffer —
       Y.applyUpdate needs an actual typed array (it reads
       .buffer/.byteOffset internally), so this wrap is required
       regardless of what shape `update` arrives in over the wire. */
    Y.applyUpdate(doc, new Uint8Array(update));

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