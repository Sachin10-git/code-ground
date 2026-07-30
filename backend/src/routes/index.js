const express = require("express");

const router = express.Router();

const healthRoutes = require("./health.routes");

const authRoutes = require("./auth.routes");

const projectRoutes = require("./project.routes");

const invitationRoutes = require("./invitation.routes");

const folderRoutes = require("./folder.routes");

const fileRoutes = require("./file.routes");

const activityRoutes = require("./activity.routes");

const aiRoutes = require("./ai.routes");
const runnerRoutes = require("./runner.routes");
const snapshotRoutes = require("./snapshot.routes");
const executionRoutes = require("./execution.routes");
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

router.use("/api/projects", folderRoutes);

router.use("/api/projects", fileRoutes);

router.use("/api/projects", activityRoutes);

router.use("/api/projects", snapshotRoutes);

router.use("/api/ai", aiRoutes);

router.use("/api/run", runnerRoutes);

router.use("/api/execution", executionRoutes);

module.exports = router;