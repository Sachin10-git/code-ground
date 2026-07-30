const asyncHandler = require("../middleware/asyncHandler");
const ApiResponse = require("../utilities/ApiResponse");
const executionService = require("../services/execution/execution.service");

/**
 * Run Code
 *
 * Thin pass-through to executionService.execute(), which owns all
 * validation, workspace/orchestration, and error semantics (ApiError(400)
 * for bad input, thrown errors for infrastructure failures). This
 * controller does not talk to Docker or duplicate that logic.
 *
 * Two things it does add on top of that pass-through:
 *   - userId/projectId, forwarded to executionMetrics (userId is only
 *     ever populated if an auth middleware upstream sets req.user -
 *     this route currently has none, so it stays null until one is
 *     added; projectId comes from the request body if the caller sends
 *     one).
 *   - an AbortSignal tied to the HTTP connection, so a client that
 *     disconnects mid-execution (page navigated away, Cancel button)
 *     actually kills the Docker container instead of leaving it running
 *     for the rest of its timeout with nobody listening for the result.
 */
const runCode = asyncHandler(async (req, res) => {

    const { language, code, projectId } = req.body;

    const abortController = new AbortController();

    const onClientDisconnect = () => {
        if (!res.writableEnded) abortController.abort();
    };
    res.on("close", onClientDisconnect);

    try {

        const result = await executionService.execute({
            language,
            code,
            userId: req.user?._id?.toString(),
            projectId,
            signal: abortController.signal,
        });

        return ApiResponse.success(
            res,
            200,
            "Execution completed",
            result
        );

    } finally {
        res.off("close", onClientDisconnect);
    }

});

module.exports = {
    runCode,
};
