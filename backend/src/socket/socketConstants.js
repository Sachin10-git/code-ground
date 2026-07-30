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
    /* Phase 5.5 — emitted back to the joining socket only, if the
       CRDT hydration pipeline (crdt/hydration.js) throws instead of
       silently proceeding with a possibly-broken/empty document. */
    ROOM_JOIN_FAILED: "room:join-failed",

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

    AWARENESS_UPDATE: "editor:awareness-update",
    AWARENESS_CHANGED: "editor:awareness-changed",

    DOCUMENT_SYNC: "editor:document-sync",

    /**
     * -------------------------------------------------------
     * Workspace Synchronization (Phase 6.1)
     * -------------------------------------------------------
     * Isolated from the editor-collaboration events above — these
     * live on the separate `/workspace` Socket.IO namespace (see
     * socket/workspaceSocket.js) so they never interact with the
     * per-file Yjs room lifecycle in socketEvents.js.
     * -------------------------------------------------------
     */
    WORKSPACE_JOIN: "workspace:join",
    WORKSPACE_LEAVE: "workspace:leave",

    WORKSPACE_FILE_CREATED: "workspace:file-created",
    WORKSPACE_FILE_RENAMED: "workspace:file-renamed",
    WORKSPACE_FILE_DELETED: "workspace:file-deleted",
    WORKSPACE_FILE_MOVED: "workspace:file-moved",

    WORKSPACE_FOLDER_CREATED: "workspace:folder-created",
    WORKSPACE_FOLDER_RENAMED: "workspace:folder-renamed",
    WORKSPACE_FOLDER_DELETED: "workspace:folder-deleted",
    WORKSPACE_FOLDER_MOVED: "workspace:folder-moved",

    /**
     * -------------------------------------------------------
     * Workspace Presence (Phase 6.2)
     * -------------------------------------------------------
     * A client pings WORKSPACE_ACTIVITY whenever it performs a
     * workspace mutation (create/rename/delete/move); the server
     * relays it to everyone else in that project's room as
     * WORKSPACE_USER_ACTIVE. There is no matching "stop" event —
     * unlike typing (a continuous keystroke stream with a natural
     * start/stop), each mutation is a one-off action, so receivers
     * treat a WORKSPACE_USER_ACTIVE as "active for the next ~2s" and
     * let it expire on their own timer (see useWorkspaceSync.js).
     * -------------------------------------------------------
     */
    WORKSPACE_ACTIVITY: "workspace:activity",
    WORKSPACE_USER_ACTIVE: "workspace:user-active",

    /**
     * -------------------------------------------------------
     * File Presence (Phase 6.4)
     * -------------------------------------------------------
     * Also on the `/workspace` namespace, project-room-scoped —
     * unlike the per-file Yjs room's typing indicator (editor:*
     * above, joined only for whichever ONE file the local user
     * currently has open), the Explorer needs to show presence for
     * EVERY file in the project at once, so this can't just reuse
     * that per-file room. It reuses its *pattern* instead: a client
     * announces a `state` ("viewing" while a file is open, "editing"
     * while its Yjs typing signal is on) via WORKSPACE_FILE_PRESENCE,
     * and explicitly leaves via WORKSPACE_FILE_PRESENCE_LEAVE when it
     * closes/switches away from that file — mirroring TYPING_START/
     * STOP's already-debounced viewing⇄editing transition rather than
     * reinventing a second decay timer here.
     * -------------------------------------------------------
     */
    WORKSPACE_FILE_PRESENCE: "workspace:file-presence",
    WORKSPACE_FILE_PRESENCE_LEAVE: "workspace:file-presence-leave",

    WORKSPACE_FILE_PRESENT: "workspace:file-present",
    WORKSPACE_FILE_ABSENT: "workspace:file-absent",

    /**
     * -------------------------------------------------------
     * File Locking (Phase 6.6)
     * -------------------------------------------------------
     * The actual lock/unlock mutex (FILE_LOCK/FILE_UNLOCK/FILE_LOCKED/
     * FILE_UNLOCKED/FILE_LOCK_FAILED above) lives on the default
     * namespace, scoped to one file's Yjs room — a socket only learns
     * about a lock if it has that specific file open. These two are
     * the project-wide echo of the same lock/unlock, broadcast on the
     * `/workspace` namespace (like WORKSPACE_FILE_* above) so the
     * Explorer can show a lock icon for ANY file in the project, not
     * just the one currently open, and so lock/unlock shows up in the
     * activity feed the same way create/rename/move/delete already do.
     * -------------------------------------------------------
     */
    WORKSPACE_FILE_LOCKED: "workspace:file-locked",
    WORKSPACE_FILE_UNLOCKED: "workspace:file-unlocked",

    /**
     * -------------------------------------------------------
     * Snapshots (Phase 6.7)
     * -------------------------------------------------------
     * Project-wide checkpoints — see socket/workspaceBroadcast.js's
     * broadcastSnapshot* functions and services/snapshotService.js.
     * RESTORED additionally drives a full tree resync on every
     * connected client (see useWorkspaceSync.js), since a restore can
     * touch every file/folder in the project at once.
     * -------------------------------------------------------
     */
    WORKSPACE_SNAPSHOT_CREATED: "workspace:snapshot-created",
    WORKSPACE_SNAPSHOT_RENAMED: "workspace:snapshot-renamed",
    WORKSPACE_SNAPSHOT_DELETED: "workspace:snapshot-deleted",
    WORKSPACE_SNAPSHOT_RESTORED: "workspace:snapshot-restored",

    /**
     * -------------------------------------------------------
     * Team Chat (Phase 6.0)
     * -------------------------------------------------------
     * Also on the `/workspace` namespace, reusing the same
     * project room WORKSPACE_JOIN already puts the socket in —
     * a project *is* a chat room, so there's no separate
     * "join chat" step. History is pushed to a socket the
     * moment it joins (see workspaceSocket.js), the same way
     * file presence catches a joining socket up on existing
     * state.
     * -------------------------------------------------------
     */
    TEAM_CHAT_SEND: "team-chat:send",
    TEAM_CHAT_MESSAGE: "team-chat:message",
    TEAM_CHAT_HISTORY: "team-chat:history",

    /**
     * -------------------------------------------------------
     * Interactive Execution Terminal (Phase 7)
     * -------------------------------------------------------
     * Own `/terminal` namespace (see socket/terminalSocket.js),
     * isolated the same way `/workspace` is from the default
     * namespace's per-file Yjs rooms — a session's lifecycle
     * (one container, one socket) has nothing to do with either of
     * those domains and shouldn't share disconnect/room bookkeeping
     * with them.
     * -------------------------------------------------------
     */
    TERMINAL_START: "terminal:start",
    TERMINAL_READY: "terminal:ready",
    TERMINAL_OUTPUT: "terminal:output",
    TERMINAL_INPUT: "terminal:input",
    TERMINAL_RESIZE: "terminal:resize",
    TERMINAL_STOP: "terminal:stop",
    TERMINAL_EXIT: "terminal:exit",
    TERMINAL_ERROR: "terminal:error",
};

module.exports = SOCKET_EVENTS;