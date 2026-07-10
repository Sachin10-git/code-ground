const express = require("express");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

const {
    registerValidator,
    loginValidator,
    validate,
} = require("../validators/auth.validator");

const {
    register,
    login,
    refresh,
    getCurrentUser,
    logout,
    logoutAll,
    forgotPassword,
    resetPassword,
    sendVerificationEmail,
    verifyEmail,
} = require("../controllers/auth.controller");

/**
 * Register User
 */
router.post(
    "/register",
    registerValidator,
    validate,
    register
);

/**
 * Login User
 */
router.post(
    "/login",
    loginValidator,
    validate,
    login
);

/**
 * Get Current User
 */
router.get(
    "/me",
    authenticate,
    getCurrentUser
);

/**
 * Refresh Access Token
 */
router.post(
    "/refresh",
    refresh
);

/**
 * Logout
 */
router.post(
    "/logout",
    authenticate,
    logout
);

/**
 * Forgot Password
 */
router.post(
    "/forgot-password",
    forgotPassword
);

/**
 * Reset Password
 */
router.post(
    "/reset-password/:token",
    resetPassword
);

/**
 * Logout All Devices
 */
router.post(
    "/logout-all",
    authenticate,
    logoutAll
);

/**
 * Send Verification Email
 */
router.post(
    "/send-verification",
    authenticate,
    sendVerificationEmail
);

/**
 * Verify Email
 */
router.get(
    "/verify-email/:token",
    verifyEmail
);

module.exports = router;