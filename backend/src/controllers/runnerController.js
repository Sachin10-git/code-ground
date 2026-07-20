const asyncHandler = require("../middleware/asyncHandler");

const runnerService = require("../services/runnerService");

const runCode = asyncHandler(async (req, res) => {

    const result = await runnerService.runCode(
        req.body
    );

    return res.status(200).json({
        success: true,
        message: "Execution completed",
        data: result,
    });

});

module.exports = {
    runCode,
};