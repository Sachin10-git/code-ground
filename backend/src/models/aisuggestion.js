const mongoose = require("mongoose");

const AISuggestionSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "File",
        required: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    lineNumber: Number,

    selectedCode: String,

    prompt: String,

    suggestion: String,

    status: {
        type: String,
        enum: ["pending", "accepted", "rejected"],
        default: "pending"
    }

},
{
    timestamps: true
});

module.exports = mongoose.model("AISuggestion", AISuggestionSchema);