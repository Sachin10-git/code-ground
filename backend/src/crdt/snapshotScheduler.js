const snapshotTimers = new Map();

/**
 * Schedule periodic snapshots.
 */
const scheduleSnapshot = (
    roomId,
    callback,
    interval = 5 * 60 * 1000 // 5 minutes
) => {

    if (snapshotTimers.has(roomId)) {
        return;
    }

    const timer = setInterval(async () => {

        try {
            await callback();
            console.log(`[CRDT] Snapshot created for room ${roomId}`);
        } catch (err) {
            console.error("[CRDT] Snapshot failed:", err);
        }

    }, interval);

    snapshotTimers.set(roomId, timer);

};

/**
 * Stop snapshot scheduler.
 */
const stopSnapshot = (roomId) => {

    if (!snapshotTimers.has(roomId)) {
        return;
    }

    clearInterval(snapshotTimers.get(roomId));
    snapshotTimers.delete(roomId);

};

module.exports = {
    scheduleSnapshot,
    stopSnapshot,
};