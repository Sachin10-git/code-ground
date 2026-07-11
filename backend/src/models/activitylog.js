const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    action: {
        type: String,
        required: true
    },

    resourceType: {
        type: String,
        enum: [
            "project",
            "folder",
            "file",
            "session",
            "snapshot",
            "ai"
        ]
    },

    resourceId: mongoose.Schema.Types.ObjectId,

    metadata: mongoose.Schema.Types.Mixed

},
{
    timestamps: true
});

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);