/**
 * -------------------------------------------------------
 * API Response Utility
 * -------------------------------------------------------
 * Standardizes successful API responses across the
 * entire backend.
 *
 * Instead of manually creating JSON responses in every
 * controller, we instantiate this class.
 *
 * Example:
 * return res.status(200).json(
 *     new ApiResponse(200, "Login successful", user)
 * );
 * -------------------------------------------------------
 */

class ApiResponse {
    constructor(statusCode, message, data = null) {
        this.success = true;
        this.statusCode = statusCode;
        this.message = message;
        this.data = data;
    }
}

module.exports = ApiResponse;