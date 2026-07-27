const SOCKET_EVENTS = require("./socketConstants");

/**
 * Phase 6.6 — lightweight file locking.
 *
 * Pure in-memory state (fileId -> lock record) plus the per-file-room
 * (default namespace) broadcast. Deliberately has NO knowledge of the
 * `/workspace` namespace or the activity feed — socketEvents.js is
 * responsible for calling workspaceBroadcast.js after a lock/unlock
 * actually happens here, which keeps this module free of a require
 * back to workspaceSocket.js (workspaceBroadcast.js already requires
 * that file for getWorkspaceNamespace()) and avoids a require cycle:
 * workspaceSocket.js -> fileLockManager.js -> workspaceBroadcast.js ->
 * workspaceSocket.js.
 *
 * One active lock per file, acquired the moment a user's FIRST local
 * edit lands in that file's Yjs room (see useYjs.js) — merely opening
 * a file to look at it never locks it, only editing does, per the
 * product spec. Released explicitly (FILE_UNLOCK, sent when the room
 * is left / file switched) and defensively (releaseLocksForSocket, for
 * a disconnect that never got the chance to send FILE_UNLOCK).
 */
const fileLocks = new Map(); // fileId -> { socketId, userId, username, projectId, fileName }

/**
 * Attempt to lock a file. No-ops (does not re-broadcast) if this exact
 * socket already holds it — a client can end up calling this more than
 * once per session defensively without spamming a duplicate FILE_LOCKED.
 */
const lockFile = (io, socket, roomId, fileId, projectId, fileName) => {

    const existing = fileLocks.get(fileId);

    if (existing && existing.socketId === socket.id) {
        return { acquired: false, alreadyOwned: true, lock: existing };
    }

    if (existing) {
        socket.emit(SOCKET_EVENTS.FILE_LOCK_FAILED, {
            fileId,
            lockedBy: existing.username,
        });
        return { acquired: false, alreadyOwned: false, lock: existing };
    }

    const lock = {
        socketId: socket.id,
        userId: socket.user?.id ?? null,
        username: socket.user?.username || "Someone",
        projectId: projectId ?? null,
        fileName: fileName ?? null,
    };

    fileLocks.set(fileId, lock);

    io.to(roomId).emit(SOCKET_EVENTS.FILE_LOCKED, {
        fileId,
        lockedBy: lock.username,
        userId: lock.userId,
    });

    return { acquired: true, alreadyOwned: false, lock };
};

/**
 * Release a file's lock — only the socket that holds it can release
 * it (a stray FILE_UNLOCK from anyone else, or after the lock already
 * moved on, is a safe no-op).
 */
const unlockFile = (io, socket, roomId, fileId) => {

    const lock = fileLocks.get(fileId);

    if (!lock || lock.socketId !== socket.id) {
        return { released: false, lock: null };
    }

    fileLocks.delete(fileId);

    io.to(roomId).emit(SOCKET_EVENTS.FILE_UNLOCKED, { fileId });

    return { released: true, lock };
};

/**
 * Release every lock a disconnecting socket holds, across every file —
 * a hard disconnect (crash, tab close, network drop) never gets the
 * chance to send an explicit FILE_UNLOCK per file, so this is what
 * guarantees a lock never outlives its owner's connection (prevents
 * stale locks). Returns the released locks (with their fileId) so the
 * caller can broadcast each one to the `/workspace` namespace too.
 */
const releaseLocksForSocket = (io, socket) => {

    const released = [];

    for (const [fileId, lock] of fileLocks.entries()) {
        if (lock.socketId !== socket.id) continue;

        fileLocks.delete(fileId);
        io.to(fileId).emit(SOCKET_EVENTS.FILE_UNLOCKED, { fileId });
        released.push({ fileId, lock });
    }

    return released;
};

/**
 * Current lock for one file, or null. Used for ROOM_JOIN catch-up —
 * a socket joining a file's room after it was already locked needs to
 * learn that immediately, not only if/when it tries to edit itself.
 */
const getLock = (fileId) => fileLocks.get(fileId) || null;

/**
 * Every currently-locked file in a project. Used for WORKSPACE_JOIN
 * catch-up (see workspaceSocket.js) so the Explorer shows lock icons
 * for files the joining socket hasn't opened at all, mirroring
 * filePresenceManager.getProjectPresence's exact same purpose.
 */
const getLocksForProject = (projectId) => {
    const entries = [];
    for (const [fileId, lock] of fileLocks.entries()) {
        if (lock.projectId !== projectId) continue;
        entries.push({ fileId, username: lock.username, userId: lock.userId, fileName: lock.fileName });
    }
    return entries;
};

module.exports = {
    lockFile,
    unlockFile,
    releaseLocksForSocket,
    getLock,
    getLocksForProject,
};
