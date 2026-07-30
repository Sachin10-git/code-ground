const docker = require("../../db/config/docker");
const languageRunner = require("./languageRunner.service");

/**
 * Phase 6 — Docker reachability + required-image checks, shared by:
 *   - server.js's startup validation (Part 3: fail fast if Docker
 *     itself is unreachable; a backend that "starts successfully" but
 *     can't actually execute any code is worse than one that refuses
 *     to boot with a clear reason).
 *   - the deep health endpoint (Part 6: routes/health.routes.js), which
 *     needs the same checks but must never throw - a health check that
 *     can crash the endpoint it's monitoring defeats its own purpose.
 */

/**
 * @returns {Promise<{ reachable: boolean, error: string|null, version: string|null }>}
 */
async function checkDockerReachable() {
  try {
    const version = await docker.version();
    return { reachable: true, error: null, version: version?.Version ?? null };
  } catch (err) {
    return { reachable: false, error: err.message, version: null };
  }
}

/**
 * @returns {Promise<{ image: string, available: boolean }[]>}
 */
async function checkRequiredImages() {
  const required = languageRunner.getRequiredImages();

  let localTags;
  try {
    const images = await docker.listImages();
    localTags = new Set(images.flatMap((img) => img.RepoTags || []));
  } catch (err) {
    // Docker itself unreachable - every image is unknown/unavailable,
    // not a per-image failure; the caller already knows Docker is down
    // via checkDockerReachable, so just report everything as missing.
    return required.map((image) => ({ image, available: false }));
  }

  return required.map((image) => ({
    image,
    available: localTags.has(image),
  }));
}

module.exports = {
  checkDockerReachable,
  checkRequiredImages,
};
