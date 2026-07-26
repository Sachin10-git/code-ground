const folderService = require("../services/folderService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");
const {
    broadcastFolderCreated,
    broadcastFolderRenamed,
    broadcastFolderMoved,
    broadcastFolderDeleted,
} = require("../socket/workspaceBroadcast");

/**
 * Create Folder
 */
const createFolder = asyncHandler(async (req, res) => {

    const folder = await folderService.createFolder(
        req.params.projectId,
        req.user.id,
        req.body
    );

    await broadcastFolderCreated(req.params.projectId, folder, req.user.username);

    return ApiResponse.success(
        res,
        201,
        "Folder created successfully",
        folder
    );

});

/**
 * Rename Folder
 */
const renameFolder = asyncHandler(async (req, res) => {

    const folder = await folderService.renameFolder(
        req.params.folderId,
        req.user.id,
        req.body.name
    );

    await broadcastFolderRenamed(folder.projectId, folder, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "Folder renamed successfully",
        folder
    );

});

/**
 * Delete Folder
 */
const deleteFolder = asyncHandler(async (req, res) => {

    const folder = await folderService.deleteFolder(
        req.params.folderId,
        req.user.id
    );

    await broadcastFolderDeleted(folder.projectId, folder, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "Folder deleted successfully"
    );

});

/**
 * Move Folder
 */
const moveFolder = asyncHandler(async (req, res) => {

    const folder = await folderService.moveFolder(
        req.params.folderId,
        req.user.id,
        req.body.parentFolderId
    );

    await broadcastFolderMoved(folder.projectId, folder, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "Folder moved successfully",
        folder
    );

});

module.exports = {
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder
};