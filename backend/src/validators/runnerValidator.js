const { body, validationResult } = require("express-validator");

const validateRunCode = [
    body("language")
        .notEmpty()
        .withMessage("Language is required"),

    body("code")
        .notEmpty()
        .withMessage("Code is required"),
];

const validate = (req, res, next) => {

    const errors = validationResult(req);

    if (!errors.isEmpty()) {

        return res.status(400).json({
            success: false,
            errors: errors.array(),
        });

    }

    next();

};

module.exports = {
    validateRunCode,
    validate,
};