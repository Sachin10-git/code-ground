/**
 * -------------------------------------------------------
 * Logger Utility
 * -------------------------------------------------------
 * Centralized logger used across the project.
 * Every log includes a timestamp and log level.
 * -------------------------------------------------------
 */

/**
 * Returns the current date & time in a readable format.
 */
const getTimestamp = () => {
  return new Date().toLocaleString();
};

const logger = {
  info(message) {
    console.log(`[${getTimestamp()}] [INFO] ${message}`);
  },

  warn(message) {
    console.warn(`[${getTimestamp()}] [WARN] ${message}`);
  },

  error(message) {
    console.error(`[${getTimestamp()}] [ERROR] ${message}`);
  },
};

module.exports = logger;