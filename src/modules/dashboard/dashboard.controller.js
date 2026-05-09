const Income = require("../income/income.model.js")
const Expense = require("../expense/expense.model.js")
const { getBudgetSnapshot } = require("../budget/budget.service.js")
const {
    getCachedDashboardResponse,
    setCachedDashboardResponse,
} = require("./dashboard.cache.service.js")
const { normalizeUserSettings } = require("../settings/settings.utils.js")

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

        // Fetch all independent data in parallel
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [
            totalIncomeResult,
            totalExpenseResult,
            last60DaysIncomeTransactions,
            last30DaysExpenseTransactions,
            recentIncome,
            recentExpense,
            expenseCategories,
            incomeCategories,
            budgetSnapshotResult
        ] = await Promise.all([
            Income.aggregate([{ $match: { userId: userObjectId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
            Expense.aggregate([{ $match: { userId: userObjectId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
            Income.find({ userId, date: { $gte: sixtyDaysAgo } }).sort({ date: -1 }),
            Expense.find({ userId, date: { $gte: thirtyDaysAgo } }).sort({ date: -1 }),
            Income.find({ userId }).sort({ date: -1 }).limit(5).lean(),
            Expense.find({ userId }).sort({ date: -1 }).limit(5).lean(),
            Expense.aggregate([{ $match: { userId: userObjectId } }, { $group: { _id: "$category", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }]),
            Income.aggregate([{ $match: { userId: userObjectId } }, { $group: { _id: "$category", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }]),
            getBudgetSnapshot({ userId, timeZone, limit: 3 }).catch(() => null)
        ]);

        const totalIncome = totalIncomeResult[0]?.total || 0;
        const totalExpense = totalExpenseResult[0]?.total || 0;

        const incomeLast60Days = last60DaysIncomeTransactions.reduce((sum, txn) => sum + txn.amount, 0);
        const expenseLast30Days = last30DaysExpenseTransactions.reduce((sum, txn) => sum + txn.amount, 0);

        const lastTransactions = [
            ...recentIncome.map(txn => ({ ...txn, type: "income" })),
            ...recentExpense.map(txn => ({ ...txn, type: "expense" }))
        ].sort((a, b) => b.date - a.date).slice(0, 5);

        const budgetSnapshot = budgetSnapshotResult || {
            summary: {
                month: null, monthLabel: "Current month", activeBudgets: 0, totalBudgeted: 0, 
                totalSpent: 0, totalRemaining: 0, totalOverspent: 0, overBudgetCount: 0, 
                closeToLimitCount: 0, totalSpentThisMonth: 0, unbudgetedSpend: 0,
            },
            budgets: [],
        };

        const responseData = {
            totalBalance: totalIncome - totalExpense,
            totalIncome,
            totalExpenses: totalExpense,
            last30DaysExpenses: { total: expenseLast30Days, transaction: last30DaysExpenseTransactions },
            last60DaysIncome: { total: incomeLast60Days, transaction: last60DaysIncomeTransactions },
            recentTransactions: lastTransactions,
            expenseCategories: expenseCategories.reduce((acc, cat) => ({ ...acc, [cat._id]: cat.total }), {}),
            incomeCategories: incomeCategories.reduce((acc, cat) => ({ ...acc, [cat._id]: cat.total }), {}),
            budgetOverview: { ...budgetSnapshot.summary, budgets: budgetSnapshot.budgets },
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
