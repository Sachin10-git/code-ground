const express = require("express");

const router = express.Router();

const {
    runCode,
} = require("../controllers/runnerController");

const {
    validateRunCode,
    validate,
} = require("../validators/runnerValidator");

/*
|--------------------------------------------------------------------------
| Code Runner
|--------------------------------------------------------------------------
*/

router.post(
    "/",
    validateRunCode,
    validate,
    runCode
);

module.exports = router;