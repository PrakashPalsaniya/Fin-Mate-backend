const {
    BudgetServiceError,
    createBudget,
    deleteBudget,
    getBudgetSnapshot,
    updateBudget,
} = require("../services/budgetService.js");
const { normalizeUserSettings } = require("../utils/userSettings.js");

const getUserTimeZone = (req) =>
    normalizeUserSettings(req.user?.settings || {}).timezone;

exports.getBudgets = async (req, res) => {
    try {
        const budgetSnapshot = await getBudgetSnapshot({
            userId: req.user.id,
            month: req.query.month,
            timeZone: getUserTimeZone(req),
        });

        return res.status(200).json(budgetSnapshot);
    } catch (error) {
        if (error instanceof BudgetServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({
            message: "Failed to load budgets",
            error: error.message,
        });
    }
};

exports.addBudget = async (req, res) => {
    try {
        const budget = await createBudget({
            userId: req.user.id,
            payload: req.body,
            timeZone: getUserTimeZone(req),
        });

        return res.status(201).json({
            message: "Budget created successfully",
            budget,
        });
    } catch (error) {
        if (error instanceof BudgetServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({
            message: "Failed to create budget",
            error: error.message,
        });
    }
};

exports.editBudget = async (req, res) => {
    try {
        const budget = await updateBudget({
            budgetId: req.params.id,
            userId: req.user.id,
            payload: req.body,
            timeZone: getUserTimeZone(req),
        });

        return res.status(200).json({
            message: "Budget updated successfully",
            budget,
        });
    } catch (error) {
        if (error instanceof BudgetServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({
            message: "Failed to update budget",
            error: error.message,
        });
    }
};

exports.removeBudget = async (req, res) => {
    try {
        await deleteBudget({
            budgetId: req.params.id,
            userId: req.user.id,
        });

        return res.status(200).json({
            message: "Budget deleted successfully",
        });
    } catch (error) {
        if (error instanceof BudgetServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({
            message: "Failed to delete budget",
            error: error.message,
        });
    }
};
