const Expense = require("../../modules/expense/expense.model.js");
const Income = require("../../modules/income/income.model.js");
const { invalidateDashboardCache } = require("../../modules/dashboard/dashboard.cache.service.js");
const { normalizeTransactionPayload } = require("../utils/transaction.payload.js");

const TRANSACTION_MODELS = {
    income: Income,
    expense: Expense,
};

class TransactionServiceError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = "TransactionServiceError";
        this.status = status;
    }
}

const getTransactionModel = (transactionType) => {
    const normalizedType = String(transactionType || "").trim().toLowerCase();
    const model = TRANSACTION_MODELS[normalizedType];

    if (!model) {
        throw new TransactionServiceError("Unsupported transaction type", 400);
    }

    return model;
};

const normalizeTransactionInput = (payload, transactionType) => {
    const { value, error } = normalizeTransactionPayload(payload, transactionType);

    if (error) {
        throw new TransactionServiceError(error, 400);
    }

    return value;
};

const createTransaction = async ({ transactionType, userId, payload }) => {
    if (!userId) {
        throw new TransactionServiceError("User ID is required", 400);
    }

    const Model = getTransactionModel(transactionType);
    const value = normalizeTransactionInput(payload, transactionType);

    const createdTransaction = await Model.create({
        userId,
        ...value,
    });

    try {
        await invalidateDashboardCache({ userId });
    } catch (error) {
        console.error("Failed to invalidate dashboard cache after create:", error.message);
    }

    return createdTransaction;
};

const updateTransaction = async ({ transactionType, transactionId, userId, payload }) => {
    if (!transactionId) {
        throw new TransactionServiceError("Transaction ID is required", 400);
    }

    if (!userId) {
        throw new TransactionServiceError("User ID is required", 400);
    }

    const Model = getTransactionModel(transactionType);
    const value = normalizeTransactionInput(payload, transactionType);

    const updatedTransaction = await Model.findOneAndUpdate(
        {
            _id: transactionId,
            userId,
        },
        value,
        {
            new: true,
            runValidators: true,
        }
    );

    if (!updatedTransaction) {
        const label = transactionType === "income" ? "Income" : "Expense";
        throw new TransactionServiceError(`${label} not found`, 404);
    }

    try {
        await invalidateDashboardCache({ userId });
    } catch (error) {
        console.error("Failed to invalidate dashboard cache after update:", error.message);
    }

    return updatedTransaction;
};

module.exports = {
    TransactionServiceError,
    TRANSACTION_MODELS,
    createTransaction,
    getTransactionModel,
    updateTransaction,
};
