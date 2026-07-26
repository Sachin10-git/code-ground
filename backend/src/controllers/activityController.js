const workspaceActivityService = require("../services/workspaceActivityService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");

/**
 * Get Recent Workspace Activity
 *
 * Enhancement 2 (Phase 6.4) — the one new REST endpoint this feature
 * adds, used by useWorkspaceSync.js to seed the activity feed with
 * persisted history when a project is opened, before its live socket
 * listeners take over.
 */
const getRecentActivity = asyncHandler(async (req, res) => {

    const activity = await workspaceActivityService.getRecentActivity(
        req.params.projectId,
        req.user.id
    );

    return ApiResponse.success(
        res,
        200,
        "Workspace activity fetched successfully",
        activity
    );

});

module.exports = {
    getRecentActivity,
};
