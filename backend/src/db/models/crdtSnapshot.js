const mongoose = require("mongoose");

const CRDTSnapshotSchema = new mongoose.Schema(
{
    roomId: {
        type: String,
        required: true,
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
    "CRDTSnapshot",
    CRDTSnapshotSchema
);