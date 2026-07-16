const awarenessStates = new Map();

/**
 * Update awareness state
 */
const updateAwareness = (roomId, socketId, state) => {

    if (!awarenessStates.has(roomId)) {
        awarenessStates.set(roomId, new Map());
    }

    awarenessStates
        .get(roomId)
        .set(socketId, state);

};

/**
 * Get awareness state
 */
const getAwareness = (roomId) => {

    return awarenessStates.has(roomId)
        ? [...awarenessStates.get(roomId).values()]
        : [];

};

/**
 * Remove awareness
 */
const removeAwareness = (roomId, socketId) => {

    if (!awarenessStates.has(roomId)) return;

    awarenessStates.get(roomId).delete(socketId);

};

module.exports = {
    updateAwareness,
    getAwareness,
    removeAwareness,
};