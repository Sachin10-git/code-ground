const express = require("express");
const router = express.Router();

const ApiResponse = require("../utils/ApiResponse");

/**
 * GET /health
 * Health check endpoint.
 */
router.get("/", (req, res) => {

    const healthData = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development"
    };

    return res.status(200).json(
        new ApiResponse(
            200,
            "Server is healthy",
            healthData
        )
    );

});

module.exports = router;