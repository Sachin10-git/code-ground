const express = require("express");

const router = express.Router();

const healthRoutes = require("./health.routes");

const authRoutes = require("./auth.routes");

const projectRoutes = require("./project.routes");

const invitationRoutes = require("./invitation.routes");

const runnerRoutes = require("./runner.routes");
/**
 * Root endpoint
 */
router.get("/", (req, res) => {

    res.json({
        success: true,
        message: "Welcome to Code Ground Backend API 🚀"
    });

});

/**
 * Health endpoint
 */
router.use("/api/health", healthRoutes);
router.use("/api/auth", authRoutes);

// Workspace APIs
router.use("/api/projects", projectRoutes);

// Invitation APIs
router.use("/api/invitations", invitationRoutes);

router.use("/api/run", runnerRoutes);

module.exports = router;