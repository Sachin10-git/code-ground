const express = require("express");

const router = express.Router();

const {
    inviteMember,
    getMyInvitations,
    acceptInvitation,
    rejectInvitation
} = require("../controllers/invitationController");

const {

    validateInvite,

    validate

} = require("../validators/invitationValidator");

// Temporary
// Replace with authenticate middleware later

const authenticate = require("../middleware/authenticate");

router.post(
    "/:id/invite",
    authenticate,
    validateInvite,
    validate,
    inviteMember
);

// Get my pending invitations
router.get(
    "/",
    authenticate,
    getMyInvitations
);

router.post(
    "/invite/:invitationId/accept",
    authenticate,
    acceptInvitation
);

router.post(
    "/invite/:invitationId/reject",
    authenticate,
    rejectInvitation
);

module.exports = router;