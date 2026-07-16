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
            new: true,
        }
    );

};

/**
 * Load a Y.Doc from MongoDB
 */
const loadDocument = async (roomId, doc) => {

    const savedDoc = await CRDTDocument.findOne({
        roomId,
    });

    if (!savedDoc) return;

    Y.applyUpdate(
        doc,
        new Uint8Array(savedDoc.state)
    );

};

module.exports = {
    saveDocument,
    loadDocument,
};