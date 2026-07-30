const express = require("express");
const router = express.Router();

const ApiResponse = require("../utils/ApiResponse");
const dockerHealth = require("../services/execution/dockerHealth.service");
const executionQueue = require("../services/execution/executionQueue.service");
const executionMetrics = require("../services/execution/executionMetrics.service");

/**
 * GET /health
 *
 * Deep health check: backend uptime/memory plus the execution engine's
 * actual runtime state (Docker reachability, which required images are
 * present, current queue depth, recent execution outcomes). Every
 * sub-check (dockerHealth.*) already swallows its own errors and
 * returns a plain status object rather than throwing, so this handler
 * can never itself 500 just because Docker happens to be down - the
 * whole point of a health endpoint is to report a dependency being
 * unhealthy, not to go down with it.
 *
 * Always responds 200: the API server answering this request IS "up".
 * `data.status` ("ok" | "degraded") and `data.docker.reachable` are
 * what a caller should check to know whether code execution
 * specifically is impaired - a narrower condition than "is the
 * backend up," and not one that should trip an uptime monitor into
 * reporting the whole service as down.
 */
router.get("/", async (req, res) => {

    const [dockerStatus, requiredImages] = await Promise.all([
        dockerHealth.checkDockerReachable(),
        dockerHealth.checkRequiredImages(),
    ]);

    const healthy = dockerStatus.reachable;

    const healthData = {
        status: healthy ? "ok" : "degraded",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        memory: process.memoryUsage(),
        docker: dockerStatus,
        requiredImages,
        executionQueue: {
            active: executionQueue.getActiveCount(),
            waiting: executionQueue.getQueueLength(),
            maxConcurrent: executionQueue.MAX_CONCURRENT_EXECUTIONS,
        },
        executionMetrics: {
            summary: executionMetrics.getSummary(),
            recent: executionMetrics.getRecent(20),
        },
    };

    return res.status(200).json(
        new ApiResponse(
            200,
            healthy ? "Server is healthy" : "Server is up, but Docker is unreachable",
            healthData
        )
    );

});

module.exports = router;