const { body, validationResult } = require("express-validator");

// Optional per the spec — a blank name falls back to a generated
// display label on the frontend (e.g. "Snapshot – Jul 27, 2026").
const validateSnapshotName = [
    body("name")
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ max: 100 })
        .withMessage("Snapshot name cannot exceed 100 characters"),
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
    validateSnapshotName,
    validate
};
