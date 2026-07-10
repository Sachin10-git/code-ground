/**
 * -------------------------------------------------------
 * Global Error Handling Middleware
 * -------------------------------------------------------
 * Handles every error thrown inside the application.
 *
 * Responsibilities:
 * - Catch AppError
 * - Catch unexpected errors
 * - Send standardized JSON responses
 * -------------------------------------------------------
 */

const env = require("../db/config/env");

/**
 * Global Error Middleware
 *
 * Express recognizes this as an error handler because
 * it has four parameters:
 *
 * (err, req, res, next)
 */
const errorHandler = (err, req, res, next) => {

    // Default values
    let statusCode = err.statusCode || 500;

    let message = err.message || "Internal Server Error";

    /**
     * During development,
     * include stack trace for easier debugging.
     */
    const response = {
        success: false,
        statusCode,
        message,
    };

    if (env.NODE_ENV === "development") {
        response.stack = err.stack;
    }

    return res.status(statusCode).json(response);
};

module.exports = errorHandler;