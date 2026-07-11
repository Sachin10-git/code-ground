/**
 * -------------------------------------------------------
 * Global Error Handling Middleware
 * -------------------------------------------------------
 */

const env = require("../db/config/env");
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {

    const statusCode = err.statusCode || 500;

    const message = err.message || "Internal Server Error";

    // Log every error
    logger.error(`${req.method} ${req.originalUrl} - ${message}`);

    const response = {
        success: false,
        statusCode,
        message
    };

    if (env.NODE_ENV === "development") {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

module.exports = errorHandler;