const executeAI = require("./aiExecutor");

const EXPLAIN_SYSTEM_PROMPT = require("../prompts/explain");

const explain = (payload) =>
    executeAI(payload, EXPLAIN_SYSTEM_PROMPT);

module.exports = {
    explain,
};