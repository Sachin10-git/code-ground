/**
 * Phase 6 — execution concurrency queue.
 *
 * Docker containers are expensive (each execution spins up a real
 * container). Without a cap, N simultaneous Run clicks spin up N
 * containers at once with no ceiling, which is how a handful of users
 * (or one runaway/malicious client hammering the endpoint) can exhaust
 * host CPU/memory/PIDs and degrade every other execution and every
 * other Docker-dependent request on the box.
 *
 * A plain in-process semaphore is enough here - this app runs a single
 * Node process (see Phase 5.5's notes on the same limitation for CRDT
 * hydration), so there's no cross-process state to coordinate.
 */

const DEFAULT_MAX_CONCURRENT = 4;

const MAX_CONCURRENT_EXECUTIONS = Number.isFinite(Number(process.env.EXECUTION_MAX_CONCURRENT))
  ? Number(process.env.EXECUTION_MAX_CONCURRENT)
  : DEFAULT_MAX_CONCURRENT;

let active = 0;
/** FIFO of resolvers waiting for a free slot. */
const waiting = [];

function acquire() {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENT_EXECUTIONS) {
      active += 1;
      resolve();
      return;
    }
    waiting.push(resolve);
  });
}

function release() {
  active -= 1;

  const next = waiting.shift();
  if (next) {
    active += 1;
    next();
  }
}

/**
 * Run `fn` once a concurrency slot is available, queueing the caller
 * (FIFO) if the limit is already reached. `fn` receives `{ queueWaitMs }`
 * so callers can log/record how long the request actually waited.
 */
async function run(fn) {
  const waitStart = Date.now();
  await acquire();
  const queueWaitMs = Date.now() - waitStart;

  try {
    return await fn({ queueWaitMs });
  } finally {
    release();
  }
}

function getQueueLength() {
  return waiting.length;
}

function getActiveCount() {
  return active;
}

module.exports = {
  run,
  getQueueLength,
  getActiveCount,
  MAX_CONCURRENT_EXECUTIONS,
};
