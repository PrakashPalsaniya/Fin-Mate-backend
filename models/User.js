const mongoose = require("mongoose")

const bcryptjs = require("bcryptjs")

const notificationSettingsSchema = new mongoose.Schema({
    emailEnabled: { type: Boolean, default: true },
    telegramEnabled: { type: Boolean, default: true },
    dailySummary: { type: Boolean, default: false },
    weeklySummary: { type: Boolean, default: true },
    monthlySummary: { type: Boolean, default: true },
    transactionAlerts: { type: Boolean, default: false },
}, { _id: false });

const summaryScheduleSchema = new mongoose.Schema({
    dailyTime: { type: String, default: "08:00" },
    weeklyDay: {
        type: String,
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
        default: "monday",
    },
    monthlyDay: { type: Number, min: 1, max: 28, default: 1 },
}, { _id: false });

const userSettingsSchema = new mongoose.Schema({
    timezone: { type: String, default: "Asia/Kolkata", trim: true },
    notifications: { type: notificationSettingsSchema, default: () => ({}) },
    summaries: { type: summaryScheduleSchema, default: () => ({}) },
}, { _id: false });

const telegramAccountSchema = new mongoose.Schema({
    chatId: { type: String, trim: true, default: null },
    username: { type: String, trim: true, default: null },
    firstName: { type: String, trim: true, default: null },
    lastName: { type: String, trim: true, default: null },
    linkedAt: { type: Date, default: null },
    lastInteractionAt: { type: Date, default: null },
}, { _id: false });

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true},
    email: { type: String, required:true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: false },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    settings: { type: userSettingsSchema, default: () => ({}) },
    telegram: { type: telegramAccountSchema, default: undefined },
    }, {
        timestamps: true
    }
);

userSchema.index({ "telegram.chatId": 1 }, { unique: true, sparse: true });

// hash password before saving
userSchema.pre('save', async function (next) { // a Mongoose middleware runs before saving a user.
    if (!this.isModified('password') || !this.password) return next(); // If the password wasn't changed or not set, skip hashing
    this.password = await bcryptjs.hash(this.password, 10); // password is new or changed, hash it with 10 salt rounds (more secure).
    next(); // Move on and finish saving the user.
})

// compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    if (!candidatePassword || !this.password) {
        return false;
    }
    return await bcryptjs.compare(candidatePassword, this.password)
}

module.exports = mongoose.model("User", userSchema)
