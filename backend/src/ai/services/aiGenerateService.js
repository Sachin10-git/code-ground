const executeAI = require("./aiExecutor");

const GENERATE_SYSTEM_PROMPT = require("../prompts/generate");

const generate = (payload) =>
    executeAI(payload, GENERATE_SYSTEM_PROMPT);

module.exports = {
    generate,
};