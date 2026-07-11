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
 * Refresh Access Token
 */
const refresh = async (req, res, next) => {
    try {

        const refreshToken = req.cookies.refreshToken;

        const result = await authService.refreshAccessToken(refreshToken);

        const { refreshToken: newRefreshToken, ...responseData } = result;

        res.cookie("refreshToken", newRefreshToken, refreshCookieOptions);

        res.status(200).json({
            success: true,
            message: "Access token refreshed successfully",
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
const logout = async (req, res, next) => {
    try {

        const refreshToken = req.cookies.refreshToken;

        await authService.logoutUser(refreshToken);

        res.clearCookie("refreshToken");

        res.status(200).json({
            success: true,
            message: "Logged out from all devices successfully.",
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Forgot Password
 */
const forgotPassword = async (req, res, next) => {
    try {

        await authService.forgotPassword(req.body.email);

        res.status(200).json({
            success: true,
            message: "Password reset email sent successfully.",
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Reset Password
 */
const resetPassword = async (req, res, next) => {
    try {

        await authService.resetPassword(
            req.params.token,
            req.body.password
        );

        res.status(200).json({
            success: true,
            message: "Password reset successfully.",
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Logout All Devices
 */
const logoutAll = async (req, res, next) => {
    try {

        const refreshToken = req.cookies.refreshToken;

        await authService.logoutUser(refreshToken);

        res.clearCookie("refreshToken");

        res.status(200).json({
            success: true,
            message: "All devices logged out successfully.",
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Send Verification Email
 */
const sendVerificationEmail = async (req, res, next) => {
    try {

        await authService.sendVerificationEmail(req.user._id);

        res.status(200).json({
            success: true,
            message: "Verification email sent successfully.",
        });

    } catch (error) {
        next(error);
    }
};

/**
 * Verify Email
 */
const verifyEmail = async (req, res, next) => {
    try {

        await authService.verifyEmail(req.params.token);

        res.status(200).json({
            success: true,
            message: "Email verified successfully.",
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
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
};