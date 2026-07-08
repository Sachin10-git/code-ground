/**
 * -------------------------------------------------------
 * Logger Utility
 * -------------------------------------------------------
 * A centralized logging utility.
 *
 * Why?
 * ----
 * Instead of using console.log() everywhere,
 * we use logger methods.
 *
 * Later we can replace console with Winston,
 * Pino or any cloud logging service without
 * changing the rest of the project.
 * -------------------------------------------------------
 */

const logger = {
  /**
   * General application information.
   */
  info(message) {
    console.log(`[INFO] ${message}`);
  },

  /**
   * Warning messages.
   */
  warn(message) {
    console.warn(`[WARN] ${message}`);
  },

  /**
   * Error messages.
   */
  error(message) {
    console.error(`[ERROR] ${message}`);
  },
};

module.exports = logger;