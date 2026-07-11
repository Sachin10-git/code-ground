const Invitation = require("../models/Invitation");
const Project = require("../db/models/project");
const User = require("../db/models/User");

const ApiError = require("../utils/ApiError");

/**
 * -------------------------------------------------------
 * Invite Member
 * -------------------------------------------------------
 */
const inviteMember = async (
    projectId,
    inviterId,
    inviteeEmail,
    role
) => {

    // Check project exists
    const project = await Project.findById(projectId);

    if (!project) {
        throw new ApiError(404, "Workspace not found");
    }

    // Check invitee exists
    const invitee = await User.findOne({
        email: inviteeEmail
    });

    if (!invitee) {
        throw new ApiError(
            404,
            "User with this email does not exist"
        );
    }

    // Prevent owner inviting themselves
    if (invitee._id.toString() === inviterId.toString()) {
        throw new ApiError(
            400,
            "You cannot invite yourself"
        );
    }

    // Already a member?
    const alreadyMember = project.members.some(
        member =>
            member.userId.toString() === invitee._id.toString()
    );

    if (alreadyMember) {
        throw new ApiError(
            400,
            "User is already a workspace member"
        );
    }

    // Existing pending invitation?
    const existingInvitation = await Invitation.findOne({
        projectId,
        inviteeEmail,
        status: "pending"
    });

    if (existingInvitation) {
        throw new ApiError(
            400,
            "Pending invitation already exists"
        );
    }

    const invitation = await Invitation.create({

        projectId,

        inviterId,

        inviteeEmail,

        role,

        expiresAt: new Date(
            Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 days
        )

    });

    return invitation;
};

/**
 * -------------------------------------------------------
 * Accept Invitation
 * -------------------------------------------------------
 */

const acceptInvitation = async (
    invitationId,
    userId
) => {

    const invitation = await Invitation.findById(invitationId);

    if (!invitation) {
        throw new ApiError(
            404,
            "Invitation not found"
        );
    }

    if (invitation.status !== "pending") {
        throw new ApiError(
            400,
            "Invitation is no longer valid"
        );
    }

    if (
        invitation.expiresAt &&
        invitation.expiresAt < new Date()
    ) {

        invitation.status = "expired";

        await invitation.save();

        throw new ApiError(
            400,
            "Invitation has expired"
        );

    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.email !== invitation.inviteeEmail) {
        throw new ApiError(
            403,
            "This invitation does not belong to you"
        );
    }

    const project = await Project.findById(
        invitation.projectId
    );

    if (!project) {
        throw new ApiError(
            404,
            "Workspace not found"
        );
    }

    const alreadyMember = project.members.some(
        member =>
            member.userId.toString() === userId.toString()
    );

    if (!alreadyMember) {

        project.members.push({

            userId,

            role: invitation.role

        });

        await project.save();

    }

    invitation.status = "accepted";

    await invitation.save();

    return project;

};

/**
 * -------------------------------------------------------
 * Reject Invitation
 * -------------------------------------------------------
 */

const rejectInvitation = async (
    invitationId,
    userId
) => {

    const invitation = await Invitation.findById(invitationId);

    if (!invitation) {
        throw new ApiError(
            404,
            "Invitation not found"
        );
    }

    if (invitation.status !== "pending") {
        throw new ApiError(
            400,
            "Invitation is no longer valid"
        );
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new ApiError(
            404,
            "User not found"
        );
    }

    if (user.email !== invitation.inviteeEmail) {
        throw new ApiError(
            403,
            "This invitation does not belong to you"
        );
    }

    invitation.status = "rejected";

    await invitation.save();

    return invitation;
};

module.exports = {
    inviteMember,
    acceptInvitation,
    rejectInvitation
};