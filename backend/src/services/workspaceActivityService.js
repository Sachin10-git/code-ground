const WorkspaceActivity = require("../models/workspaceactivity");
const projectService = require("./projectService");
const ApiError = require("../utils/ApiError");

/**
 * Enhancement 2 (Phase 6.4) — persistence for the workspace activity
 * feed. Kept in its own service (rather than folded into fileService/
 * folderService) since it's called from workspaceBroadcast.js, not
 * from the file/folder controllers directly — persistence happens at
 * the same point the live broadcast does, for every mutation type.
 */

const ACTIVITY_LIMIT = 100;

/**
 * Persists one activity record, then trims that project's history
 * back down to the latest ACTIVITY_LIMIT. A single mutation only ever
 * pushes the count 1 over the limit, but this trims by however much
 * it's over rather than assuming exactly 1, so it stays correct even
 * if records ever get inserted out of band.
 */
const recordActivity = async ({
    projectId,
    username,
    operation,
    targetType,
    targetName,
    oldName,
    newName,
}) => {

    await WorkspaceActivity.create({
        projectId,
        username,
        operation,
        targetType,
        targetName,
        oldName,
        newName,
    });

    const count = await WorkspaceActivity.countDocuments({ projectId });

    if (count > ACTIVITY_LIMIT) {

        const excess = count - ACTIVITY_LIMIT;

        const oldest = await WorkspaceActivity.find({ projectId })
            .sort({ createdAt: 1 })
            .limit(excess)
            .select("_id");

        await WorkspaceActivity.deleteMany({
            _id: { $in: oldest.map((doc) => doc._id) },
        });

    }

};

/**
 * Latest ACTIVITY_LIMIT entries for a project, newest first — the
 * same order the live feed keeps in memory (see useWorkspaceSync.js),
 * so the frontend can seed its state with this response directly.
 */
const getRecentActivity = async (projectId, userId) => {

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

    const entries = await WorkspaceActivity.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_LIMIT);

    return entries;

};

module.exports = {
    recordActivity,
    getRecentActivity,
};
