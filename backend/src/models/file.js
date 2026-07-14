const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true
    },

    folderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Folder",
        default: null,
        index: true
    },

    name: {
        type: String,
        required: true,
        trim: true
    },

    language: {
        type: String,
        default: "plaintext"
    },

    content: {
        type: String,
        default: ""
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }

},
{
    timestamps: true
});

FileSchema.index({
    projectId: 1,
    folderId: 1,
});

module.exports = mongoose.model("File", FileSchema);