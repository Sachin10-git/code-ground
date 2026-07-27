const mongoose = require("mongoose");

/**
 * Enhancement 2 (Phase 6.4) — persisted workspace activity feed.
 *
 * One document per workspace mutation (create/rename/move/delete on a
 * file or folder), written by workspaceActivityService.recordActivity
 * right alongside the existing live socket broadcast for the same
 * mutation (see socket/workspaceBroadcast.js) — same call site, same
 * data, so the persisted history and the live feed can never drift
 * out of sync with each other.
 */
const WorkspaceActivitySchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true
    },

    username: {
        type: String,
        required: true
    },

    operation: {
        type: String,
        // Phase 6.6 — "locked"/"unlocked" added for file-locking activity
        // entries (see socket/workspaceBroadcast.js's broadcastFileLocked/
        // broadcastFileUnlocked).
        enum: ["created", "renamed", "moved", "deleted", "locked", "unlocked"],
        required: true
    },

    targetType: {
        type: String,
        enum: ["file", "folder"],
        required: true
    },

    targetName: {
        type: String,
        required: true
    },

    // Rename operations only — see workspaceActivityService.recordActivity.
    oldName: {
        type: String
    },

    newName: {
        type: String
    }

},
{
    timestamps: true
});

// Every query this feature makes filters by project and sorts newest
// first (latest-100 fetch, oldest-entry trim) — one compound index
// covers both.
WorkspaceActivitySchema.index({
    projectId: 1,
    createdAt: -1,
});

module.exports = mongoose.model("WorkspaceActivity", WorkspaceActivitySchema);
