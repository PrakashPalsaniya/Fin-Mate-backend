const mongoose = require("mongoose");

const summarySnapshotSchema = new mongoose.Schema({
    range: { type: String, trim: true },
    totalIncome: { type: Number, default: 0 },
    totalExpenses: { type: Number, default: 0 },
    totalBalance: { type: Number, default: 0 },
    savingsRate: { type: Number, default: null },
    topExpenseCategory: { type: String, trim: true, default: null },
}, { _id: false });

const summaryDeliverySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    frequency: {
        type: String,
        enum: ["daily", "weekly", "monthly"],
        required: true,
    },
    channel: {
        type: String,
        enum: ["telegram", "email"],
        required: true,
    },
    source: {
        type: String,
        enum: ["scheduled", "manual"],
        default: "scheduled",
    },
    deliveryKey: {
        type: String,
        required: true,
        trim: true,
    },
    scheduledDateKey: {
        type: String,
        trim: true,
        default: null,
    },
    status: {
        type: String,
        enum: ["processing", "sent", "failed", "skipped"],
        default: "processing",
    },
    attempts: {
        type: Number,
        default: 0,
    },
    lastAttemptAt: {
        type: Date,
        default: null,
    },
    sentAt: {
        type: Date,
        default: null,
    },
    lastError: {
        type: String,
        default: null,
    },
    providerMessageId: {
        type: String,
        trim: true,
        default: null,
    },
    summarySnapshot: {
        type: summarySnapshotSchema,
        default: undefined,
    },
}, {
    timestamps: true,
});

summaryDeliverySchema.index(
    { userId: 1, frequency: 1, channel: 1, deliveryKey: 1 },
    { unique: true }
);

module.exports = mongoose.model("SummaryDelivery", summaryDeliverySchema);
