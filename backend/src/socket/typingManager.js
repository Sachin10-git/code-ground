const SOCKET_EVENTS = require("./socketConstants");

/**
 * Notify other users that someone started typing.
 */
const startTyping = (io, socket, roomId) => {
    console.log("Emitting USER_TYPING to room:", roomId);

    socket.to(roomId).emit(
        SOCKET_EVENTS.USER_TYPING,
        {
            socketId: socket.id,
        }
    );

};

/**
 * Notify other users that someone stopped typing.
 */
const stopTyping = (io, socket, roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    console.log("Sockets in room:", room ? [...room] : []);
    console.log("Emitting USER_STOPPED_TYPING to room:", roomId);
    socket.to(roomId).emit(
        SOCKET_EVENTS.USER_STOPPED_TYPING,
        {
            socketId: socket.id,
        }
    );

};

module.exports = {
    startTyping,
    stopTyping,
};