const Project = require("../models/Project");
const ApiError = require("../utilities/ApiError");
const asyncHandler = require("./asyncHandler");

/**
 * -------------------------------------------------------
 * Authorize Project Middleware
 * -------------------------------------------------------
 *
 * Usage:
 *
 * authorizeProject()
 *      -> Any project member
 *
 * authorizeProject("editor")
 *      -> Editor or Owner
 *
 * authorizeProject("owner")
 *      -> Owner only
 * -------------------------------------------------------
 */

const authorizeProject = (requiredRole = "member") => {

    return asyncHandler(async (req, res, next) => {

        const projectId = req.params.id;

        const userId = req.user.id;

        const project = await Project.findById(projectId);

        if (!project) {
            throw new ApiError(404, "Workspace not found");
        }

        const member = project.members.find(
            (member) => member.userId.toString() === userId.toString()
        );

        if (!member) {
            throw new ApiError(
                403,
                "You are not a member of this workspace"
            );
        }

        if (requiredRole === "member") {

            req.project = project;

            return next();

        }

        if (
            requiredRole === "editor" &&
            (member.role === "editor" || member.role === "owner")
        ) {

            req.project = project;

            return next();

        }

        if (
            requiredRole === "owner" &&
            member.role === "owner"
        ) {

            req.project = project;

            return next();

        }

        throw new ApiError(
            403,
            "You don't have permission to perform this action"
        );

    });

};

module.exports = authorizeProject;