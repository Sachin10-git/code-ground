/**
 * -------------------------------------------------------
 * Socket Event Constants
 * -------------------------------------------------------
 * Centralized event names used across the backend
 * and frontend.
 * -------------------------------------------------------
 */

const SOCKET_EVENTS = {
    CONNECTION: "connection",
    DISCONNECT: "disconnect",

    ROOM_JOIN: "room:join",
    ROOM_LEAVE: "room:leave",

    USER_JOINED: "room:user-joined",
    USER_LEFT: "room:user-left",
};

module.exports = SOCKET_EVENTS;