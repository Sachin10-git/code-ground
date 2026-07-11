// src/config/env.js

/**
 * -------------------------------------------------------
 * Environment Configuration
 * -------------------------------------------------------
 * Loads all environment variables from the .env file
 * and exports them as a single object.
 *
 * Instead of using process.env throughout the project,
 * import this file wherever configuration is needed.
 * -------------------------------------------------------
 */
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../../../../.env"),
});

const env = {
    PORT: process.env.PORT || 5000,
    NODE_ENV: process.env.NODE_ENV || "development",

    MONGODB_URI: process.env.MONGODB_URI,

    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,

    JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,

    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    EMAIL_FROM: process.env.EMAIL_FROM,

    CLIENT_URL: process.env.CLIENT_URL,
};

module.exports = env;