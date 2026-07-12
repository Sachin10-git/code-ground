/**
 * -------------------------------------------------------
 * API Response Utility
 * -------------------------------------------------------
 * Standardizes all API responses across the application.
 *
 * Usage:
 *
 * return ApiResponse.success(
 *      res,
 *      200,
 *      "Projects fetched successfully",
 *      projects
 * );
 *
 * return ApiResponse.error(
 *      res,
 *      404,
 *      "Project not found"
 * );
 * -------------------------------------------------------
 */

class ApiResponse {

    /**
     * Success Response
     */
    static success(res, statusCode = 200, message = "Success", data = null) {

        return res.status(statusCode).json({
            success: true,
            statusCode,
            message,
            data
        });

    }

    /**
     * Error Response
     */
    static error(res, statusCode = 500, message = "Internal Server Error", errors = null) {

        return res.status(statusCode).json({
            success: false,
            statusCode,
            message,
            errors
        });

    }

}

module.exports = ApiResponse;