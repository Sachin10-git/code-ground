const workspaceService = require("./tempWorkspace.service");
const languageRunner = require("./languageRunner.service");
const dockerRunner = require("./dockerRunner.service");
const executionQueue = require("./executionQueue.service");
const executionMetrics = require("./executionMetrics.service");
const ApiError = require("../../utils/ApiError");

class ExecutionService {
  /**
   * Orchestrates a single code execution: validate -> queue -> create
   * workspace -> resolve language config -> write source -> run in
   * Docker -> record metrics -> cleanup.
   *
   * Compilation/runtime failures are NOT thrown here - they come back from
   * dockerRunner.runCode() as a normal result (non-zero exitCode, populated
   * stderr) because the container itself ran successfully. Only actual
   * infrastructure failures (Docker unreachable, workspace I/O failure,
   * unsupported language) throw.
   *
   * Validation happens BEFORE executionQueue.run() - a bad request
   * (unsupported language, missing code) should reject immediately, not
   * take up a concurrency slot waiting behind real executions.
   *
   * `signal` (an AbortSignal, optional) lets the caller cancel a
   * still-running execution - see execution.controller.js, which aborts
   * it when the HTTP client disconnects early.
   */
  async execute({ language, code, userId, projectId, signal }) {
    if (!language || typeof language !== "string") {
      throw new ApiError(400, "Language is required");
    }

    if (typeof code !== "string" || code.length === 0) {
      throw new ApiError(400, "Code is required");
    }

    if (!languageRunner.isSupported(language)) {
      throw new ApiError(
        400,
        `Unsupported language: ${language}. Supported languages: ${languageRunner
          .getSupportedLanguages()
          .join(", ")}`
      );
    }

    return executionQueue.run(async () => {
      const startedAt = Date.now();
      let workspace;

      try {
        workspace = await workspaceService.createWorkspace();

        const config = languageRunner.getConfig(
          language,
          workspace.workspacePath
        );

        await workspaceService.writeFile(
          workspace.workspacePath,
          config.fileName,
          code
        );

        const result = await dockerRunner.runCode({ ...config, signal });

        executionMetrics.record({
          language,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: Date.now() - startedAt,
          userId,
          projectId,
          containerId: result.containerId,
          memoryUsageBytes: result.memoryUsageBytes,
        });

        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          cancelled: result.cancelled ?? false,
        };
      } catch (err) {
        /* The container never produced a usable result at all (Docker
           unreachable, image pull failure, workspace I/O error) - as
           opposed to running fine and exiting non-zero, which is
           handled above and isn't an error path. */
        executionMetrics.record({
          language,
          durationMs: Date.now() - startedAt,
          userId,
          projectId,
          infrastructureFailure: true,
        });
        throw err;
      } finally {
        if (workspace) {
          await workspaceService.cleanup(workspace.workspacePath);
        }
      }
    });
  }

  /**
   * Current concurrency state - used by the deep health endpoint
   * (routes/health.routes.js) to expose queue depth.
   */
  getQueueStatus() {
    return {
      active: executionQueue.getActiveCount(),
      waiting: executionQueue.getQueueLength(),
      maxConcurrent: executionQueue.MAX_CONCURRENT_EXECUTIONS,
    };
  }
}

module.exports = new ExecutionService();
