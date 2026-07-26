const fileService = require("../services/fileService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");
const {
    broadcastFileCreated,
    broadcastFileRenamed,
    broadcastFileMoved,
    broadcastFileDeleted,
} = require("../socket/workspaceBroadcast");

/**
 * Create File
 */
const createFile = asyncHandler(async (req, res) => {

    const file = await fileService.createFile(
        req.params.projectId,
        req.user.id,
        req.body
    );

    await broadcastFileCreated(req.params.projectId, file, req.user.username);

    return ApiResponse.success(
        res,
        201,
        "File created successfully",
        file
    );

});

/**
 * Get Project Tree
 */
const getProjectTree = asyncHandler(async (req, res) => {

    const tree = await fileService.getProjectTree(
        req.params.projectId,
        req.user.id
    );

    return ApiResponse.success(
        res,
        200,
        "Project tree fetched successfully",
        tree
    );

});

/**
 * Rename File
 */
const renameFile = asyncHandler(async (req, res) => {

    const file = await fileService.renameFile(
        req.params.fileId,
        req.user.id,
        req.body.name
    );

    await broadcastFileRenamed(file.projectId, file, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "File renamed successfully",
        file
    );

});

/**
 * Update File Content
 */
const updateFileContent = asyncHandler(async (req, res) => {

    const file = await fileService.updateFileContent(
        req.params.fileId,
        req.user.id,
        req.body.content
    );

    return ApiResponse.success(
        res,
        200,
        "File content saved successfully",
        file
    );

});

/**
 * Move File
 */
const moveFile = asyncHandler(async (req, res) => {

    const file = await fileService.moveFile(
        req.params.fileId,
        req.user.id,
        req.body.folderId
    );

    await broadcastFileMoved(file.projectId, file, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "File moved successfully",
        file
    );

});

/**
 * Delete File
 */
const deleteFile = asyncHandler(async (req, res) => {

    const file = await fileService.deleteFile(
        req.params.fileId,
        req.user.id
    );

    await broadcastFileDeleted(file.projectId, file, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "File deleted successfully"
    );

});

module.exports = {
    createFile,
    getProjectTree,
    renameFile,
    updateFileContent,
    moveFile,
    deleteFile,
};