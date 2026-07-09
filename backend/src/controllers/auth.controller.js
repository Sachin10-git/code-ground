const authService = require("../services/auth.service");

/**
 * Register User
 */
const register = async (req, res, next) => {
    try {

        const result = await authService.registerUser(req.body);

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: result,
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Login User
 */
const login = async (req, res, next) => {
    try {

        const result = await authService.loginUser(req.body);

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: result,
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Get Current User
 */
const getCurrentUser = async (req, res) => {

    res.status(200).json({
        success: true,
        message: "Current user endpoint",
    });

};

/**
 * Logout
 */
const logout = async (req, res) => {

    res.status(200).json({
        success: true,
        message: "Logged out successfully",
    });

};

module.exports = {
    register,
    login,
    getCurrentUser,
    logout,
};