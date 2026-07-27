const { body, validationResult } = require("express-validator");

// Shared across every AI action route (chat today; explain/review/
// refactor/generate later) — they all take the same request shape,
// since aiContextBuilder.prepareAIContext expects the same fields
// regardless of which system prompt ends up being used.
const validateAIRequest = [
  body("projectId")
    .isMongoId()
    .withMessage("A valid projectId is required"),

  body("fileId")
    .isMongoId()
    .withMessage("A valid fileId is required"),

  body("userPrompt")
    .trim()
    .notEmpty()
    .withMessage("userPrompt is required")
    .isLength({ max: 8000 })
    .withMessage("userPrompt must be 8000 characters or fewer"),

  body("selectedCode")
    .optional()
    .isString()
    .withMessage("selectedCode must be a string"),

  body("fileContent")
    .optional()
    .isString()
    .withMessage("fileContent must be a string"),

  body("chatHistory")
    .optional()
    .isArray()
    .withMessage("chatHistory must be an array"),
];

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  next();
};

module.exports = {
  validateAIRequest,
  validate
};
