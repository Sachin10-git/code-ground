const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    folderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Folder",
        default: null
    },

    name: {
        type: String,
        required: true,
        trim: true
    },

    extension: {
        type: String,
        required: true
    },

    language: {
        type: String,
        required: true
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

module.exports = mongoose.model("File", FileSchema);