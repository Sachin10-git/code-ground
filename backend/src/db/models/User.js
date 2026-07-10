const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

    username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
},

    email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
},

    password: {
        type: String,
        required: true
    },

    passwordResetToken: {
    type: String,
    default: null,
},

passwordResetExpires: {
    type: Date,
    default: null,
},

emailVerified: {
    type: Boolean,
    default: false,
},

emailVerificationToken: {
    type: String,
    default: null,
},

emailVerificationExpires: {
    type: Date,
    default: null,
},

    avatar: {
        type: String,
        default: ""
    },

    role: {
        type: String,
        enum: ["user", "admin"],
        default: "user"
    },

    workspaces: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project"
    }]

}, {
    timestamps: true
});

module.exports = mongoose.model("User", UserSchema);