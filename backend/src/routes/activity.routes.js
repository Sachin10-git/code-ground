const express = require("express");
const authenticate = require("../middleware/authenticate");
const activityController = require("../controllers/activityController");

const router = express.Router();

/**
 * Get Recent Workspace Activity
 */
router.get(
    "/:projectId/activity",
    authenticate,
    activityController.getRecentActivity
);

module.exports = router;
