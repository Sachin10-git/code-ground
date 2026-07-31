const express = require("express");

const router = express.Router();

const executionController = require("../controllers/execution.controller");
const executionGate = require("../middleware/executionGate");

/*
|--------------------------------------------------------------------------
| Code Execution
|--------------------------------------------------------------------------
*/

router.post(
    "/run",
    executionGate,
    executionController.runCode
);

module.exports = router;
