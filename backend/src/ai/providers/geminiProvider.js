const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY.trim(),
});

const DEFAULT_MODEL = "gemini-flash-latest";

const generateContent = async ({
    prompt,
    model = DEFAULT_MODEL,
    config = {},
}) => {

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config,
    });

    console.log("Model Response:", response);

    return response.text;

};

module.exports = {
    generateContent,
    DEFAULT_MODEL,
};