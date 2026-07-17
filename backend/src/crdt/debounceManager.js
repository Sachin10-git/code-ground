const saveTimers = new Map();

/**
 * Schedule a save after the user stops editing.
 */
const scheduleSave = (roomId, callback, delay = 2000) => {

    if (saveTimers.has(roomId)) {
        clearTimeout(saveTimers.get(roomId));
    }

    const timer = setTimeout(async () => {

        saveTimers.delete(roomId);

        await callback();

    }, delay);

    saveTimers.set(roomId, timer);

};

/**
 * Clear pending save timer.
 */
const clearSaveTimer = (roomId) => {

    if (saveTimers.has(roomId)) {

        clearTimeout(saveTimers.get(roomId));

        saveTimers.delete(roomId);

    }

};

module.exports = {
    scheduleSave,
    clearSaveTimer,
};