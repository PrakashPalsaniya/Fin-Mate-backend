const { buildSummaryMessage } = require("./telegram/telegramMessageService.js");
const { getZonedDateParts } = require("../utils/timezone.js");

const capitalize = (value = "") =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const formatCurrency = (value) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(Number(value || 0));

const buildSummaryInsight = (summary = {}) => {
    if (!summary.totalIncome && !summary.totalExpenses) {
        return "There was no income or expense activity in this window yet, so the next best move is to keep logging transactions consistently.";
    }

    if (summary.totalBalance >= 0) {
        const topExpense = summary.topExpenseCategories?.[0];
        return topExpense
            ? `You stayed positive by ${formatCurrency(summary.totalBalance)}. Keep an eye on ${capitalize(topExpense.category)}, which led spending at ${formatCurrency(topExpense.amount)}.`
            : `You stayed positive by ${formatCurrency(summary.totalBalance)} in this period.`;
    }

    return `Expenses exceeded income by ${formatCurrency(Math.abs(summary.totalBalance))} in this period, so the next adjustment should be tightening the biggest flexible category.`;
};

const buildSummarySubject = ({ frequency, timeZone }) => {
    const zonedParts = getZonedDateParts(new Date(), timeZone || "Asia/Kolkata");
    return `FinMate ${capitalize(frequency)} summary • ${zonedParts.dateKey}`;
};

const buildSummaryEmailContent = ({ user, summary, frequency, timeZone }) => {
    const subject = buildSummarySubject({ frequency, timeZone });
    const insight = buildSummaryInsight(summary);
    const message = buildSummaryMessage({
        ...summary,
        range: frequency,
    });
    const firstName = String(user?.fullName || "").trim().split(" ")[0] || "there";
    const htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
            <h2 style="margin:0 0 8px;">Hi ${firstName},</h2>
            <p style="margin:0 0 16px;color:#475569;">
                Here is your ${frequency} FinMate summary.
            </p>
            <div style="border:1px solid #dbeafe;border-radius:18px;padding:18px;background:#f8fafc;white-space:pre-line;line-height:1.65;">
${message}
            </div>
            <div style="margin-top:18px;border:1px solid #ccfbf1;border-radius:18px;padding:16px;background:#f0fdfa;">
                <strong style="display:block;margin-bottom:8px;">Quick insight</strong>
                <span style="color:#115e59;">${insight}</span>
            </div>
        </div>
    `;

    return {
        subject,
        textContent: `Hi ${firstName},\n\n${message}\n\nQuick insight: ${insight}`,
        htmlContent,
    };
};

const buildSummaryTelegramContent = ({ user, summary, frequency }) => {
    const firstName = String(user?.fullName || "").trim().split(" ")[0] || "there";
    const baseMessage = buildSummaryMessage({
        ...summary,
        range: frequency,
    });

    return `Hi ${firstName},\n\n${baseMessage}\n\nQuick insight: ${buildSummaryInsight(summary)}`;
};

const buildSummarySnapshot = (summary = {}) => ({
    range: summary.range,
    totalIncome: summary.totalIncome || 0,
    totalExpenses: summary.totalExpenses || 0,
    totalBalance: summary.totalBalance || 0,
    savingsRate:
        summary.savingsRate === null || summary.savingsRate === undefined
            ? null
            : Number(summary.savingsRate),
    topExpenseCategory: summary.topExpenseCategories?.[0]?.category || null,
});

module.exports = {
    buildSummaryEmailContent,
    buildSummarySnapshot,
    buildSummarySubject,
    buildSummaryTelegramContent,
};
