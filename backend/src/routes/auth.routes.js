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
    getCurrentUser,
    logout,
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
 * Logout
 */
router.post(
    "/logout",
    authenticate,
    logout
);

module.exports = router;