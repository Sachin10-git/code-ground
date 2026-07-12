const invitationService = require("../services/invitationService");
const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");

/**
 * Invite Member
 */
const inviteMember = asyncHandler(async (req, res) => {

    const invitation = await invitationService.inviteMember(
        req.params.id,
        req.user.id,
        req.body.email,
        req.body.role
    );

    return ApiResponse.success(
        res,
        201,
        "Invitation sent successfully",
        invitation
    );

});

/**
 * Accept Invitation
 */
const acceptInvitation = asyncHandler(async (req, res) => {

    const project = await invitationService.acceptInvitation(
        req.params.invitationId,
        req.user.id
    );

    return ApiResponse.success(
        res,
        200,
        "Invitation accepted",
        project
    );

});

/**
 * Reject Invitation
 */
const rejectInvitation = asyncHandler(async (req, res) => {

    const invitation = await invitationService.rejectInvitation(
        req.params.invitationId,
        req.user.id
    );

    return ApiResponse.success(
        res,
        200,
        "Invitation rejected",
        invitation
    );

});

module.exports = {
    inviteMember,
    acceptInvitation,
    rejectInvitation
};