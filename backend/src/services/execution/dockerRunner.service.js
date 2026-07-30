const Docker = require("dockerode");
const { PassThrough } = require("stream");

const docker = require("../../db/config/docker");
const logger = require("../../utils/logger");

// Phase 6 — hard cap on accumulated stdout+stderr bytes. Without this, a
// runaway `while(true) print(...)` loop keeps this Node process's memory
// growing for the full length of the container's own timeout (up to
// tens of seconds) purely by concatenating stream data - this cap kills
// the container the moment output crosses the line, independent of the
// timeout.
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB

class DockerRunnerService {
  async ping() {
    return await docker.ping();
  }

  async version() {
    return await docker.version();
  }

  async pullImage(image) {
    return new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err);

        docker.modem.followProgress(stream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async runHelloContainer() {
    const container = await docker.createContainer({
      Image: "alpine:latest",
      Cmd: ["echo", "Hello from Docker!"],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        AutoRemove: true,
      },
    });

    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    let output = "";
    let errorOutput = "";

    stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    docker.modem.demuxStream(stream, stdout, stderr);

    await container.start();
    await container.wait();

    return {
      stdout: output.trim(),
      stderr: errorOutput.trim(),
    };
  }

  /**
   * Generic, language-agnostic container runner. Takes a fully-resolved
   * language config (image, workingDir, binds, compile/run commands,
   * resource limits) and executes it inside a single throwaway container.
   *
   * Language-specific behavior must live in languageRunner.service.js
   * config, not here.
   */
  async runCode(config) {
    const {
      image,
      workingDir,
      binds,
      compileCommand,
      runCommand,
      resourceLimits = {},
      timeout = 30000,
      maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
      signal,
    } = config;

    /* Phase 6 — the HTTP client already disconnected before we even got
       here (e.g. cancelled while still waiting on a queue slot). Skip
       creating a container at all rather than starting one just to
       immediately kill it. */
    if (signal?.aborted) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "Execution cancelled before it started.",
        timedOut: false,
        cancelled: true,
        truncated: false,
        containerId: null,
        memoryUsageBytes: null,
      };
    }

    const command = compileCommand
      ? ["sh", "-c", `${compileCommand.join(" ")} && ${runCommand.join(" ")}`]
      : runCommand;

    const container = await docker.createContainer({
      Image: image,
      Cmd: command,
      WorkingDir: workingDir,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        Binds: binds,
        AutoRemove: true,
        Memory: resourceLimits.memory ?? 512 * 1024 * 1024, // 512 MB
        NanoCpus: resourceLimits.nanoCpus ?? 1_000_000_000, // 1 CPU
        NetworkMode: resourceLimits.networkMode ?? "none",
        PidsLimit: resourceLimits.pidsLimit ?? 128,
      },
    });

    const containerId = container.id;

    // Becomes true once container.start() succeeds - from that point,
    // Docker's own AutoRemove fires when the container exits (however it
    // exits: naturally, killed by our timeout, or killed by the output
    // cap below), so no extra cleanup is needed. If anything throws
    // BEFORE this (attach failing, start failing), AutoRemove never had
    // anything to trigger on - Docker only removes a container on exit,
    // and a container that never started never exits - so it would
    // otherwise leak in the "Created" state forever. The finally block
    // below is the safety net for exactly that gap.
    let started = false;

    /* Phase 6 — client-cancellation support. If the caller's AbortSignal
       fires (HTTP client disconnected - see execution.controller.js),
       kill the container the same way the timeout below does. Sharing
       that mechanism means cancellation gets the exact same
       AutoRemove-on-exit cleanup as every other exit path - no separate
       cleanup logic needed. */
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      container.kill().catch(() => {});
    };
    signal?.addEventListener("abort", onAbort);

    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      const stdout = new PassThrough();
      const stderr = new PassThrough();

      let output = "";
      let errorOutput = "";
      let outputBytes = 0;
      let truncated = false;

      /* Phase 6 — hard cap on accumulated output. A runaway print loop
         must not be allowed to grow this process's memory or the final
         JSON response without bound; once the cap is crossed we stop
         appending further data AND kill the container immediately
         (there's no reason to let it keep burning CPU once its output
         is being discarded anyway). */
      const appendCapped = (buffer, chunk) => {
        if (truncated) return buffer;
        const text = chunk.toString();
        outputBytes += Buffer.byteLength(text);
        if (outputBytes > maxOutputBytes) {
          truncated = true;
          logger.warn(
            JSON.stringify({
              event: "execution.output.truncated",
              containerId,
              maxOutputBytes,
            })
          );
          container.kill().catch(() => {});
        }
        return buffer + text;
      };

      stdout.on("data", (chunk) => {
        output = appendCapped(output, chunk);
      });

      stderr.on("data", (chunk) => {
        errorOutput = appendCapped(errorOutput, chunk);
      });

      // Demultiplex Docker's stdout/stderr stream
      docker.modem.demuxStream(stream, stdout, stderr);

      /* Phase 6 fix — container.wait() and this attach()'d stream are
         two independent connections to the daemon with no ordering
         guarantee between them. Once wait() was made fast enough to
         win the AutoRemove race (see below), it could also resolve
         BEFORE all of this stream's data had arrived and been demuxed
         into `output`/`errorOutput` - a fast script's exit status could
         land before its own last stdout chunk did, and reading
         `output` at that point would see an empty string.

         This listens on the raw attach() stream itself, NOT on the
         `stdout`/`stderr` PassThroughs below - docker-modem's
         demuxStream() only ever calls .write() on those two, it never
         .end()s them, so waiting on their 'end' event hangs forever
         (found this the hard way: it hung every execution, timeout
         included, since nothing bounds a PassThrough 'end' that will
         never come). The daemon does properly end/close this
         underlying attach connection once the container's output is
         fully flushed - that's what demuxStream itself is consuming
         'data' from. */
      const streamEndPromise = new Promise((resolve) => {
        stream.once("end", resolve);
        stream.once("close", resolve);
      });

      /* Phase 6 fix — subscribe to the container's exit BEFORE calling
         start(), not merely before other awaits. HostConfig.AutoRemove
         means the daemon deletes the container the instant its
         process exits - it does not wait for us to ask. Registering
         wait() only AFTER `await container.start()` resolves still
         leaves a gap: the JS event loop tick between that await
         settling and our very next line running is enough time, for a
         fast-enough container (Node failing to even parse a syntax
         error, or a compile step that dies before any runtime starts),
         for the daemon to have already reaped it - which is exactly
         what still 404'd on wait() after moving the call merely
         earlier in this function. Calling wait() before start() closes
         that gap completely: the daemon's exit subscription is live
         before the container can possibly finish running, so no
         matter how many microseconds later it exits, it exits into an
         already-open wait() call rather than racing to beat one that
         hasn't been made yet.

         `condition: "next-exit"` is required here, not the default
         ("not-running"): a container that hasn't been started yet is
         ALREADY "not running" (state = "created"), so the default
         condition resolves immediately with a bogus zero status the
         instant it's called pre-start - it does not wait for the run
         that's about to happen at all. "next-exit" explicitly waits
         for the next time the container stops, which is what makes
         calling this before start() correct instead of a no-op. */
      const waitPromise = container.wait({ condition: "next-exit" });
      /* If container.start() below throws (bad image, invalid config),
         this function returns without ever reaching the `await
         waitPromise` below - left completely unattended, a later
         rejection of this same promise (e.g. once the `finally` block's
         force-remove settles it) would surface as an unhandled
         rejection. This silencing catch doesn't consume the result -
         `await waitPromise` further down still sees the real
         resolution/rejection - it only guarantees SOME handler exists
         immediately, in every path. */
      waitPromise.catch(() => {});

      await container.start();
      started = true;

      /* Best-effort single memory sample (Part 4: "if available").
         Now happens after wait() is already subscribed, so this
         being slow (or itself hitting a reaped container) no longer
         widens the race for wait() - it can still legitimately fail
         for a container that's already gone, which is why it's still
         wrapped and swallowed as optional. */
      let memoryUsageBytes = null;
      try {
        const stats = await container.stats({ stream: false });
        memoryUsageBytes = stats?.memory_stats?.usage ?? null;
      } catch (_) {
        // Container already exited, or stats unsupported - fine, optional.
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        container.kill().catch(() => {});
      }, timeout);

      let result;
      try {
        result = await waitPromise;

        /* Exit status is confirmed - give the attach stream a brief,
           BOUNDED grace period to finish flushing whatever's already
           in flight (normally near-instant, since the daemon closes
           this connection right after the same exit). Bounded
           deliberately: unlike waitPromise, this doesn't have the
           `timeout` config value's protection, so an unbounded wait
           here would trade one hang for another if this connection
           ever fails to close cleanly. */
        await Promise.race([
          streamEndPromise,
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } finally {
        clearTimeout(timer);
      }

      if (truncated) {
        output = `${output}\n...[output truncated - exceeded ${maxOutputBytes} bytes]`;
      }

      return {
        exitCode: cancelled ? null : timedOut ? 124 : result.StatusCode,
        stdout: output.trim(),
        stderr: cancelled
          ? errorOutput.trim() || "Execution cancelled by client."
          : timedOut
          ? errorOutput.trim() || "Execution timed out."
          : errorOutput.trim(),
        timedOut,
        cancelled,
        truncated,
        containerId,
        memoryUsageBytes,
      };
    } catch (err) {
      logger.error(
        JSON.stringify({
          event: "docker.error",
          containerId,
          message: err.message,
        })
      );
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (!started) {
        container.remove({ force: true }).catch(() => {});
      }
    }
  }

  /**
   * Preserved for backwards compatibility - delegates to the generic
   * runner using the same config shape languageRunner.service.js has
   * always produced for Java.
   */
  async runJava(config) {
    return this.runCode(config);
  }
}

module.exports = new DockerRunnerService();