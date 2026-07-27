const { GoogleGenAI } = require("@google/genai");
const env = require("../../db/config/env");
const ApiError = require("../../utils/ApiError");

/**
 * Phase 6.1 — AI Foundation.
 *
 * The only file that talks to Gemini. The client is constructed lazily
 * (on first call, not at require-time) so a missing GEMINI_API_KEY
 * fails the specific AI request that needed it — not the entire
 * backend at startup, which is what happened before this file read
 * `process.env.GEMINI_API_KEY.trim()` directly at the top level.
 */

let client = null;

const getClient = () => {

    if (client) return client;

    if (!env.GEMINI_API_KEY) {
        throw new ApiError(
            503,
            "AI service is not configured. Missing GEMINI_API_KEY."
        );
    }

    client = new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY.trim(),
    });

    return client;

};

const DEFAULT_MODEL = "gemini-flash-latest";

const generateContent = async ({
    prompt,
    model = DEFAULT_MODEL,
    config = {},
}) => {

    try {

        const response = await getClient().models.generateContent({
            model,
            contents: prompt,
            config,
        });

        return response.text;

    } catch (error) {

        // Already one of ours (e.g. the missing-key check above) — rethrow as-is.
        if (error instanceof ApiError) throw error;

        // Anything from the Gemini SDK itself (rate limit, invalid key,
        // safety block, network failure) is translated into a clean,
        // user-facing message here rather than leaking the raw SDK
        // error shape up through the controller.
        throw new ApiError(
            502,
            "The AI service is temporarily unavailable. Please try again."
        );

    }

};

module.exports = {
    generateContent,
    DEFAULT_MODEL,
};
