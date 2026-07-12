const mongoose = require("mongoose");

const InvitationSchema = new mongoose.Schema(
{
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },

    inviterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    inviteeEmail: {
        type: String,
        required: true
    },

    role: {
        type: String,
        default: "editor"
    },

    status: {
        type: String,
        enum: [
            "pending",
            "accepted",
            "rejected",
            "expired"
        ],
        default: "pending"
    },

    expiresAt: Date

},
{
    timestamps: true
});

module.exports = mongoose.model("Invitation", InvitationSchema);