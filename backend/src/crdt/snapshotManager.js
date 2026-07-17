const Y = require("yjs");
const CRDTSnapshot = require("../db/models/crdtSnapshot");

/**
 * Create a snapshot
 */
const createSnapshot = async (roomId, doc) => {

    const state = Buffer.from(
        Y.encodeStateAsUpdate(doc)
    );

    await CRDTSnapshot.create({
        roomId,
        state,
    });

};

/**
 * Get latest snapshot
 */
const getLatestSnapshot = async (roomId) => {

    return await CRDTSnapshot.findOne({ roomId })
        .sort({ createdAt: -1 });

};

/**
 * Recover document from latest snapshot
 */
const recoverDocument = async (roomId, doc) => {

    const snapshot = await getLatestSnapshot(roomId);

    if (!snapshot) {
        console.log("[CRDT] No snapshot found");
        return false;
    }

    Y.applyUpdate(
        doc,
        new Uint8Array(snapshot.state)
    );

    return true;
};

module.exports = {
    createSnapshot,
    getLatestSnapshot,
    recoverDocument,
};