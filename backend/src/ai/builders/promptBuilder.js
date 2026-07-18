const buildPrompt = ({
    systemInstruction = "",
    context = {},
}) => {

    return `
${systemInstruction}

Project:
${context.project.name}

Language:
${context.language}

File:
${context.file.name}

Selected Code:
${context.selectedCode || "None"}

Current File Content:
${context.file.content}

Previous Chat:
${JSON.stringify(context.chatHistory, null, 2)}

User Request:
${context.userPrompt}
`.trim();

};

module.exports = {
    buildPrompt,
};