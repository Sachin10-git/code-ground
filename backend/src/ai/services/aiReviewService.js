const executeAI = require("./aiExecutor");

const REVIEW_SYSTEM_PROMPT = require("../prompts/review");

const review = (payload) =>
    executeAI(payload, REVIEW_SYSTEM_PROMPT);

module.exports = {
    review,
};