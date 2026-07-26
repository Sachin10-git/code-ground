const SOCKET_EVENTS = require("./socketConstants");
const { DEBUG_COLLAB } = require("../utils/debugFlags");

/**
 * Broadcast cursor position to other users in the room.
 * Identity (userId/username) comes from the authenticated socket
 * (see socketServer.js's socketAuthMiddleware), never from the
 * client-supplied payload — a client can only report its own position,
 * never claim to be a different user.
 */
const updateCursor = (io, socket, roomId, cursor) => {

    const payload = {
        socketId: socket.id,
        userId: socket.user?.id,
        username: socket.user?.username,
        cursor,
    };

    if (DEBUG_COLLAB) {
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size ?? 0;
        console.log("[CURSOR-DEBUG] broadcasting CURSOR_UPDATED", {
            destinationRoom: roomId,
            recipientCount: Math.max(0, roomSize - 1), // room size includes the sender itself
            payload,
        });
    }

    socket.to(roomId).emit(
        SOCKET_EVENTS.CURSOR_UPDATED,
        payload
    );

};

module.exports = {
    updateCursor,
};