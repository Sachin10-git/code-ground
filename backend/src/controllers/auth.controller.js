const authService = require("../services/auth.service");

/**
 * Cookie configuration for Refresh Token
 */
const refreshCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Register User
 */
const register = async (req, res, next) => {
    try {

        const result = await authService.registerUser(req.body);

        const { refreshToken, ...responseData } = result;

        res.cookie("refreshToken", refreshToken, refreshCookieOptions);

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            data: responseData,
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

        const { refreshToken, ...responseData } = result;

        res.cookie("refreshToken", refreshToken, refreshCookieOptions);

        res.status(200).json({
            success: true,
            message: "Login successful",
            data: responseData,
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

    res.clearCookie("refreshToken");

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