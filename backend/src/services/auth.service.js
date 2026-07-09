const User = require("../models/User");
const { hashPassword, comparePassword } = require("../utils/password");
const {
    generateAccessToken,
    generateRefreshToken,
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

module.exports = {
    registerUser,
    loginUser
};