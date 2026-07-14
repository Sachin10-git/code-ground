const mongoose = require("mongoose");

const FolderSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    name: {
        type: String,
        required: true
    },

    parentFolderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Folder",
        default: null
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

module.exports = mongoose.model("Folder", FolderSchema);
FolderSchema.index({
    projectId: 1,
    parentFolderId: 1,
});