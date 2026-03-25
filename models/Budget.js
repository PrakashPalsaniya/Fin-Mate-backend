const mongoose = require("mongoose");

const BudgetSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        category: { type: String, required: true, trim: true, lowercase: true },
        amount: { type: Number, required: true, min: 0.01 },
        month: { type: String, required: true, trim: true },
        note: { type: String, trim: true, default: "", maxlength: 160 },
        icon: { type: String, default: "LuUtensils" },
    },
    { timestamps: true }
);

BudgetSchema.index({ userId: 1, month: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("Budget", BudgetSchema);
