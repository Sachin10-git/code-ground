const mongoose = require("mongoose");

const CRDTDocumentSchema = new mongoose.Schema(
{
    roomId: {
        type: String,
        required: true,
        unique: true,
    },

    state: {
        type: Buffer,
        required: true,
    },

},
{
    timestamps: true,
});

module.exports = mongoose.model(
    "CRDTDocument",
    CRDTDocumentSchema
);