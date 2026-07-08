const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
{
    name: {
        type: String,
        required: true,
        trim: true
    },

    description: {
        type: String,
        default: ""
    },

    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    members: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },

        role: {
            type: String,
            enum: ["owner", "editor", "viewer"],
            default: "viewer"
        }
    }],

    visibility: {
        type: String,
        enum: ["private", "public"],
        default: "private"
    },

    language: {
        type: String,
        default: "javascript"
    },

    githubRepo: {
        type: String,
        default: ""
    }

},
{
    timestamps: true
});

module.exports = mongoose.model("Project", ProjectSchema);