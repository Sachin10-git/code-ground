const rooms = new Map();

const joinRoom = (socket, roomId) => {
  socket.join(roomId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  rooms.get(roomId).add(socket.id);
};

const leaveRoom = (socket, roomId) => {
  socket.leave(roomId);

  if (!rooms.has(roomId)) return;

  rooms.get(roomId).delete(socket.id);

  if (rooms.get(roomId).size === 0) {
    rooms.delete(roomId);
  }
};

const getRoomUsers = (roomId) => {
  return rooms.has(roomId)
    ? [...rooms.get(roomId)]
    : [];
};

const removeSocketFromAllRooms = (socket) => {
    for (const [roomId, users] of rooms.entries()) {
        if (users.has(socket.id)) {
            users.delete(socket.id);

            if (users.size === 0) {
                rooms.delete(roomId);
            }
        }
    }
};


module.exports = {
    joinRoom,
    leaveRoom,
    getRoomUsers,
    removeSocketFromAllRooms,
};