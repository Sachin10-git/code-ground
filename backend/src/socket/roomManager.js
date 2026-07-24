/* roomId -> Map(socketId -> { userId, username, email }) */
const rooms = new Map();

const joinRoom = (socket, roomId) => {
  socket.join(roomId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }

  rooms.get(roomId).set(socket.id, {
    userId:   socket.user?.id,
    username: socket.user?.username,
    email:    socket.user?.email,
  });
};

const leaveRoom = (socket, roomId) => {
  socket.leave(roomId);

  if (!rooms.has(roomId)) return;

  rooms.get(roomId).delete(socket.id);

  if (rooms.get(roomId).size === 0) {
    rooms.delete(roomId);
  }
};

/* One entry per distinct user in the room — the same user connected
   from two sockets (e.g. two tabs) is deduped by userId so they don't
   show up twice in the presence list. */
const getRoomUsers = (roomId) => {
  if (!rooms.has(roomId)) return [];

  const byUser = new Map();
  for (const user of rooms.get(roomId).values()) {
    if (user.userId && !byUser.has(user.userId)) {
      byUser.set(user.userId, user);
    }
  }

  return [...byUser.values()];
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