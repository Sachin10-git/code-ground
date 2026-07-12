const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    hostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    status: {
        type: String,
        enum: ["active", "ended"],
        default: "active"
    },

    startedAt: {
        type: Date,
        default: Date.now
    },

    endedAt: Date
});

module.exports = mongoose.model("Session", SessionSchema);