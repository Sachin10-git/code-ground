const SOCKET_EVENTS = require("./socketConstants");

/**
 * Broadcast text selection to other users
 */
const updateSelection = (io, socket, roomId, selection) => {

    socket.to(roomId).emit(
        SOCKET_EVENTS.SELECTION_UPDATED,
        {
            socketId: socket.id,
            selection,
        }
    );

};

module.exports = {
    updateSelection,
};