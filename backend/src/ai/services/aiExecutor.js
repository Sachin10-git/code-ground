const { getProvider } = require("../providers/providerFactory");

const { prepareAIContext } = require("../builders/aiContextBuilder");
const { buildPrompt } = require("../builders/promptBuilder");

const provider = getProvider("gemini");

const executeAI = async (
    payload,
    systemInstruction
) => {

    const context = await prepareAIContext(payload);

    const prompt = buildPrompt({
        systemInstruction,
        context,
    });

    return provider.generateContent({
        prompt,
    });

};

module.exports = executeAI;