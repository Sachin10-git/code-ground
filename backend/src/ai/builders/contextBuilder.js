const buildContext = ({
    project = {},
    file = {},
    selectedCode = "",
    language = "",
    userPrompt = "",
    chatHistory = [],
}) => {

    return {
        project: {
            id: project._id || null,
            name: project.name || "",
        },

        file: {
            id: file._id || null,
            name: file.name || "",
            content: file.content || "",
        },

        selectedCode,

        language,

        userPrompt,

        chatHistory,
    };

};

module.exports = {
    buildContext,
};