const SOCKET_EVENTS = require("./socketConstants");

const fileLocks = new Map();

/**
 * Lock a file
 */
const lockFile = (io, socket, roomId, fileId) => {

    if (fileLocks.has(fileId)) {

        socket.emit(
            SOCKET_EVENTS.FILE_LOCK_FAILED,
            {
                fileId,
                lockedBy: fileLocks.get(fileId),
            }
        );

        return;
    }

    fileLocks.set(fileId, socket.id);

    io.to(roomId).emit(
        SOCKET_EVENTS.FILE_LOCKED,
        {
            fileId,
            lockedBy: socket.id,
        }
    );
};

/**
 * Unlock a file
 */
const unlockFile = (io, socket, roomId, fileId) => {

    if (fileLocks.get(fileId) !== socket.id) {
        return;
    }

    fileLocks.delete(fileId);

    io.to(roomId).emit(
        SOCKET_EVENTS.FILE_UNLOCKED,
        {
            fileId,
        }
    );
};

module.exports = {
    lockFile,
    unlockFile,
};