const express = require("express");

const router = express.Router();

const {
    inviteMember,
    acceptInvitation,
    rejectInvitation
} = require("../controllers/invitationController");

const {

    validateInvite,

    validate

} = require("../validators/invitationValidator");

// Temporary
// Replace with authenticate middleware later

// const authenticate = require("../middleware/authenticate");

router.post(

    "/:id/invite",

    validateInvite,

    validate,

    inviteMember

);

router.post(

    "/invite/:invitationId/accept",

    acceptInvitation

);

router.post(
    "/invite/:invitationId/reject",
    rejectInvitation
);

module.exports = router;