const Folder = require("../models/folder");
const Project = require("../db/models/project");
const projectService = require("./projectService");
const ApiError = require("../utils/ApiError");

/**
 * Create Folder
 */
const createFolder = async (projectId, userId, folderData) => {

    const { name, parentFolderId = null } = folderData;

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

    // Validate parent folder
    if (parentFolderId) {

        const parentFolder = await Folder.findById(parentFolderId);

        if (!parentFolder) {
            throw new ApiError(
                404,
                "Parent folder not found"
            );
        }
    }

    const folder = await Folder.create({
        projectId,
        name,
        parentFolderId,
        createdBy: userId,
    });

    return folder;
};

/**
 * Rename Folder
 */
const renameFolder = async (folderId, userId, name) => {

    const folder = await Folder.findById(folderId);

    if (!folder) {
        throw new ApiError(
            404,
            "Folder not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        folder.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    folder.name = name;

    await folder.save();

    return folder;

};

/**
 * Delete Folder
 */
const deleteFolder = async (folderId, userId) => {

    const folder = await Folder.findById(folderId);

    if (!folder) {
        throw new ApiError(
            404,
            "Folder not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        folder.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    // Check for child folders
    const childFolder = await Folder.findOne({
        parentFolderId: folderId
    });

    if (childFolder) {
        throw new ApiError(
            400,
            "Folder is not empty. It contains subfolders."
        );
    }

    // Check for files
    const File = require("../models/file");

    const file = await File.findOne({
        folderId
    });

    if (file) {
        throw new ApiError(
            400,
            "Folder is not empty. It contains files."
        );
    }

    await Folder.findByIdAndDelete(folderId);

};

/**
 * Move Folder
 */
const moveFolder = async (folderId, userId, parentFolderId) => {

    const folder = await Folder.findById(folderId);

    if (!folder) {
        throw new ApiError(
            404,
            "Folder not found"
        );
    }

    const isMember = await projectService.isProjectMember(
        folder.projectId,
        userId
    );

    if (!isMember) {
        throw new ApiError(
            403,
            "You are not a member of this workspace"
        );
    }

    // Cannot move folder into itself
    if (
        parentFolderId &&
        parentFolderId.toString() === folderId.toString()
    ) {
        throw new ApiError(
            400,
            "A folder cannot be moved into itself."
        );
    }

    // Validate destination folder
    if (parentFolderId) {

        const parentFolder = await Folder.findById(parentFolderId);

        if (!parentFolder) {
            throw new ApiError(
                404,
                "Destination folder not found"
            );
        }

        if (
            parentFolder.projectId.toString() !==
            folder.projectId.toString()
        ) {
            throw new ApiError(
                400,
                "Destination folder belongs to another workspace."
            );
        }
    }

    folder.parentFolderId = parentFolderId || null;

    await folder.save();

    return folder;

};

module.exports = {
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder
};