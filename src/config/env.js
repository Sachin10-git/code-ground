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

require("dotenv").config();

const env = {
  PORT: process.env.PORT || 5000,

  NODE_ENV: process.env.NODE_ENV || "development",

  MONGODB_URI: process.env.MONGODB_URI,

  JWT_SECRET: process.env.JWT_SECRET,

  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
};

module.exports = env;