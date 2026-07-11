const projectService = require("../services/projectService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utilities/ApiResponse");

/**
 * Create Workspace
 */
const createProject = asyncHandler(async (req, res) => {

    const userId = req.user.id;

    const project = await projectService.createProject(
        userId,
        req.body
    );

    return ApiResponse.success(
        res,
        201,
        "Workspace created successfully",
        project
    );

});

/**
 * Get All Workspaces
 */
const getProjects = asyncHandler(async (req, res) => {

    const userId = req.user.id;

    const projects = await projectService.getProjects(userId);

    return ApiResponse.success(
        res,
        200,
        "Workspaces fetched successfully",
        projects
    );

});

/**
 * Get Workspace
 */
const getProjectById = asyncHandler(async (req, res) => {

    const project = await projectService.getProjectById(req.params.id);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    return ApiResponse.success(
        res,
        200,
        "Workspace fetched successfully",
        project
    );

});

/**
 * -------------------------------------------------------
 * Get Workspace Members
 * -------------------------------------------------------
 */

const getProjectMembers = asyncHandler(async (req, res) => {

    const members = await projectService.getProjectMembers(
        req.params.id
    );

    return ApiResponse.success(
        res,
        200,
        "Workspace members fetched successfully",
        members
    );

});

/**
 * Rename Workspace
 */
const updateProject = asyncHandler(async (req, res) => {

    const project = await projectService.updateProject(
        req.params.id,
        req.body
    );

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    return ApiResponse.success(
        res,
        200,
        "Workspace updated successfully",
        project
    );

});

/**
 * Delete Workspace
 */
const deleteProject = asyncHandler(async (req, res) => {

    const project = await projectService.deleteProject(req.params.id);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    return ApiResponse.success(
        res,
        200,
        "Workspace deleted successfully"
    );

});

/**
 * -------------------------------------------------------
 * Leave Workspace
 * -------------------------------------------------------
 */

const leaveWorkspace = asyncHandler(async (req, res) => {

    const project =
        await projectService.leaveWorkspace(
            req.params.id,
            req.user.id
        );

    return ApiResponse.success(
        res,
        200,
        "You left the workspace successfully",
        project
    );

});

module.exports = {
    createProject,
    getProjects,
    getProjectById,
    updateProject,
    deleteProject,
    leaveWorkspace,
    getProjectMembers
};