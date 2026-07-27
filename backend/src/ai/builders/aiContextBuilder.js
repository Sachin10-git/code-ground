const File = require("../../models/file");
const Project = require("../../db/models/project");
const projectService = require("../../services/projectService");
const ApiError = require("../../utils/ApiError");

const { buildContext } = require("./contextBuilder");

const prepareAIContext = async ({
    userId,
    projectId,
    fileId,
    selectedCode = "",
    fileContent,
    userPrompt,
    chatHistory = [],
}) => {

    const [project, file] = await Promise.all([
        Project.findById(projectId),
        File.findById(fileId),
    ]);

    if (!project) {
        throw new ApiError(404, "Project not found.");
    }

    if (!file) {
        throw new ApiError(404, "File not found.");
    }

    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(403, "You are not a member of this workspace.");
    }

    if (!file.projectId.equals(project._id)) {
        throw new ApiError(400, "File does not belong to this project.");
    }

    /* Prefer the live editor buffer over the persisted document: the
       product promises the AI "sees every edit," not just the last
       explicit save, and File.content only updates on save. The
       frontend sends the current Monaco buffer as fileContent on
       every request; fall back to the persisted copy if it's absent
       (e.g. a future caller that doesn't have an open editor). */
    const file_ = fileContent === undefined
        ? file
        : { ...file.toObject(), content: fileContent };

    return buildContext({
        project,
        file: file_,
        selectedCode,
        language: file.language,
        userPrompt,
        chatHistory,
    });

};

module.exports = {
    prepareAIContext,
};