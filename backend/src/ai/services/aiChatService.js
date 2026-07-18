const File = require("../../models/file");
const Project = require("../../db/models/project");

const { getProvider } = require("../providers/providerFactory");
const { buildContext } = require("../builders/contextBuilder");
const { buildPrompt } = require("../builders/promptBuilder");

const CHAT_SYSTEM_PROMPT = require("../prompts/chat");

const provider = getProvider("gemini");

const chat = async ({
    projectId,
    fileId,
    selectedCode = "",
    userPrompt,
    chatHistory = [],
}) => {

    const [project, file] = await Promise.all([
        Project.findById(projectId),
        File.findById(fileId),
    ]);

    if (!project) {
        throw new Error("Project not found.");
    }

    if (!file) {
        throw new Error("File not found.");
    }

    if (!file.projectId.equals(project._id)) {
        throw new Error("File does not belong to this project.");
    }

    const context = buildContext({
        project,
        file,
        selectedCode,
        language: file.language,
        userPrompt,
        chatHistory,
    });

    const prompt = buildPrompt({
        systemInstruction: CHAT_SYSTEM_PROMPT,
        context,
    });

    const response = await provider.generateContent({
        prompt,
    });

    return response;

};

module.exports = {
    chat,
};