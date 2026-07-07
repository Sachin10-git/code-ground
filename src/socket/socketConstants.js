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

    JOIN_ROOM: "join-room",

    LEAVE_ROOM: "leave-room",

    USER_JOINED: "user-joined",

    USER_LEFT: "user-left",

};

module.exports = SOCKET_EVENTS;