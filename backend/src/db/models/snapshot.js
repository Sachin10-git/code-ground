const mongoose = require("mongoose");

const SnapshotSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    message: String,

    files: [{
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "File"
        },

        content: String
    }]

},
{
    timestamps: true
});

module.exports = mongoose.model("Snapshot", SnapshotSchema);