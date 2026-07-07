const express = require("express");

const router = express.Router();

const healthRoutes = require("./health.routes");

const authRoutes = require("./auth.routes");
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

module.exports = router;