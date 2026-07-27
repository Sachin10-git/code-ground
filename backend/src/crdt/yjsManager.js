const Y = require("yjs");

/**
 * Active Yjs documents
 */
const documents = new Map();

/**
 * Get or create document
 */
const getDocument = (roomId) => {

    if (!documents.has(roomId)) {

        const doc = new Y.Doc();

        documents.set(roomId, doc);
    }

    return documents.get(roomId);

};

/**
 * Get shared text
 */
const getSharedText = (roomId) => {

    const doc = getDocument(roomId);

    return doc.getText("editor");

};

/**
 * Whether a room's Y.Doc is currently active in memory — unlike
 * getDocument, never creates one. Used by the REST save path (see
 * fileService.updateFileContent) to decide whether it's safe to force
 * a persistence flush: flushing a doc that doesn't exist would call
 * getDocument anyway and create a brand-new EMPTY one, then persist
 * that empty state over whatever was correctly saved before — this
 * guard is what prevents that.
 */
const hasDocument = (roomId) => documents.has(roomId);

/**
 * Remove document
 */
const removeDocument = (roomId) => {

    documents.delete(roomId);

};

module.exports = {
    getDocument,
    getSharedText,
    removeDocument,
    hasDocument,
};