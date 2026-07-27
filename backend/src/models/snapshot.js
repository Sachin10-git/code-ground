const mongoose = require("mongoose");

/**
 * Phase 6.7 — project-wide Snapshots.
 *
 * Captures the full state of a project (every file's content, the
 * folder hierarchy, and who/when) so it can be restored later. Each
 * file/folder entry keeps its ORIGINAL _id (not a fresh one) — on
 * restore this lets the recreated File/Folder docs reuse the same ids
 * they had when the snapshot was taken, which keeps a file's Yjs
 * collaboration room identity (roomId = fileId.toString(), see
 * backend/src/crdt/yjsManager.js) valid across a restore with no new
 * room-management code.
 */

const SnapshotFileSchema = new mongoose.Schema(
    {
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },

        name: {
            type: String,
            required: true
        },

        folderId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        },

        language: {
            type: String,
            default: "plaintext"
        },

        content: {
            type: String,
            default: ""
        }
    },
    { _id: false }
);

const SnapshotFolderSchema = new mongoose.Schema(
    {
        folderId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },

        name: {
            type: String,
            required: true
        },

        parentFolderId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        }
    },
    { _id: false }
);

const SnapshotSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Project",
            required: true,
            index: true
        },

        name: {
            type: String,
            trim: true,
            default: ""
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        // Denormalized (same convention as WorkspaceActivity.username)
        // so the snapshot list/activity feed never needs a populate.
        createdByUsername: {
            type: String,
            required: true
        },

        fileCount: {
            type: Number,
            default: 0
        },

        folders: [SnapshotFolderSchema],

        files: [SnapshotFileSchema]
    },
    {
        timestamps: true
    }
);

SnapshotSchema.index({
    projectId: 1,
    createdAt: -1
});

module.exports = mongoose.model("Snapshot", SnapshotSchema);
