const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    token: {
        type: String,
        required: true,
        unique: true,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    replacedByToken: {
        type: String,
        default: null,
    },
    revokedAt: {
        type: Date,
        default: null,
    },
}, { timestamps: true });

refreshTokenSchema.methods.isExpired = function() {
    return Date.now() >= this.expiresAt;
};

refreshTokenSchema.methods.isActive = function() {
    return !this.revokedAt && !this.isExpired();
};

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
