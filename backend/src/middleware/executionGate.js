const env = require("../db/config/env");
const ApiResponse = require("../utilities/ApiResponse");

/**
 * -------------------------------------------------------
 * Execution Gate
 * -------------------------------------------------------
 * Blocks the Docker-backed execution routes with a 503 when
 * EXECUTION_ENABLED=false (see docs/16_Deployment_Demo_Mode.md),
 * so a Docker-less deployment (e.g. Render) never reaches
 * execution.controller.js / execution.service.js.
 * -------------------------------------------------------
 */
const executionGate = (req, res, next) => {
    if (!env.EXECUTION_ENABLED) {
        return ApiResponse.error(
            res,
            503,
            "Code execution is disabled in this deployment."
        );
    }

    next();
};

module.exports = executionGate;
