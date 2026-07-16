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
 * Remove document
 */
const removeDocument = (roomId) => {

    documents.delete(roomId);

};

module.exports = {
    getDocument,
    getSharedText,
    removeDocument,
};