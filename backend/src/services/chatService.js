const ChatMessage = require("../models/chatMessage");

/**
 * Phase 6.0 — Team Chat persistence.
 *
 * Kept in its own service (mirrors workspaceActivityService.js) since
 * it's called directly from the `/workspace` socket namespace, not
 * from a REST controller — history is pushed to a joining socket, and
 * new messages are persisted at the same point they're broadcast.
 */

const CHAT_HISTORY_LIMIT = 100;

/**
 * Persists one chat message, then trims that project's history back
 * down to the latest CHAT_HISTORY_LIMIT. A single send only ever
 * pushes the count 1 over the limit, but this trims by however much
 * it's over rather than assuming exactly 1, so it stays correct even
 * if records ever get inserted out of band.
 */
const sendMessage = async ({ projectId, userId, username, message }) => {

    const chatMessage = await ChatMessage.create({
        projectId,
        userId,
        username,
        message,
    });

    const count = await ChatMessage.countDocuments({ projectId });

    if (count > CHAT_HISTORY_LIMIT) {

        const excess = count - CHAT_HISTORY_LIMIT;

        const oldest = await ChatMessage.find({ projectId })
            .sort({ createdAt: 1 })
            .limit(excess)
            .select("_id");

        await ChatMessage.deleteMany({
            _id: { $in: oldest.map((doc) => doc._id) },
        });

    }

    return chatMessage;

};

/**
 * Latest CHAT_HISTORY_LIMIT messages for a project, in chronological
 * (oldest-first) order — the order a chat UI renders top-to-bottom.
 */
const getRecentMessages = async (projectId) => {

    const messages = await ChatMessage.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(CHAT_HISTORY_LIMIT);

    return messages.reverse();

};

module.exports = {
    sendMessage,
    getRecentMessages,
};
