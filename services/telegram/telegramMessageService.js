const { normalizeSummaryRange } = require("../financialSummaryService.js");

const formatCurrency = (value) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(Number(value || 0));

const formatDate = (value) => {
    if (!value) {
        return "Unknown date";
    }

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
};

const capitalize = (value = "") =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const buildConfirmTransactionKeyboard = (token) => ({
    inline_keyboard: [
        [
            {
                text: "Confirm",
                callback_data: `tx:confirm:${token}`,
            },
            {
                text: "Cancel",
                callback_data: `tx:cancel:${token}`,
            },
        ],
    ],
});

const buildHelpMessage = ({ botUsername } = {}) =>
    [
        "FinMate Telegram bot is ready.",
        "",
        "Send a transaction in plain text:",
        "- Spent 420 on groceries today",
        "- Paid 800 for electricity bill",
        "- Received 15000 salary",
        "",
        "Useful commands:",
        "- /summary",
        "- /summary daily",
        "- /summary weekly",
        "- /summary monthly",
        botUsername ? `- Open the bot directly: https://t.me/${botUsername}` : "",
    ]
        .filter(Boolean)
        .join("\n");

const buildLinkRequiredMessage = ({ deepLink } = {}) =>
    [
        "This chat is not linked to a FinMate account yet.",
        "",
        "Open Settings > Telegram inside the app, generate a link code, then come back here and send the start command.",
        deepLink ? `Bot link: ${deepLink}` : "",
    ]
        .filter(Boolean)
        .join("\n");

const buildLinkSuccessMessage = ({ fullName }) =>
    [
        `Telegram is now linked to ${fullName || "your FinMate account"}.`,
        "",
        "You can now send messages like:",
        "- Spent 420 on groceries today",
        "- Received 1200 freelance payment",
        "",
        "Use /summary whenever you want a quick recap.",
    ].join("\n");

const buildLinkedStartMessage = ({ account, botUsername } = {}) =>
    [
        account
            ? `FinMate is already linked to ${account.displayName}${account.username ? ` (@${account.username})` : ""}.`
            : "FinMate Telegram bot is ready.",
        "",
        "You can now send messages like:",
        "- Spent 420 on groceries today",
        "- Received 1200 freelance payment",
        "",
        "Useful commands:",
        "- /summary",
        "- /summary daily",
        "- /summary weekly",
        "- /summary monthly",
        "- /status",
        botUsername ? `- Open the bot directly: https://t.me/${botUsername}` : "",
    ]
        .filter(Boolean)
        .join("\n");

const buildTransactionPreviewMessage = (draft = {}) =>
    [
        "I parsed this transaction:",
        "",
        `Type: ${capitalize(draft.type)}`,
        `Title: ${draft.title}`,
        `Category: ${capitalize(draft.category)}`,
        `Amount: ${formatCurrency(draft.amount)}`,
        `Date: ${formatDate(draft.date)}`,
        "",
        "Tap Confirm to save it or Cancel to discard it.",
    ].join("\n");

const buildTransactionSavedMessage = (transaction = {}, transactionType = "") =>
    [
        `${capitalize(transactionType || "transaction")} saved successfully.`,
        "",
        `Title: ${transaction.title}`,
        `Category: ${capitalize(transaction.category)}`,
        `Amount: ${formatCurrency(transaction.amount)}`,
        `Date: ${formatDate(transaction.date)}`,
    ].join("\n");

const buildTransactionCancelledMessage = () =>
    "That transaction draft was cancelled and nothing was saved.";

const buildExpiredIntentMessage = () =>
    "That confirmation link has expired. Send the transaction again and I will re-parse it.";

const buildSummaryMessage = (summary = {}) => {
    const range = normalizeSummaryRange(summary.range);
    const expenseLines = summary.topExpenseCategories?.length
        ? summary.topExpenseCategories
              .map((item, index) => `${index + 1}. ${capitalize(item.category)}: ${formatCurrency(item.amount)}`)
              .join("\n")
        : "No expenses recorded in this window.";

    const recentLines = summary.recentTransactions?.length
        ? summary.recentTransactions
              .map(
                  (item) =>
                      `- ${formatDate(item.date)} | ${capitalize(item.type)} | ${item.title} | ${formatCurrency(
                          item.amount
                      )}`
              )
              .join("\n")
        : "No recent transactions yet.";

    return [
        `${capitalize(range)} snapshot for the ${summary.windowLabel || "selected period"}`,
        "",
        `Income: ${formatCurrency(summary.totalIncome)}`,
        `Expenses: ${formatCurrency(summary.totalExpenses)}`,
        `Balance: ${formatCurrency(summary.totalBalance)}`,
        `Savings rate: ${
            summary.savingsRate === null || summary.savingsRate === undefined
                ? "Not available"
                : `${summary.savingsRate}%`
        }`,
        "",
        "Top expenses:",
        expenseLines,
        "",
        "Recent activity:",
        recentLines,
    ].join("\n");
};

const buildStatusMessage = ({ account, bot } = {}) =>
    [
        account
            ? `Linked to ${account.displayName}${account.username ? ` (@${account.username})` : ""}.`
            : "This chat is not linked yet.",
        account?.linkedAt ? `Linked on: ${formatDate(account.linkedAt)}` : "",
        bot?.username ? `Bot: @${bot.username}` : "",
    ]
        .filter(Boolean)
        .join("\n");

module.exports = {
    buildConfirmTransactionKeyboard,
    buildExpiredIntentMessage,
    buildHelpMessage,
    buildLinkedStartMessage,
    buildLinkRequiredMessage,
    buildLinkSuccessMessage,
    buildStatusMessage,
    buildSummaryMessage,
    buildTransactionCancelledMessage,
    buildTransactionPreviewMessage,
    buildTransactionSavedMessage,
};
