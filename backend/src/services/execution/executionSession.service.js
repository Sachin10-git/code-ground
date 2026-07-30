const crypto = require("crypto");

const docker = require("../../db/config/docker");
const logger = require("../../utils/logger");
const workspaceService = require("./tempWorkspace.service");
const languageRunner = require("./languageRunner.service");
const executionQueue = require("./executionQueue.service");
const executionMetrics = require("./executionMetrics.service");

/**
 * Phase 7 — interactive execution sessions.
 *
 * This is a NEW, self-contained module, deliberately NOT built on top of
 * dockerRunner.service.js. That module's `runCode()` is a one-shot,
 * buffered request/response runner (Tty:false, no stdin, waits for a
 * single final result) - Phases 1-6's REST execution path stays exactly
 * as it was, untouched, still using it. An interactive session needs a
 * fundamentally different Docker container shape (a real TTY, open
 * stdin, live streaming instead of a final buffer), so it gets its own
 * container-orchestration code here rather than bending dockerRunner's
 * one-shot contract to also do this.
 *
 * What IS reused, unchanged, exactly as Phases 1-6 left it:
 *   - languageRunner.service.js   → per-language image/fileName/commands/limits
 *   - tempWorkspace.service.js    → temp dir create/write/cleanup
 *   - executionQueue.service.js   → the same concurrency semaphore REST
 *                                   executions use - a session holds its
 *                                   slot for its ENTIRE lifetime (not
 *                                   just startup), released only when it
 *                                   ends, so interactive sessions and
 *                                   one-shot REST runs compete fairly for
 *                                   the same pool of Docker containers.
 *   - executionMetrics.service.js → the same record() call, same shape,
 *                                   called once when a session ends.
 *
 * ── Container exit correctness ───────────────────────────────────────
 *
 * This reuses the exact fix from the Phase 6 dockerRunner.service.js
 * race (see its history): `container.wait({ condition: "next-exit" })`
 * is registered BEFORE `container.start()`, not after - AutoRemove
 * means the daemon can reap a fast-exiting container before a wait()
 * call made only after start() ever reaches it, and the default
 * "not-running" condition resolves immediately for a not-yet-started
 * container regardless. Both gotchas apply here identically and are
 * avoided the same way.
 */

const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TIMEOUT_MS = Number.isFinite(Number(process.env.EXECUTION_SESSION_TIMEOUT_MS))
  ? Number(process.env.EXECUTION_SESSION_TIMEOUT_MS)
  : DEFAULT_SESSION_TIMEOUT_MS;

// Generous compared to the one-shot REST cap (1MB) - interactive
// sessions are expected to run longer and print more, but a runaway
// `while(true) print(...)` still must not be allowed to flood the
// socket connection forever.
const MAX_SESSION_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB

// Small bounded window between a container's confirmed exit and this
// module declaring the session over. Not for correctness of the exit
// code (that's already race-free via wait-before-start above) - purely
// so the last chunk or two of output emitted right at exit has a
// moment to arrive and be forwarded before the frontend is told
// "this session is finished."
const EXIT_FLUSH_GRACE_MS = 300;

const TERMINAL_EVENTS = {
  READY: "terminal:ready",
  OUTPUT: "terminal:output",
  EXIT: "terminal:exit",
  ERROR: "terminal:error",
};

/** sessionId -> session record. The one shared piece of state here. */
const sessions = new Map();

function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Create and start a new interactive execution session for `socket`.
 * Returns the sessionId immediately (synchronously known) while the
 * actual Docker work happens inside executionQueue.run() - the caller
 * (terminalSocket.js) does not need to await this; session lifecycle
 * updates are delivered to `socket` via TERMINAL_EVENTS.
 *
 * @param {Object} params
 * @param {import('socket.io').Socket} params.socket - owns this session;
 *   input/stop/resize for this sessionId are only honored from this
 *   same socket (see terminalSocket.js) - the multi-user isolation this
 *   module relies on.
 * @param {string} params.language
 * @param {string} params.code
 * @param {string} [params.userId]
 * @param {string} [params.projectId]
 * @returns {string} sessionId
 */
function createSession({ socket, language, code, userId, projectId }) {
  const sessionId = generateSessionId();

  if (!language || typeof language !== "string" || !languageRunner.isSupported(language)) {
    socket.emit(TERMINAL_EVENTS.ERROR, {
      sessionId: null,
      message: `Unsupported language: ${language}. Supported languages: ${languageRunner
        .getSupportedLanguages()
        .join(", ")}`,
    });
    return sessionId;
  }

  if (typeof code !== "string" || code.length === 0) {
    socket.emit(TERMINAL_EVENTS.ERROR, { sessionId: null, message: "Code is required" });
    return sessionId;
  }

  const session = {
    id: sessionId,
    socketId: socket.id,
    userId: userId ?? null,
    projectId: projectId ?? null,
    language,
    state: "starting", // starting -> running -> exited
    container: null,
    stream: null,
    startedAt: Date.now(),
    outputBytes: 0,
    truncated: false,
    stopReason: null, // set once, first writer wins: 'stopped' | 'timeout' | 'output-limit' | 'disconnect'
    endedPromiseResolve: null,
  };
  sessions.set(sessionId, session);

  const runPromise = executionQueue.run(async () => {
    const startedAt = Date.now();
    let workspace;
    let exitCode = null;
    let timedOut = false;
    let infrastructureFailure = false;

    try {
      // Stopped while still waiting for a queue slot (or immediately
      // after creation, before this callback even got to run) - never
      // create a container at all. Falls through to the same `finally`
      // below for uniform cleanup/emit/metrics handling.
      if (session.stopReason) return;

      workspace = await workspaceService.createWorkspace();

      const config = languageRunner.getConfig(language, workspace.workspacePath);

      await workspaceService.writeFile(workspace.workspacePath, config.fileName, code);

      const command = config.compileCommand
        ? ["sh", "-c", `${config.compileCommand.join(" ")} && ${config.runCommand.join(" ")}`]
        : config.runCommand;

      const container = await docker.createContainer({
        Image: config.image,
        Cmd: command,
        WorkingDir: config.workingDir,
        Tty: true,
        OpenStdin: true,
        StdinOnce: false,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        HostConfig: {
          Binds: config.binds,
          AutoRemove: true,
          Memory: config.resourceLimits.memory,
          NanoCpus: config.resourceLimits.nanoCpus,
          NetworkMode: config.resourceLimits.networkMode,
          PidsLimit: config.resourceLimits.pidsLimit,
        },
      });

      session.container = container;
      const containerId = container.id;
      let started = false;

      try {
        // attach() lives INSIDE this try/finally, not before it -
        // matching dockerRunner.service.js's established pattern
        // exactly. A failure here still needs the `finally` block's
        // `if (!started) remove()` safety net, or a container that was
        // created but never successfully attached would leak in the
        // "Created" state forever (Docker only auto-removes on exit,
        // and a container that never started never exits).
        const stream = await container.attach({
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
          hijack: true,
        });
        session.stream = stream;

        stream.on("data", (chunk) => {
          if (session.truncated) return;

          session.outputBytes += chunk.length;
          if (session.outputBytes > MAX_SESSION_OUTPUT_BYTES) {
            session.truncated = true;
            session.stopReason = session.stopReason ?? "output-limit";
            logger.warn(
              JSON.stringify({
                event: "execution.session.output.truncated",
                sessionId,
                containerId,
                maxOutputBytes: MAX_SESSION_OUTPUT_BYTES,
              })
            );
            socket.emit(TERMINAL_EVENTS.OUTPUT, {
              sessionId,
              data: "\r\n...[output truncated - exceeded output limit]\r\n",
            });
            container.kill().catch(() => {});
            return;
          }

          socket.emit(TERMINAL_EVENTS.OUTPUT, { sessionId, data: chunk.toString("utf8") });
        });

        // Same wait-before-start ordering as dockerRunner.service.js's
        // Phase 6 fix, for the same reason: AutoRemove can reap a
        // fast-exiting container before a wait() call made only after
        // start() ever reaches the daemon.
        const waitPromise = container.wait({ condition: "next-exit" });
        waitPromise.catch(() => {});

        await container.start();
        started = true;
        session.state = "running";

        /* A stop/timeout could have raced in during createContainer()/
           attach(), above - any kill() call made in that window landed
           on a container that wasn't running yet and was silently a
           no-op (Docker can't kill what hasn't started). Catch up now
           that it actually is running. */
        if (session.stopReason) {
          container.kill().catch(() => {});
        }

        socket.emit(TERMINAL_EVENTS.READY, { sessionId, language });

        const timer = setTimeout(() => {
          timedOut = true;
          session.stopReason = session.stopReason ?? "timeout";
          container.kill().catch(() => {});
        }, SESSION_TIMEOUT_MS);

        let result;
        try {
          result = await waitPromise;
        } finally {
          clearTimeout(timer);
        }

        // Bounded grace period for the last chunk(s) of output to be
        // delivered via the 'data' listener above before this session
        // is declared over - see EXIT_FLUSH_GRACE_MS above.
        await new Promise((resolve) => setTimeout(resolve, EXIT_FLUSH_GRACE_MS));

        exitCode = timedOut ? 124 : result.StatusCode;
      } catch (err) {
        infrastructureFailure = true;
        logger.error(
          JSON.stringify({ event: "execution.session.docker.error", sessionId, message: err.message })
        );
        throw err;
      } finally {
        if (!started) {
          container.remove({ force: true }).catch(() => {});
        }
      }
    } catch (err) {
      infrastructureFailure = true;
      socket.emit(TERMINAL_EVENTS.ERROR, { sessionId, message: err.message || "Execution failed." });
    } finally {
      session.state = "exited";

      const reason = session.stopReason ?? (infrastructureFailure ? "error" : "completed");

      socket.emit(TERMINAL_EVENTS.EXIT, {
        sessionId,
        exitCode,
        reason,
        truncated: session.truncated,
      });

      executionMetrics.record({
        language,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        userId,
        projectId,
        containerId: session.container?.id ?? null,
        infrastructureFailure,
      });

      if (workspace) {
        await workspaceService.cleanup(workspace.workspacePath).catch(() => {});
      }

      sessions.delete(sessionId);
      session.endedPromiseResolve?.();
    }
  });

  // The queue-gated work above resolves/rejects only once the session
  // is fully torn down - nothing here needs that value, but an
  // unattended rejection (e.g. Docker unreachable) must not surface as
  // an unhandled rejection.
  runPromise.catch(() => {});
  session.endedPromise = new Promise((resolve) => {
    session.endedPromiseResolve = resolve;
  });

  return sessionId;
}

/**
 * Forward user keystrokes/input into a running session's container
 * stdin. Silently a no-op for an unknown/already-exited session (the
 * frontend may still have a few queued keystrokes in flight right as
 * a session ends - not an error condition).
 */
function writeInput(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session || session.state !== "running" || !session.stream) return;
  session.stream.write(data);
}

/**
 * Resize the container's TTY to match the frontend terminal's current
 * dimensions, so line-wrapping in interactive/full-screen programs
 * renders correctly. Best-effort - a resize racing a just-exited
 * container is expected and harmless.
 */
function resizeSession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (!session || session.state !== "running" || !session.container) return;
  session.container.resize({ h: rows, w: cols }).catch(() => {});
}

/**
 * Stop a running session. Idempotent - killing an already-exited/
 * already-killed container is a caught no-op, same as the one-shot
 * runner. Returns a promise that resolves once the session has fully
 * torn down (container removed, workspace cleaned up), so callers that
 * need to know cleanup is done (e.g. disconnect handling) can await it.
 */
function stopSession(sessionId, reason = "stopped") {
  const session = sessions.get(sessionId);
  if (!session) return Promise.resolve();

  session.stopReason = session.stopReason ?? reason;

  if (session.container) {
    session.container.kill().catch(() => {});
  }

  return session.endedPromise ?? Promise.resolve();
}

/**
 * Stop every session owned by a given socket - called on socket
 * disconnect (tab close, refresh, network drop, navigation away) so no
 * container is ever left running for a client that's no longer there.
 * Returns a promise that resolves once all of them have finished
 * tearing down.
 */
function cleanupSocketSessions(socketId) {
  const owned = [...sessions.values()].filter((s) => s.socketId === socketId);
  return Promise.all(owned.map((s) => stopSession(s.id, "disconnect")));
}

/** True if `sessionId` exists and belongs to `socketId` - the ownership
 *  check terminalSocket.js uses before honoring input/stop/resize, so
 *  one user's socket can never control another's session. */
function isOwnedBy(sessionId, socketId) {
  const session = sessions.get(sessionId);
  return Boolean(session) && session.socketId === socketId;
}

function getActiveSessionCount() {
  return sessions.size;
}

module.exports = {
  TERMINAL_EVENTS,
  createSession,
  writeInput,
  resizeSession,
  stopSession,
  cleanupSocketSessions,
  isOwnedBy,
  getActiveSessionCount,
  SESSION_TIMEOUT_MS,
};
