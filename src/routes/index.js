const express = require("express");

const router = express.Router();

const healthRoutes = require("./health.routes");

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
router.use("/health", healthRoutes);

module.exports = router;