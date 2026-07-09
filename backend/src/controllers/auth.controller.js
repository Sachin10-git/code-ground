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

    const user = {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        avatar: req.user.avatar,
        role: req.user.role,
        workspaces: req.user.workspaces,
    };

    res.status(200).json({
        success: true,
        message: "Current user fetched successfully",
        data: {
            user,
        },
    });

};

/**
 * Logout User
 */
const logout = async (req, res) => {

    res.status(200).json({
        success: true,
        message: "Logout successful.",
    });

};

module.exports = {
    register,
    login,
    getCurrentUser,
    logout,
};