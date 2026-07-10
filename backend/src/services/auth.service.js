const User = require("../db/models/User");
const { hashPassword, comparePassword } = require("../utils/password");
const crypto = require("crypto");
const { sendEmail } = require("./email.service");

const {
    createRefreshToken,
    findRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokens,
} = require("./refreshToken.service");

const {
    generateAccessToken,
    generateRefreshToken,
    verifyRefreshToken,
    getRefreshTokenExpiryDate,
} = require("../utils/jwt");

const AppError = require("../utils/AppError");

const registerUser = async (userData) => {

    const { username, email, password } = userData;

    // Check if email already exists
    const existingEmail = await User.findOne({ email });

    if (existingEmail) {
        throw new AppError("Email already registered", 409);
    }

    // Check if username already exists
    const existingUsername = await User.findOne({ username });

    if (existingUsername) {
        throw new AppError("Username already taken", 409);
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await User.create({
        username,
        email,
        password: hashedPassword,
    });

    // Generate JWT
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    await createRefreshToken(
    user._id,
    refreshToken,
    getRefreshTokenExpiryDate()
    );

    // Remove password before sending response
    const userResponse = {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    workspaces: user.workspaces,
};
    delete userResponse.password;

    return {
        user: userResponse,
        accessToken,
        refreshToken,
    };

};

const loginUser = async (credentials) => {

    const { email, password } = credentials;

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
        throw new AppError("Invalid email or password", 401);
    }

    // Compare password
    const isPasswordValid = await comparePassword(
        password,
        user.password
    );

    if (!isPasswordValid) {
        throw new AppError("Invalid email or password", 401);
    }

    // Generate JWT
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    
    await createRefreshToken(
    user._id,
    refreshToken,
    getRefreshTokenExpiryDate()
    );
    // Remove password before sending response
    const userResponse = {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    workspaces: user.workspaces,
};
    delete userResponse.password;

    return {
        user: userResponse,
        accessToken,
        refreshToken,
    };

};

const logoutUser = async (refreshToken) => {

    if (!refreshToken) {
        throw new AppError("Refresh token is required", 400);
    }

    await revokeRefreshToken(refreshToken);

};

const refreshAccessToken = async (refreshToken) => {

    if (!refreshToken) {
        throw new AppError("Refresh token is required", 401);
    }

    // Verify JWT
    const decoded = verifyRefreshToken(refreshToken);

    // Check token exists in DB
    const storedToken = await findRefreshToken(refreshToken);

    if (!storedToken) {
        throw new AppError("Invalid refresh token", 401);
    }

    // Revoke old token
    await revokeRefreshToken(refreshToken);

    // Generate new tokens
    const accessToken = generateAccessToken(decoded.id);
    const newRefreshToken = generateRefreshToken(decoded.id);

    // Store new refresh token
    await createRefreshToken(
        decoded.id,
        newRefreshToken,
        getRefreshTokenExpiryDate()
    );

    return {
        accessToken,
        refreshToken: newRefreshToken,
    };
};

const logoutAllUsers = async (userId) => {

    await revokeAllRefreshTokens(userId);

};

const forgotPassword = async (email) => {

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
        throw new AppError("User not found.", 404);
    }

    // Generate random token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash token before saving
    const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

    // Save hash & expiry
    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(
        Date.now() + 15 * 60 * 1000 // 15 minutes
    );

    await user.save();

    // Reset URL
    const resetURL = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    // Send email
    await sendEmail({
        to: user.email,
        subject: "Code Ground Password Reset",
        html: `
            <h2>Password Reset Request</h2>

            <p>Hello ${user.username},</p>

            <p>Click the link below to reset your password:</p>

            <a href="${resetURL}">
                Reset Password
            </a>

            <p>This link will expire in 15 minutes.</p>

            <p>If you did not request this, please ignore this email.</p>
        `,
    });

};

const resetPassword = async (token, newPassword) => {

    // Hash incoming token
    const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

    // Find user
    const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: {
            $gt: new Date(),
        },
    });

    if (!user) {
        throw new AppError("Invalid or expired reset token.", 400);
    }

    // Hash new password
    user.password = await hashPassword(newPassword);

    // Clear reset fields
    user.passwordResetToken = null;
    user.passwordResetExpires = null;

    await user.save();

};

const sendVerificationEmail = async (userId) => {

    const user = await User.findById(userId);

    if (!user) {
        throw new AppError("User not found.", 404);
    }

    if (user.emailVerified) {
        throw new AppError("Email is already verified.", 400);
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // Hash token
    const hashedToken = crypto
        .createHash("sha256")
        .update(verificationToken)
        .digest("hex");

    // Save token & expiry
    user.emailVerificationToken = hashedToken;
    user.emailVerificationExpires = new Date(
        Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    );

    await user.save();

    // Verification URL
    const verificationURL =
        `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

    // Send email
    await sendEmail({
        to: user.email,
        subject: "Verify your Code Ground account",
        html: `
            <h2>Verify Your Email</h2>

            <p>Hello ${user.username},</p>

            <p>Please click the link below to verify your email address:</p>

            <a href="${verificationURL}">
                Verify Email
            </a>

            <p>This link will expire in 24 hours.</p>
        `,
    });

};

const verifyEmail = async (token) => {

    const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

    const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: {
            $gt: new Date(),
        },
    });

    if (!user) {
        throw new AppError("Invalid or expired verification token.", 400);
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;

    await user.save();

};

module.exports = {
    registerUser,
    loginUser,
    refreshAccessToken,
    resetPassword,
    forgotPassword,
    logoutUser,
    logoutAllUsers,
    sendVerificationEmail,
    verifyEmail,
};