/**
 * -------------------------------------------------------
 * Async Handler
 * -------------------------------------------------------
 * Wraps asynchronous route handlers and automatically
 * forwards any errors to Express's error handling middleware.
 *
 * This eliminates the need to write try...catch blocks
 * inside every async controller.
 *
 * Example:
 *
 * const login = asyncHandler(async (req, res) => {
 *     ...
 * });
 * -------------------------------------------------------
 */

const asyncHandler = (fn) => {

    return (req, res, next) => {

        Promise.resolve(fn(req, res, next))
            .catch(next);

    };

};

module.exports = asyncHandler;