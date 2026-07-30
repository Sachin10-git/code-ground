const File = require("../models/file");

const { getDocument, markHydrated } = require("./yjsManager");
const { loadDocument } = require("./persistenceManager");
const { recoverDocument } = require("./snapshotManager");

/**
 * Phase 5.5 — atomic room hydration.
 *
 * Replaces the old split load -> recover -> ensureFileSeed sequence that
 * used to live in socketEvents.js. That version had a real gap: it
 * marked a room "active" (via yjsManager's old `documents.has(roomId)`
 * hasDocument check) the instant getDocument() created the raw Y.Doc -
 * well before any of load/recover/seed had actually run - so a manual
 * REST save landing in that window could force-flush a still-empty doc
 * into CRDTDocument, permanently overwriting valid File.content on the
 * next room join (see fileService.updateFileContent).
 *
 * This module is now the ONLY place that runs that pipeline, and the
 * ONLY place that calls markHydrated() - so `hasDocument()` elsewhere in
 * the codebase can finally be trusted to mean "this room's Y.Doc holds
 * real, trustworthy content," not just "a Y.Doc object exists for it."
 *
 * ── Guarantees ────────────────────────────────────────────────────────
 *
 *   - Idempotent: hydrating an already-hydrated room is a no-op (the
 *     pipeline only ever runs once per room's active lifetime).
 *   - Concurrent-safe: two ROOM_JOINs for the same brand-new room (two
 *     users opening it at the same instant) share the exact same
 *     in-flight promise - the load/recover/seed pipeline runs once, not
 *     once per joiner - so a file's content is never duplicated.
 *   - Failure-safe: if the pipeline throws (e.g. a Mongo hiccup during
 *     the File.content lookup), the room is NOT marked hydrated, and the
 *     failed attempt is evicted from the cache immediately - so the next
 *     ROOM_JOIN gets a fresh retry instead of being stuck forever behind
 *     a cached rejection, and nothing anywhere ever treats that room's
 *     doc as safe to read/flush while broken.
 */
const hydrationPromises = new Map();

async function hydrateDocument(roomId) {

    if (hydrationPromises.has(roomId)) {
        return hydrationPromises.get(roomId);
    }

    const promise = (async () => {

        const doc = getDocument(roomId);

        const loaded = await loadDocument(roomId, doc);

        if (!loaded) {

            const recovered = await recoverDocument(roomId, doc);

            if (!recovered) {

                const sharedText = doc.getText("editor");

                /* Only ever seed once, and only if nothing beat us to it
                   (see the concurrent-safety note above - this check plus
                   the promise cache above is what makes two simultaneous
                   first-opens insert the content exactly once). An empty
                   `file.content` (a genuinely blank new file) correctly
                   leaves the doc empty rather than treating that as
                   something to "fix" - that would be a real bug in the
                   other direction. A missing file (deleted mid-race)
                   also correctly leaves it empty rather than throwing. */
                if (sharedText.length === 0) {
                    const file = await File.findById(roomId).select("content");
                    if (file?.content && sharedText.length === 0) {
                        doc.transact(() => {
                            sharedText.insert(0, file.content);
                        });
                    }
                }
            }
        }

        markHydrated(roomId);

        return doc;

    })();

    hydrationPromises.set(roomId, promise);

    try {
        return await promise;
    } catch (err) {
        hydrationPromises.delete(roomId);
        throw err;
    }
}

/**
 * Drop any cached hydration state for a room - called when a room is
 * fully torn down (last socket leaves), alongside yjsManager's
 * removeDocument(), so the NEXT open re-runs hydration from scratch
 * against whatever is actually persisted at that point.
 */
function clearHydration(roomId) {
    hydrationPromises.delete(roomId);
}

module.exports = {
    hydrateDocument,
    clearHydration,
};
