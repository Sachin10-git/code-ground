const Y = require("yjs");

/**
 * Active Yjs documents
 */
const documents = new Map();

/**
 * Rooms whose Y.Doc has been FULLY hydrated (see crdt/hydration.js) —
 * i.e. the load-CRDTDocument -> recover-snapshot -> seed-from-File.content
 * pipeline has completed successfully for it. Deliberately separate from
 * `documents`: a room gets a raw (possibly still-empty, not-yet-hydrated)
 * Y.Doc the instant getDocument() first runs inside ROOM_JOIN, well
 * before hydration finishes — so `documents.has(roomId)` alone was never
 * a safe signal for "this room's content can be trusted."
 */
const hydratedRooms = new Set();

/**
 * Get or create document. Callers elsewhere in the codebase (awareness,
 * liveUpdateManager, ROOM_LEAVE/disconnect flush) intentionally keep
 * using this raw accessor — they only ever touch a room's doc AFTER
 * hydrateDocument() has already run for it via ROOM_JOIN.
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
 * Whether a room's Y.Doc is currently active AND fully hydrated — never
 * true for a doc that's mid-hydration or that failed to hydrate. Used by
 * the REST save path (see fileService.updateFileContent) and
 * snapshotService to decide whether the live Y.Doc is safe to trust as
 * "more current than File.content". Deliberately NOT just
 * `documents.has(roomId)` (see hydratedRooms above) — that would let a
 * doc that's still empty/mid-seed be treated as authoritative, which is
 * exactly how an empty document could overwrite valid File.content.
 */
const hasDocument = (roomId) => hydratedRooms.has(roomId);

/**
 * Mark a room's doc as fully hydrated. Called only by
 * crdt/hydration.js once its load -> recover -> seed pipeline has
 * completed without error - never on failure.
 */
const markHydrated = (roomId) => {
    hydratedRooms.add(roomId);
};

/**
 * Remove document
 */
const removeDocument = (roomId) => {

    documents.delete(roomId);
    hydratedRooms.delete(roomId);

};

module.exports = {
    getDocument,
    getSharedText,
    removeDocument,
    hasDocument,
    markHydrated,
};