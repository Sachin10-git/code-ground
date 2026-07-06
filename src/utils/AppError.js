/**
 * -------------------------------------------------------
 * Custom Application Error
 * -------------------------------------------------------
 * A reusable error class for handling operational errors
 * across the application.
 *
 * Instead of manually sending error responses inside
 * controllers, throw an AppError.
 *
 * Example:
 *
 * throw new AppError("User not found", 404);
 *
 * The global error middleware will catch it and return
 * a standardized JSON response.
 * -------------------------------------------------------
 */

class AppError extends Error {

    constructor(message, statusCode) {

        super(message);

        this.statusCode = statusCode;

        this.success = false;

        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = AppError;