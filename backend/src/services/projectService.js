const Project = require("../db/models/project");
const ApiError = require("../utils/ApiError");
/**
 * Create a new workspace
 */
const createProject = async (userId, projectData) => {
    const project = await Project.create({
        ...projectData,
        ownerId: userId,
        members: [
            {
                userId,
                role: "owner"
            }
        ]
    });

    return project;
};

/**
 * Get all workspaces for a user
 */
const getProjects = async (userId) => {
    return await Project.find({
        "members.userId": userId
    })
        .populate("ownerId", "username email avatar")
        .sort({ updatedAt: -1 });
};

/**
 * Get a single workspace
 */
const getProjectById = async (projectId) => {
    return await Project.findById(projectId)
        .populate("ownerId", "username email avatar")
        .populate("members.userId", "username email avatar");
};

/**
 * Rename / Update workspace
 */
const updateProject = async (projectId, updateData) => {

    const allowedUpdates = {
        name: updateData.name,
        description: updateData.description,
        visibility: updateData.visibility,
        language: updateData.language,
        githubRepo: updateData.githubRepo
    };

    Object.keys(allowedUpdates).forEach((key) => {
        if (allowedUpdates[key] === undefined) {
            delete allowedUpdates[key];
        }
    });

    return await Project.findByIdAndUpdate(
        projectId,
        allowedUpdates,
        {
            new: true,
            runValidators: true
        }
    );
};

/**
 * Delete workspace
 */
const deleteProject = async (projectId) => {
    return await Project.findByIdAndDelete(projectId);
};

/**
 * -------------------------------------------------------
 * Leave Workspace
 * -------------------------------------------------------
 */

const leaveWorkspace = async (projectId, userId) => {

    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    const member = project.members.find(
        member => member.userId.toString() === userId.toString()
    );

    if (!member) {
        throw new ApiError(
            404,
            "You are not a member of this workspace"
        );
    }

    if (member.role === "owner") {
        throw new ApiError(
            400,
            "Workspace owner cannot leave. Transfer ownership or delete the workspace."
        );
    }

    project.members = project.members.filter(
        member => member.userId.toString() !== userId.toString()
    );

    await project.save();

    return project;

};


/**
 * -------------------------------------------------------
 * Get Workspace Members
 * -------------------------------------------------------
 */

const getProjectMembers = async (projectId) => {

    const project = await Project.findById(projectId)
        .populate(
            "members.userId",
            "username email avatar"
        );

    if (!project) {
        throw new ApiError(
            404,
            "Workspace not found"
        );
    }

    return project.members;

};

/**
 * Check whether a user belongs to a workspace
 */
const isProjectMember = async (projectId, userId) => {

    const project = await Project.findOne({
        _id: projectId,
        "members.userId": userId
    });

    return !!project;
};

/**
 * Check whether a user owns a workspace
 */
const isProjectOwner = async (projectId, userId) => {

    const project = await Project.findOne({
        _id: projectId,
        ownerId: userId
    });

    return !!project;
};

module.exports = {
    createProject,
    getProjects,
    getProjectById,
    updateProject,
    deleteProject,
    leaveWorkspace,
    getProjectMembers,
    isProjectMember,
    isProjectOwner
};
