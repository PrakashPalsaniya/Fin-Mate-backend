const { Types } = require("mongoose");
const Expense = require("../models/Expense.js");
const Income = require("../models/Income.js");

const SUMMARY_RANGE_CONFIG = Object.freeze({
    daily: {
        days: 1,
        label: "Daily summary",
        windowLabel: "last 24 hours",
    },
    weekly: {
        days: 7,
        label: "Weekly summary",
        windowLabel: "last 7 days",
    },
    monthly: {
        days: 30,
        label: "Monthly summary",
        windowLabel: "last 30 days",
    },
});

const SUMMARY_RANGE_ALIASES = Object.freeze({
    day: "daily",
    daily: "daily",
    week: "weekly",
    weekly: "weekly",
    month: "monthly",
    monthly: "monthly",
});

const normalizeSummaryRange = (value = "monthly") =>
    SUMMARY_RANGE_ALIASES[String(value || "").trim().toLowerCase()] || "monthly";

const getSummaryRangeConfig = (range = "monthly") =>
    SUMMARY_RANGE_CONFIG[normalizeSummaryRange(range)];

const getFinancialSummary = async ({ userId, range = "monthly" }) => {
    if (!userId) {
        throw new Error("User ID is required");
    }

    const normalizedRange = normalizeSummaryRange(range);
    const rangeConfig = getSummaryRangeConfig(normalizedRange);
    const since = new Date(Date.now() - rangeConfig.days * 24 * 60 * 60 * 1000);
    const userObjectId = new Types.ObjectId(String(userId));

    const [incomeResult] = await Income.aggregate([
        {
            $match: {
                userId: userObjectId,
                date: { $gte: since },
            },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [expenseResult] = await Expense.aggregate([
        {
            $match: {
                userId: userObjectId,
                date: { $gte: since },
            },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const topExpenseCategories = await Expense.aggregate([
        {
            $match: {
                userId: userObjectId,
                date: { $gte: since },
            },
        },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
        { $sort: { total: -1 } },
        { $limit: 3 },
    ]);

    const topIncomeCategories = await Income.aggregate([
        {
            $match: {
                userId: userObjectId,
                date: { $gte: since },
            },
        },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
        { $sort: { total: -1 } },
        { $limit: 3 },
    ]);

    const recentTransactions = [
        ...(await Income.find({
            userId,
            date: { $gte: since },
        })
            .sort({ date: -1 })
            .limit(5)
            .select("title amount category date")
            .lean())
            .map((transaction) => ({
                ...transaction,
                type: "income",
            })),
        ...(await Expense.find({
            userId,
            date: { $gte: since },
        })
            .sort({ date: -1 })
            .limit(5)
            .select("title amount category date")
            .lean())
            .map((transaction) => ({
                ...transaction,
                type: "expense",
            })),
    ]
        .sort((left, right) => new Date(right.date) - new Date(left.date))
        .slice(0, 5);

    const totalIncome = incomeResult?.total || 0;
    const totalExpenses = expenseResult?.total || 0;
    const totalBalance = totalIncome - totalExpenses;
    const savingsRate =
        totalIncome > 0 ? Number((((totalIncome - totalExpenses) / totalIncome) * 100).toFixed(1)) : null;

    return {
        range: normalizedRange,
        label: rangeConfig.label,
        windowLabel: rangeConfig.windowLabel,
        since,
        totalIncome,
        totalExpenses,
        totalBalance,
        savingsRate,
        topExpenseCategories: topExpenseCategories.map((item) => ({
            category: item._id || "others",
            amount: item.total || 0,
        })),
        topIncomeCategories: topIncomeCategories.map((item) => ({
            category: item._id || "others",
            amount: item.total || 0,
        })),
        recentTransactions,
    };
};

module.exports = {
    SUMMARY_RANGE_CONFIG,
    getFinancialSummary,
    getSummaryRangeConfig,
    normalizeSummaryRange,
};
