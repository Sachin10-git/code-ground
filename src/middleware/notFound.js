/**
 * -------------------------------------------------------
 * Not Found Middleware
 * -------------------------------------------------------
 * Handles requests made to routes that do not exist.
 *
 * Instead of sending a response directly,
 * it forwards a custom AppError to the global
 * error handler.
 * -------------------------------------------------------
 */

const AppError = require("../utils/AppError");

const notFound = (req, res, next) => {

    next(
        new AppError(
            `Route ${req.originalUrl} not found`,
            404
        )
    );

};

module.exports = notFound;