/**
 * -------------------------------------------------------
 * Async Handler
 * -------------------------------------------------------
 * Wraps async route handlers so Express forwards
 * errors to the global error handler automatically.
 * -------------------------------------------------------
 */

const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

module.exports = asyncHandler;