const http = require("http");

const env = require("./db/config/env");
const logger = require("./utils/logger");
const dockerHealth = require("./services/execution/dockerHealth.service");
const app = require("./app");

const { initializeSocket } = require("./socket/socketServer");

const server = http.createServer(app);

// Initialize Socket.IO
initializeSocket(server);

/**
 * Phase 6 — fail fast if the execution engine's one hard dependency (the
 * Docker daemon) isn't reachable. A backend that "starts successfully"
 * but can't run any submitted code is worse than one that refuses to
 * boot with a clear reason - every code-execution request would instead
 * fail individually, confusingly, at request time.
 *
 * Missing individual language images are logged as a warning, not
 * fatal: they can be pulled after the fact (`docker pull <image>`)
 * without a redeploy, and every other already-present language stays
 * usable in the meantime - that's a degraded state, not a broken one.
 */
async function validateExecutionEngine() {
  const { reachable, error, version } = await dockerHealth.checkDockerReachable();

  if (!reachable) {
    logger.error(
      `Docker daemon is unreachable (${error}). Code execution requires Docker - start Docker and restart the server.`
    );
    process.exit(1);
  }

  logger.info(`Docker daemon reachable (version ${version}).`);

  const images = await dockerHealth.checkRequiredImages();
  const missing = images.filter((img) => !img.available);

  if (missing.length > 0) {
    logger.warn(
      `Missing ${missing.length} required Docker image(s): ${missing
        .map((img) => img.image)
        .join(", ")}. Executions using these languages will fail until the images are pulled.`
    );
  } else {
    logger.info(`All ${images.length} required Docker images are present.`);
  }
}

(async () => {
  if (env.EXECUTION_ENABLED) {
    try {
      await validateExecutionEngine();
    } catch (err) {
      logger.error(`Docker startup validation crashed unexpectedly: ${err.message}`);
      process.exit(1);
      return;
    }
  } else {
    logger.warn("Execution engine disabled. Skipping Docker validation.");
  }

  server.listen(env.PORT, () => {
    logger.info(
      `🚀 Code Ground Backend running on http://localhost:${env.PORT}`
    );
  });
})();