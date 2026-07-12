const { body, param, validationResult } = require("express-validator");

// Validation rules for creating a project
const validateCreateProject = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Project name is required")
    .isLength({ min: 3, max: 50 })
    .withMessage("Project name must be between 3 and 50 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters")
];

// Validation rules for updating a project
const validateUpdateProject = [
  param("id")
    .isMongoId()
    .withMessage("Invalid project ID"),

  body("name")
    .optional()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage("Project name must be between 3 and 50 characters"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters")
];

// Validation rules for project ID params
const validateProjectId = [
  param("id")
    .isMongoId()
    .withMessage("Invalid project ID")
];

// Middleware to send validation errors
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
  validateCreateProject,
  validateUpdateProject,
  validateProjectId,
  validate
};