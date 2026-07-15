const SOCKET_EVENTS = require("./socketConstants");

/**
 * Broadcast cursor position to other users
 */
const updateCursor = (io, socket, roomId, cursor) => {

    console.log("Cursor update:");
    console.log("Room:", roomId);
    console.log("Cursor:", cursor);

    socket.to(roomId).emit(
        SOCKET_EVENTS.CURSOR_UPDATED,
        {
            socketId: socket.id,
            cursor,
        }
    );

    console.log("CURSOR_UPDATED emitted");
};

module.exports = {
    updateCursor,
};