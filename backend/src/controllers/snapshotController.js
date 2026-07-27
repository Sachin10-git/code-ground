const snapshotService = require("../services/snapshotService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");
const {
    broadcastSnapshotCreated,
    broadcastSnapshotRenamed,
    broadcastSnapshotDeleted,
    broadcastSnapshotRestored,
} = require("../socket/workspaceBroadcast");

/**
 * Create Snapshot
 */
const createSnapshot = asyncHandler(async (req, res) => {

    const snapshot = await snapshotService.createSnapshot(
        req.params.projectId,
        req.user.id,
        req.user.username,
        req.body
    );

    await broadcastSnapshotCreated(req.params.projectId, snapshot, req.user.username);

    return ApiResponse.success(
        res,
        201,
        "Snapshot created successfully",
        snapshot
    );

});

/**
 * List Snapshots
 */
const listSnapshots = asyncHandler(async (req, res) => {

    const snapshots = await snapshotService.listSnapshots(
        req.params.projectId,
        req.user.id
    );

    return ApiResponse.success(
        res,
        200,
        "Snapshots fetched successfully",
        snapshots
    );

});

/**
 * Rename Snapshot
 */
const renameSnapshot = asyncHandler(async (req, res) => {

    const { snapshot, oldName } = await snapshotService.renameSnapshot(
        req.params.snapshotId,
        req.user.id,
        req.body.name
    );

    await broadcastSnapshotRenamed(snapshot.projectId, snapshot, req.user.username, oldName);

    return ApiResponse.success(
        res,
        200,
        "Snapshot renamed successfully",
        snapshot
    );

});

/**
 * Delete Snapshot
 */
const deleteSnapshot = asyncHandler(async (req, res) => {

    const snapshot = await snapshotService.deleteSnapshot(
        req.params.snapshotId,
        req.user.id
    );

    await broadcastSnapshotDeleted(snapshot.projectId, snapshot, req.user.username);

    return ApiResponse.success(
        res,
        200,
        "Snapshot deleted successfully"
    );

});

/**
 * Restore Snapshot
 */
const restoreSnapshot = asyncHandler(async (req, res) => {

    const snapshot = await snapshotService.restoreSnapshot(
        req.params.snapshotId,
        req.user.id
    );

    await broadcastSnapshotRestored(
        snapshot.projectId,
        snapshot,
        req.user.username,
        snapshot.files.map((file) => file.fileId)
    );

    return ApiResponse.success(
        res,
        200,
        "Snapshot restored successfully",
        snapshot
    );

});

module.exports = {
    createSnapshot,
    listSnapshots,
    renameSnapshot,
    deleteSnapshot,
    restoreSnapshot,
};
