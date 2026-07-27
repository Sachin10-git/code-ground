const Y = require("yjs");
const CRDTDocument = require("../db/models/crdtDocument");

/**
 * Save a Y.Doc to MongoDB
 */
const saveDocument = async (roomId, doc) => {

    const state = Buffer.from(
        Y.encodeStateAsUpdate(doc)
    );

    await CRDTDocument.findOneAndUpdate(
        { roomId },
        { state },
        {
            upsert: true,
            returnDocument: "after",
        }
    );

};

/**
 * Load a Y.Doc from MongoDB. Returns whether a saved document was
 * found and applied — callers use this to decide whether an older
 * fallback (e.g. a periodic CRDTSnapshot) is even worth trying, since
 * this debounced, save-on-every-pause record is always at least as
 * fresh as any periodic snapshot.
 */
const loadDocument = async (roomId, doc) => {

    const savedDoc = await CRDTDocument.findOne({
        roomId,
    });

    if (!savedDoc) return false;

    Y.applyUpdate(
        doc,
        new Uint8Array(savedDoc.state)
    );

    return true;

};

module.exports = {
    saveDocument,
    loadDocument,
};