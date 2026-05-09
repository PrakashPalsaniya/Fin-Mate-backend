const { Types } = require("mongoose");
const Budget = require("./budget.model.js");
const Expense = require("../expense/expense.model.js");
const { TRANSACTION_ICON_MAP, getTransactionIcon } = require("../../shared/utils/transaction.config.js");

const DEFAULT_EXPENSE_CATEGORIES = Object.keys(TRANSACTION_ICON_MAP.expense || {});
const MONTH_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DEFAULT_TIME_ZONE = "Asia/Kolkata";

class BudgetServiceError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "BudgetServiceError";
        this.status = status;
    }
}

const resolveTimeZone = (timeZone) => {
    const candidate = String(timeZone || "").trim();

    try {
        Intl.DateTimeFormat("en-US", {
            timeZone: candidate || DEFAULT_TIME_ZONE,
        }).format(new Date());

        return candidate || DEFAULT_TIME_ZONE;
    } catch (error) {
        return DEFAULT_TIME_ZONE;
    }
};

const getCurrentMonthKey = (timeZone) => {
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: resolvedTimeZone,
        year: "numeric",
        month: "2-digit",
    });

    const parts = formatter.formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;

    return `${year}-${month}`;
};

const parseBudgetMonth = (monthValue, timeZone) => {
    const monthKey = String(monthValue || getCurrentMonthKey(resolveTimeZone(timeZone))).trim();

    if (!MONTH_KEY_REGEX.test(monthKey)) {
        throw new BudgetServiceError("Month must be in YYYY-MM format", 400);
    }

    const [year, month] = monthKey.split("-").map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    return {
        monthKey,
        startDate,
        endDate,
    };
};

const formatMonthLabel = (monthKey, timeZone) => {
    const [year, month] = String(monthKey).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, 1));
    const resolvedTimeZone = resolveTimeZone(timeZone);

    return new Intl.DateTimeFormat("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: resolvedTimeZone,
    }).format(date);
};

const normalizeBudgetPayload = (payload = {}, timeZone) => {
    const normalizedCategory = String(payload.category || "").trim().toLowerCase();
    const normalizedNote = String(payload.note || "").trim();
    const rawAmount = payload.amount;
    const hasAmount =
        rawAmount !== undefined &&
        rawAmount !== null &&
        String(rawAmount).trim() !== "";

    if (!normalizedCategory || !hasAmount) {
        throw new BudgetServiceError("Category and amount are required", 400);
    }

    const parsedAmount = Number(rawAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new BudgetServiceError("Amount must be a number greater than 0", 400);
    }

    if (normalizedNote.length > 160) {
        throw new BudgetServiceError("Note should stay under 160 characters", 400);
    }

    const { monthKey } = parseBudgetMonth(payload.month, timeZone);

    return {
        category: normalizedCategory,
        amount: parsedAmount,
        month: monthKey,
        note: normalizedNote,
        icon: getTransactionIcon("expense", normalizedCategory),
    };
};

const getExpenseSpendByCategory = async ({ userId, startDate, endDate }) => {
    const userObjectId = new Types.ObjectId(String(userId));

    const spendRows = await Expense.aggregate([
        {
            $match: {
                userId: userObjectId,
                date: {
                    $gte: startDate,
                    $lt: endDate,
                },
            },
        },
        {
            $group: {
                _id: "$category",
                total: { $sum: "$amount" },
            },
        },
        { $sort: { total: -1 } },
    ]);

    return spendRows.map((item) => ({
        category: String(item._id || "").trim().toLowerCase(),
        amount: Number(item.total || 0),
    }));
};

const getBudgetStatus = (usagePercentage) => {
    if (usagePercentage > 100) {
        return "over-budget";
    }

    if (usagePercentage >= 90) {
        return "close";
    }

    return "on-track";
};

const buildBudgetItem = (budget, spendMap) => {
    const spent = Number(spendMap.get(budget.category) || 0);
    const amount = Number(budget.amount || 0);
    const remaining = Math.max(amount - spent, 0);
    const overspend = Math.max(spent - amount, 0);
    const usagePercentage = amount > 0 ? Number(((spent / amount) * 100).toFixed(1)) : 0;

    return {
        _id: String(budget._id),
        category: budget.category,
        amount,
        month: budget.month,
        note: budget.note || "",
        icon: budget.icon || getTransactionIcon("expense", budget.category),
        spent,
        remaining,
        overspend,
        usagePercentage,
        status: getBudgetStatus(usagePercentage),
        createdAt: budget.createdAt,
        updatedAt: budget.updatedAt,
    };
};

const sortBudgetItems = (items = []) => {
    const statusRank = {
        "over-budget": 0,
        close: 1,
        "on-track": 2,
    };

    return [...items].sort((a, b) => {
        const statusDifference = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
        if (statusDifference !== 0) {
            return statusDifference;
        }

        return String(a.category).localeCompare(String(b.category));
    });
};

const buildAvailableCategories = ({ budgets = [], spendRows = [] }) => {
    const orderedCategories = [];
    const seen = new Set();

    const addCategory = (category) => {
        const normalizedCategory = String(category || "").trim().toLowerCase();
        if (!normalizedCategory || seen.has(normalizedCategory)) {
            return;
        }

        seen.add(normalizedCategory);
        orderedCategories.push(normalizedCategory);
    };

    DEFAULT_EXPENSE_CATEGORIES.forEach(addCategory);
    spendRows.forEach((item) => addCategory(item.category));
    budgets.forEach((item) => addCategory(item.category));

    return orderedCategories;
};

const buildBudgetSummary = ({ monthKey, timeZone, budgetItems = [], spendRows = [] }) => {
    const totalBudgeted = budgetItems.reduce((sum, item) => sum + item.amount, 0);
    const totalSpentAgainstBudget = budgetItems.reduce((sum, item) => sum + item.spent, 0);
    const totalRemaining = budgetItems.reduce((sum, item) => sum + item.remaining, 0);
    const totalOverspent = budgetItems.reduce((sum, item) => sum + item.overspend, 0);
    const overBudgetCount = budgetItems.filter((item) => item.status === "over-budget").length;
    const closeToLimitCount = budgetItems.filter((item) => item.status === "close").length;
    const totalSpentThisMonth = spendRows.reduce((sum, item) => sum + item.amount, 0);
    const budgetedCategories = new Set(budgetItems.map((item) => item.category));
    const unbudgetedSpend = spendRows.reduce((sum, item) => {
        if (budgetedCategories.has(item.category)) {
            return sum;
        }

        return sum + item.amount;
    }, 0);

    return {
        month: monthKey,
        monthLabel: formatMonthLabel(monthKey, timeZone),
        activeBudgets: budgetItems.length,
        totalBudgeted,
        totalSpent: totalSpentAgainstBudget,
        totalRemaining,
        totalOverspent,
        overBudgetCount,
        closeToLimitCount,
        totalSpentThisMonth,
        unbudgetedSpend,
    };
};

const getBudgetSnapshot = async ({ userId, month, timeZone, limit }) => {
    if (!userId) {
        throw new BudgetServiceError("User ID is required", 400);
    }

    if (!Types.ObjectId.isValid(String(userId))) {
        throw new BudgetServiceError("User ID is invalid", 400);
    }

    const resolvedTimeZone = resolveTimeZone(timeZone);
    const { monthKey, startDate, endDate } = parseBudgetMonth(month, resolvedTimeZone);
    const [budgets, spendRows] = await Promise.all([
        Budget.find({ userId, month: monthKey }).sort({ category: 1, createdAt: 1 }),
        getExpenseSpendByCategory({ userId, startDate, endDate }),
    ]);

    const spendMap = new Map(spendRows.map((item) => [item.category, Number(item.amount || 0)]));
    const budgetItems = sortBudgetItems(budgets.map((budget) => buildBudgetItem(budget, spendMap)));
    const summary = buildBudgetSummary({
        monthKey,
        timeZone: resolvedTimeZone,
        budgetItems,
        spendRows,
    });

    return {
        month: monthKey,
        monthLabel: summary.monthLabel,
        summary,
        budgets: typeof limit === "number" ? budgetItems.slice(0, limit) : budgetItems,
        availableCategories: buildAvailableCategories({
            budgets: budgetItems,
            spendRows,
        }),
    };
};

const createBudget = async ({ userId, payload, timeZone }) => {
    if (!userId) {
        throw new BudgetServiceError("User ID is required", 400);
    }

    if (!Types.ObjectId.isValid(String(userId))) {
        throw new BudgetServiceError("User ID is invalid", 400);
    }

    const value = normalizeBudgetPayload(payload, resolveTimeZone(timeZone));

    try {
        return await Budget.create({
            userId,
            ...value,
        });
    } catch (error) {
        if (error?.code === 11000) {
            throw new BudgetServiceError("A budget already exists for this category and month", 409);
        }

        throw error;
    }
};

const updateBudget = async ({ budgetId, userId, payload, timeZone }) => {
    if (!budgetId) {
        throw new BudgetServiceError("Budget ID is required", 400);
    }

    if (!userId) {
        throw new BudgetServiceError("User ID is required", 400);
    }

    if (!Types.ObjectId.isValid(String(budgetId))) {
        throw new BudgetServiceError("Budget ID is invalid", 400);
    }

    if (!Types.ObjectId.isValid(String(userId))) {
        throw new BudgetServiceError("User ID is invalid", 400);
    }

    const value = normalizeBudgetPayload(payload, resolveTimeZone(timeZone));

    try {
        const updatedBudget = await Budget.findOneAndUpdate(
            {
                _id: budgetId,
                userId,
            },
            value,
            {
                new: true,
                runValidators: true,
            }
        );

        if (!updatedBudget) {
            throw new BudgetServiceError("Budget not found", 404);
        }

        return updatedBudget;
    } catch (error) {
        if (error instanceof BudgetServiceError) {
            throw error;
        }

        if (error?.code === 11000) {
            throw new BudgetServiceError("A budget already exists for this category and month", 409);
        }

        throw error;
    }
};

const deleteBudget = async ({ budgetId, userId }) => {
    if (!budgetId) {
        throw new BudgetServiceError("Budget ID is required", 400);
    }

    if (!userId) {
        throw new BudgetServiceError("User ID is required", 400);
    }

    if (!Types.ObjectId.isValid(String(budgetId))) {
        throw new BudgetServiceError("Budget ID is invalid", 400);
    }

    if (!Types.ObjectId.isValid(String(userId))) {
        throw new BudgetServiceError("User ID is invalid", 400);
    }

    const deletedBudget = await Budget.findOneAndDelete({
        _id: budgetId,
        userId,
    });

    if (!deletedBudget) {
        throw new BudgetServiceError("Budget not found", 404);
    }

    return deletedBudget;
};

module.exports = {
    BudgetServiceError,
    DEFAULT_EXPENSE_CATEGORIES,
    createBudget,
    deleteBudget,
    formatMonthLabel,
    getBudgetSnapshot,
    getCurrentMonthKey,
    parseBudgetMonth,
    resolveTimeZone,
    updateBudget,
};
