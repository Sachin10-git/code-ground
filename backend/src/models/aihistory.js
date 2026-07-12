const mongoose = require("mongoose");

const AIHistorySchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "File"
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    prompt: {
        type: String,
        required: true
    },

    response: {
        type: String,
        required: true
    },

    model: String,

    tokensUsed: Number,

    executionTime: Number

},
{
    timestamps: true
});

module.exports = mongoose.model("AIHistory", AIHistorySchema);