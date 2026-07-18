const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authenticate");

const {
    chatWithAI,
    explainCode,
    reviewCode,
    refactorCode,
    generateCode,
} = require("../controllers/ai.controller");

router.post(
    "/chat",
    authenticate,
    chatWithAI
);

router.post(
    "/explain",
    authenticate,
    explainCode
);

router.post(
    "/review",
    authenticate,
    reviewCode
);

router.post(
    "/refactor",
    authenticate,
    refactorCode
);

router.post(
    "/generate",
    authenticate,
    generateCode
);

module.exports = router;