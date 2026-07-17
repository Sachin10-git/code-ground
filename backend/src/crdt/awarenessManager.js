const { Awareness } = require("y-protocols/awareness");
const { getDocument } = require("./yjsManager");

const awarenessInstances = new Map();

/**
 * Get or create Awareness instance
 */
const getAwareness = (roomId) => {

    if (!awarenessInstances.has(roomId)) {

        const doc = getDocument(roomId);

        awarenessInstances.set(
            roomId,
            new Awareness(doc)
        );

    }

    return awarenessInstances.get(roomId);

};

/**
 * Remove Awareness instance
 */
const removeAwareness = (roomId) => {

    awarenessInstances.delete(roomId);

};

module.exports = {
    getAwareness,
    removeAwareness,
};