const mongoose = require("mongoose");

/**
 * Phase 6.0 — Team Chat.
 *
 * One document per chat message sent in a project's room. Mirrors
 * workspaceactivity.js's shape (project-scoped, timestamped, same
 * compound index) since chat history is fetched the same way: latest
 * N for a project, newest first.
 */
const ChatMessageSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true
    },

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    username: {
        type: String,
        required: true
    },

    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 4000
    }

},
{
    timestamps: true
});

// Every query filters by project and sorts newest-first (latest-100
// fetch, oldest-entry trim) — one compound index covers both.
ChatMessageSchema.index({
    projectId: 1,
    createdAt: -1,
});

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
