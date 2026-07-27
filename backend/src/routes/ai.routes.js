const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authenticate");
const { validateAIRequest, validate } = require("../validators/aiValidator");

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
    validateAIRequest,
    validate,
    chatWithAI
);

router.post(
    "/explain",
    authenticate,
    validateAIRequest,
    validate,
    explainCode
);

router.post(
    "/review",
    authenticate,
    validateAIRequest,
    validate,
    reviewCode
);

router.post(
    "/refactor",
    authenticate,
    validateAIRequest,
    validate,
    refactorCode
);

router.post(
    "/generate",
    authenticate,
    validateAIRequest,
    validate,
    generateCode
);

module.exports = router;
