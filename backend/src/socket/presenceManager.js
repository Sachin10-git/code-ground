const onlineUsers = new Map();

/**
 * Add user to online list
 */
const userOnline = (socketId, userId) => {
    onlineUsers.set(socketId, userId);
};

/**
 * Remove user
 */
const userOffline = (socketId) => {
    onlineUsers.delete(socketId);
};

/**
 * Get all online users
 */
const getOnlineUsers = () => {
    return [...onlineUsers.values()];
};

module.exports = {
    userOnline,
    userOffline,
    getOnlineUsers
};