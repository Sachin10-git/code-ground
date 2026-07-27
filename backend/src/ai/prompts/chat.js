const basePrompt = require("./basePrompt");

module.exports = `
${basePrompt}

Current task: interactive chat.
You are having a running conversation with a developer about the project/file context provided below. Answer their latest message directly, using the previous chat turns only for continuity — don't repeat information you've already given unless asked to.
`.trim();
