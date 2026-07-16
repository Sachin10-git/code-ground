const SOCKET_EVENTS = require("./socketConstants");

/**
 * Broadcast editor changes to everyone else
 */
const broadcastChanges = (
    io,
    socket,
    roomId,
    change
) => {

    socket.to(roomId).emit(
        SOCKET_EVENTS.FILE_UPDATED,
        {
            socketId: socket.id,
            change,
        }
    );

};

module.exports = {
    broadcastChanges,
};