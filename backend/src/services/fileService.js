const File = require("../models/file");
const Folder = require("../models/folder");
const Project = require("../db/models/project");
const projectService = require("./projectService");
const ApiError = require("../utils/ApiError");

/**
 * Create File
 */
const createFile = async (projectId, userId, fileData) => {

    const {
        name,
        folderId = null,
        language,
        content,
    } = fileData;

    // Check project exists
    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    // Check user is a member
    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    // Validate folder
    if (folderId) {

        const folder = await Folder.findById(folderId);

        if (!folder) {
            throw new ApiError(
                404,
                "Folder not found"
            );
        }

    }

    const file = await File.create({
        projectId,
        folderId,
        name,
        language,
        content,
        createdBy: userId,
    });

    return file;

};

/**
 * Get Project Tree
 */
const getProjectTree = async (projectId, userId) => {

    const isMember = await projectService.isProjectMember(
        projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(
            404,
            "Workspace not found"
        );
    }

    const folders = await Folder.find({ projectId })
        .sort({ createdAt: 1 });

    const files = await File.find({ projectId })
        .sort({ createdAt: 1 });

    return {
        project,
        folders,
        files,
    };

};

/**
 * Rename File
 */
const renameFile = async (fileId, userId, name) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    const oldName = file.name;

    file.name = name;

    await file.save();

    // Plain object (not the mongoose doc) so `oldName` — not a schema
    // field — survives JSON serialization for both the REST response
    // and workspaceBroadcast.js's rename payload/activity record.
    return { ...file.toObject(), oldName };

};

/**
 * Update File Content
 */
const updateFileContent = async (fileId, userId, content) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    file.content = content ?? "";

    await file.save();

    return file;

};

/**
 * Move File
 */
const moveFile = async (fileId, userId, folderId) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    if (folderId) {

        const folder = await Folder.findById(folderId);

        if (!folder) {
            throw new ApiError(
                404,
                "Destination folder not found"
            );
        }

    }

    file.folderId = folderId || null;

    await file.save();

    return file;

};

/**
 * Delete File
 */
const deleteFile = async (fileId, userId) => {

    const file = await File.findById(fileId);

    if (!file) {
        throw new ApiError(
            404,
            "File not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        file.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    await File.findByIdAndDelete(fileId);

    return file;

};

module.exports = {
    createFile,
    getProjectTree,
    renameFile,
    updateFileContent,
    moveFile,
    deleteFile,
};