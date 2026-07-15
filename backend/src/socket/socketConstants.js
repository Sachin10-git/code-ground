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

    TYPING_START: "editor:typing-start",
    TYPING_STOP: "editor:typing-stop",

    USER_TYPING: "editor:user-typing",
    USER_STOPPED_TYPING: "editor:user-stopped-typing",

    CURSOR_MOVE: "editor:cursor-move",
    CURSOR_UPDATED: "editor:cursor-updated",

    SELECTION_CHANGE: "editor:selection-change",
    SELECTION_UPDATED: "editor:selection-updated",

    FILE_LOCK: "editor:file-lock",
    FILE_UNLOCK: "editor:file-unlock",

    FILE_LOCKED: "editor:file-locked",
    FILE_UNLOCKED: "editor:file-unlocked",

    FILE_LOCK_FAILED: "editor:file-lock-failed",

    FILE_CHANGE: "editor:file-change",
    FILE_UPDATED: "editor:file-updated",
};

module.exports = SOCKET_EVENTS;