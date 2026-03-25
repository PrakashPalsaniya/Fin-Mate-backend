const { getTransactionIcon } = require("./transactionConfig.js");

const normalizeTransactionPayload = (payload = {}, transactionType) => {
    const normalizedTitle = String(payload.title || "").trim();
    const normalizedCategory = String(payload.category || "").trim().toLowerCase();
    const hasAmount =
        payload.amount !== undefined &&
        payload.amount !== null &&
        String(payload.amount).trim() !== "";
    const rawDate = payload.date;

    if (!normalizedTitle || !normalizedCategory || !hasAmount || !rawDate) {
        return { error: "All fields are required" };
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
