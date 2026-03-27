const { getTransactionIcon } = require("./transactionConfig.js");

const MAX_TRANSACTION_TITLE_LENGTH = 80;
const MAX_TRANSACTION_CATEGORY_LENGTH = 40;

const normalizeTransactionPayload = (payload = {}, transactionType) => {
    const normalizedTitle = String(payload.title || "").replace(/\s+/g, " ").trim();
    const normalizedCategory = String(payload.category || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const hasAmount =
        payload.amount !== undefined &&
        payload.amount !== null &&
        String(payload.amount).trim() !== "";
    const rawDate = payload.date;

    if (!normalizedTitle || !normalizedCategory || !hasAmount || !rawDate) {
        return { error: "All fields are required" };
    }

    if (normalizedTitle.length > MAX_TRANSACTION_TITLE_LENGTH) {
        return { error: `Title must stay under ${MAX_TRANSACTION_TITLE_LENGTH} characters` };
    }

    if (normalizedCategory.length > MAX_TRANSACTION_CATEGORY_LENGTH) {
        return { error: `Category must stay under ${MAX_TRANSACTION_CATEGORY_LENGTH} characters` };
    }

    const parsedAmount = Number(payload.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return { error: "Amount must be a number greater than 0" };
    }

    const parsedDate = new Date(rawDate);
    if (Number.isNaN(parsedDate.getTime())) {
        return { error: "Date must be valid" };
    }

    return {
        value: {
            title: normalizedTitle,
            category: normalizedCategory,
            amount: parsedAmount,
            date: parsedDate,
            icon: getTransactionIcon(transactionType, normalizedCategory),
        },
    };
};

module.exports = {
    normalizeTransactionPayload,
};
