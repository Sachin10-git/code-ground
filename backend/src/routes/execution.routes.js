const express = require("express");

const router = express.Router();

const executionController = require("../controllers/execution.controller");

/*
|--------------------------------------------------------------------------
| Code Execution
|--------------------------------------------------------------------------
*/

router.post(
    "/run",
    executionController.runCode
);

module.exports = router;
