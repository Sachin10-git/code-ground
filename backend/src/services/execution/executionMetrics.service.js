const logger = require("../../utils/logger");

/**
 * Phase 6 — in-memory execution metrics.
 *
 * No metrics/observability infrastructure (Prometheus, StatsD, etc.) is
 * configured anywhere in this project, so this stays intentionally
 * simple: a bounded ring buffer of recent executions plus running
 * aggregate counters, both readable synchronously by the health
 * endpoint (routes/health.routes.js). Every record is also emitted as a
 * structured log line via the existing logger (see Part 5), so nothing
 * here is the only copy of this data - it's a convenience for the
 * health endpoint, not a new source of truth.
 */

// Caps memory use - this process never needs more than "recent" history
// for a health dashboard; long-term analysis belongs in real log
// aggregation, not this process's heap.
const MAX_RECENT_RECORDS = 200;

const recent = [];

const totals = {
  count: 0,
  succeeded: 0,
  failed: 0,
  timedOut: 0,
  byLanguage: {},
};

/**
 * Record a completed (or failed-to-start) execution.
 *
 * @param {Object} entry
 * @param {string}  entry.language
 * @param {number}  [entry.exitCode]
 * @param {boolean} [entry.timedOut]
 * @param {number}  entry.durationMs
 * @param {string}  [entry.userId]
 * @param {string}  [entry.projectId]
 * @param {string}  [entry.containerId]
 * @param {number}  [entry.memoryUsageBytes]
 * @param {boolean} [entry.infrastructureFailure] - true if the run never
 *   produced an exitCode at all (Docker error), as opposed to the code
 *   itself exiting non-zero.
 */
function record(entry) {
  const item = {
    timestamp: new Date().toISOString(),
    language: entry.language,
    exitCode: entry.exitCode ?? null,
    timedOut: Boolean(entry.timedOut),
    durationMs: entry.durationMs,
    userId: entry.userId ?? null,
    projectId: entry.projectId ?? null,
    containerId: entry.containerId ?? null,
    memoryUsageBytes: entry.memoryUsageBytes ?? null,
    infrastructureFailure: Boolean(entry.infrastructureFailure),
  };

  recent.push(item);
  if (recent.length > MAX_RECENT_RECORDS) {
    recent.shift();
  }

  totals.count += 1;
  if (item.timedOut) totals.timedOut += 1;
  if (!item.infrastructureFailure && item.exitCode === 0) {
    totals.succeeded += 1;
  } else {
    totals.failed += 1;
  }
  totals.byLanguage[item.language] = (totals.byLanguage[item.language] ?? 0) + 1;

  logger.info(
    JSON.stringify({
      event: "execution.metrics.recorded",
      ...item,
    })
  );
}

function getSummary() {
  return {
    ...totals,
    recentCount: recent.length,
  };
}

function getRecent(limit = 50) {
  return recent.slice(-limit);
}

module.exports = {
  record,
  getSummary,
  getRecent,
};
