const executeAI = require("./aiExecutor");

const REFACTOR_SYSTEM_PROMPT = require("../prompts/refactor");

const refactor = (payload) =>
    executeAI(payload, REFACTOR_SYSTEM_PROMPT);

module.exports = {
    refactor,
};