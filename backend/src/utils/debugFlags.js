/**
 * Centralized debug flags — gate verbose, high-frequency socket
 * trace logs (cursor broadcasts, room-membership dumps) behind an
 * explicit opt-in env var so terminals stay clean by default while
 * the trace is still one env var away when collaboration bugs need
 * it again.
 *
 * Usage: DEBUG_COLLAB=true npm run dev
 */
const DEBUG_COLLAB = process.env.DEBUG_COLLAB === "true";

module.exports = {
    DEBUG_COLLAB,
};
