const Income = require("../models/Income.js")
const Expense = require("../models/Expense.js")
const { getBudgetSnapshot } = require("../services/budgetService.js")
const {
    getCachedDashboardResponse,
    setCachedDashboardResponse,
} = require("../services/dashboardCacheService.js")
const { normalizeUserSettings } = require("../utils/userSettings.js")

const { Types } = require("mongoose")
 
// Dashboard Data
exports.getDashboardData = async (req, res) => {
    try {
        const userId = req.user.id

        if (!userId) {
            return res.status(400).json({ message: "User ID not found" });
        }

        const userObjectId = new Types.ObjectId(String(userId));
        const timeZone = normalizeUserSettings(req.user?.settings || {}).timezone;

        try {
            const { data: cachedDashboard } = await getCachedDashboardResponse({
                userId,
                timeZone,
            });

            if (cachedDashboard) {
                return res.json(cachedDashboard);
            }
        } catch (cacheError) {
            console.error("Failed to read dashboard cache:", cacheError.message);
        }

        // fetch total income and expense
        const totalIncome = await Income.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ])

        const totalExpense = await Expense.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ])

        // get income transaction in last 60 days
        const last60DaysIncomeTransactions = await Income.find({
            userId,
            date: { $gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }
        }).sort({ date: -1 })

        // get total income for last 60 days
        const incomeLast60Days = last60DaysIncomeTransactions.reduce(
            (sum, transaction) => sum + transaction.amount,
            0
        );

        // Get expense transaction in last 30 days
        const last30DaysExpenseTransactions = await Expense.find({
            userId,
            date: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }).sort({ date: -1 })

        // Get total expense for last 30 days
        const expenseLast30Days = last30DaysExpenseTransactions.reduce(
            (sum, transaction) => sum + transaction.amount,
            0
        );

        // Fetch last 5 transactions income + expense
        const lastTransactions = [
            ...(await Income.find({ userId }).sort({ date: -1 }).limit(5)).map(
                (txn) => ({
                    ...txn.toObject(),
                    type: "income",
                })
            ),
            ...(await Expense.find({ userId }).sort({ date: -1 }).limit(5)).map(
                (txn) => ({
                    ...txn.toObject(),
                    type: "expense",
                })
            )
        ].sort((a, b) => b.date - a.date); // sort latest first

        // Fetch expense categories aggregation
        const expenseCategories = await Expense.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: "$category", total: { $sum: "$amount" } } },
            { $sort: { total: -1 } }
        ]);

        // Fetch income categories aggregation
        const incomeCategories = await Income.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: "$category", total: { $sum: "$amount" } } },
            { $sort: { total: -1 } }
        ]);

        let budgetSnapshot = {
            summary: {
                month: null,
                monthLabel: "Current month",
                activeBudgets: 0,
                totalBudgeted: 0,
                totalSpent: 0,
                totalRemaining: 0,
                totalOverspent: 0,
                overBudgetCount: 0,
                closeToLimitCount: 0,
                totalSpentThisMonth: 0,
                unbudgetedSpend: 0,
            },
            budgets: [],
        };

        try {
            budgetSnapshot = await getBudgetSnapshot({
                userId,
                timeZone,
                limit: 3,
            });
        } catch (budgetError) {
            console.error("Failed to load dashboard budget snapshot:", budgetError.message);
        }

        // Convert aggregations to object format for frontend
        const expenseCategoriesData = expenseCategories.reduce((acc, cat) => {
            acc[cat._id] = cat.total;
            return acc;
        }, {});

        const incomeCategoriesData = incomeCategories.reduce((acc, cat) => {
            acc[cat._id] = cat.total;
            return acc;
        }, {});

        // final response
        const responseData = {
            totalBalance: (totalIncome[0]?.total || 0) - (totalExpense[0]?.total || 0),
            totalIncome: totalIncome[0]?.total || 0,
            totalExpenses: totalExpense[0]?.total || 0,
            last30DaysExpenses: {
                total: expenseLast30Days,
                transaction: last30DaysExpenseTransactions,
            },
            last60DaysIncome: {
                total: incomeLast60Days,
                transaction: last60DaysIncomeTransactions,
            },
            recentTransactions: lastTransactions,
            expenseCategories: expenseCategoriesData,
            incomeCategories: incomeCategoriesData,
            budgetOverview: {
                ...budgetSnapshot.summary,
                budgets: budgetSnapshot.budgets,
            },
        };

        try {
            await setCachedDashboardResponse({
                userId,
                timeZone,
                data: responseData,
            });
        } catch (cacheError) {
            console.error("Failed to write dashboard cache:", cacheError.message);
        }

        res.json(responseData);

    } catch (err) {
        res.status(500).json({message: "Server Error", error: err.message})
    }
}
