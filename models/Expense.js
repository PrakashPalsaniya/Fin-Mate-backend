const mongoose = require("mongoose");

const ExpenseSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    icon: { type: String, default: "LuUtensils" }
}, { timestamps: true }
)

module.exports = mongoose.model("Expense", ExpenseSchema)