const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
{
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Session",
        required: true
    },

    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    message: {
        type: String,
        required: true
    },

    type: {
        type: String,
        enum: ["text", "system"],
        default: "text"
    }

},
{
    timestamps: true
});

module.exports = mongoose.model("Message", MessageSchema);