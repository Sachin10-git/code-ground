const { body, validationResult } = require("express-validator");

const validateInvite = [

    body("email")
        .trim()
        .isEmail()
        .withMessage("Valid email is required"),

    body("role")
        .optional()
        .isIn([
            "viewer",
            "editor"
        ])
        .withMessage("Role must be viewer or editor")

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
    validateInvite,
    validate
};