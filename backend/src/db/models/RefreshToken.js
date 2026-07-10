const mongoose = require("mongoose");

const RefreshTokenSchema = new mongoose.Schema(
{
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },

    token: {
    type: String,
    required: true,
    unique: true,
    index: true,
},

    expiresAt: {
    type: Date,
    required: true,
    index: true,
},

    isRevoked: {
        type: Boolean,
        default: false,
    }

},
{
    timestamps: true,
});

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);