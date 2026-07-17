const RefreshToken = require("../db/models/RefreshToken");

/**
 * Create and store a new refresh token
 */
const createRefreshToken = async (userId, token, expiresAt) => {

    return await RefreshToken.create({
        user: userId,
        token,
        expiresAt,
    });

};

/**
 * Find a refresh token
 */
const findRefreshToken = async (token) => {

    return await RefreshToken.findOne({
        token,
        isRevoked: false,
    }).populate("user");

};

/**
 * Revoke a refresh token
 */
const revokeRefreshToken = async (token) => {

    return await RefreshToken.findOneAndUpdate(
        { token },
        { isRevoked: true },
        { returnDocument: "after" }
    );

};

/**
 * Revoke all refresh tokens for a user
 */
const revokeAllRefreshTokens = async (userId) => {

    return await RefreshToken.updateMany(
        { user: userId },
        { isRevoked: true }
    );

};

/**
 * Delete expired refresh tokens
 */
const deleteExpiredTokens = async () => {

    return await RefreshToken.deleteMany({
        expiresAt: {
            $lt: new Date(),
        },
    });

};

module.exports = {
    createRefreshToken,
    findRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokens,
    deleteExpiredTokens,
};