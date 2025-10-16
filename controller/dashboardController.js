const Income = require("../models/Income.js")
const Expense = require("../models/Expense.js")

const { isValidObjectId, Types } = require("mongoose")
 
// Dashboard Data
exports.getDashboardData = async (req, res) => {
    try {
        console.log('Dashboard request received');
        console.log('req.user:', req.user);

        const userId = req.user.id
        console.log('userId:', userId);

        if (!userId) {
            return res.status(400).json({ message: "User ID not found" });
        }

        const userObjectId = new Types.ObjectId(String(userId));
        console.log('userObjectId:', userObjectId);

        // fetch total income and expense
        console.log('Fetching total income...');
        const totalIncome = await Income.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
        console.log('Total Income result:', totalIncome);

        console.log('Fetching total expense...');
        const totalExpense = await Expense.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ])
        console.log('Total Expense result:', totalExpense);

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
        };

        console.log('Final response data:', responseData);
        res.json(responseData);

    } catch (err) {
        res.status(500).json({message: "Server Error", error: err.message})
    }
}