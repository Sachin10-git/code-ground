const File = require("../../models/file");
const Project = require("../../db/models/project");
const projectService = require("../../services/projectService");

const { buildContext } = require("./contextBuilder");

const prepareAIContext = async ({
    userId,
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

    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new Error("You are not a member of this workspace.");
    }

    if (!file.projectId.equals(project._id)) {
        throw new Error("File does not belong to this project.");
    }

    return buildContext({
        project,
        file,
        selectedCode,
        language: file.language,
        userPrompt,
        chatHistory,
    });

};

module.exports = {
    prepareAIContext,
};