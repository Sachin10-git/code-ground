const executeAI = require("./aiExecutor");

const CHAT_SYSTEM_PROMPT = require("../prompts/chat");

const chat = (payload) =>
    executeAI(payload, CHAT_SYSTEM_PROMPT);

module.exports = {
    chat,
};