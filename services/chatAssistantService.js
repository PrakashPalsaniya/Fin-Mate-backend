const { Types } = require("mongoose");
const Expense = require("../models/Expense.js");
const Income = require("../models/Income.js");
const redis = require("../config/redis.js");
const {
    formatMonthLabel,
    getBudgetSnapshot,
    getCurrentMonthKey,
    resolveTimeZone,
} = require("./budgetService.js");
const { getWeekStartDateKey, getZonedDateParts } = require("../utils/timezone.js");

const DIRECT_CHAT_MODE = "direct";
const ASSISTANT_CHAT_MODE = "assistant";
const CHAT_MEMORY_KEY_PREFIX = "finance_buddy:memory:v1:";
const CHAT_MEMORY_TTL_SECONDS = clampIntegerEnv(
    process.env.CHAT_MEMORY_TTL_SECONDS,
    2 * 60 * 60,
    5 * 60,
    7 * 24 * 60 * 60
);
const CHAT_MEMORY_MAX_TURNS = clampIntegerEnv(
    process.env.CHAT_MEMORY_MAX_TURNS,
    6,
    2,
    12
);
const CHAT_AI_HISTORY_MAX_TURNS = clampIntegerEnv(
    process.env.CHAT_AI_HISTORY_MAX_TURNS,
    4,
    1,
    CHAT_MEMORY_MAX_TURNS
);

const DIRECT_INTENTS = new Set([
    "summary_overview",
    "expense_total",
    "income_total",
    "balance",
    "savings_rate",
    "top_expense",
    "budget_status",
    "recent_transactions",
]);

const CATEGORY_ALIAS_MAP = Object.freeze({
    food: ["food", "grocery", "groceries", "restaurant", "restaurants", "dining", "meal", "meals", "snacks"],
    rent: ["rent", "house rent", "apartment"],
    entertainment: ["entertainment", "movie", "movies", "gaming", "games", "fun", "ott", "netflix"],
    transport: ["transport", "travel", "uber", "ola", "taxi", "cab", "bus", "train", "fuel", "petrol"],
    utilities: ["utilities", "bills", "bill", "electricity", "water", "internet", "wifi", "phone"],
    healthcare: ["healthcare", "medical", "doctor", "medicine", "hospital", "pharmacy"],
    education: ["education", "course", "courses", "tuition", "school", "college", "books"],
    shopping: ["shopping", "shop", "clothes", "clothing", "amazon", "flipkart"],
    others: ["other", "others", "misc", "miscellaneous"],
    salary: ["salary", "paycheck", "pay cheque", "wages"],
    freelance: ["freelance", "freelancing", "client work", "gig"],
    business: ["business", "sales", "revenue"],
    investment: ["investment", "investments", "sip", "stock", "stocks", "mutual fund", "dividend"],
});

function clampIntegerEnv(rawValue, fallbackValue, minValue, maxValue) {
    const parsedValue = Number(rawValue);

    if (!Number.isFinite(parsedValue)) {
        return fallbackValue;
    }

    return Math.min(Math.max(Math.round(parsedValue), minValue), maxValue);
}

function capitalize(value = "") {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(Number(value || 0));
}

function formatAbsoluteCurrency(value) {
    return formatCurrency(Math.abs(Number(value || 0)));
}

function formatPercent(value) {
    return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(date, timeZone) {
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: resolveTimeZone(timeZone),
        day: "numeric",
        month: "short",
    }).format(new Date(date));
}

function escapeRegExp(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMemoryKey(userId) {
    return `${CHAT_MEMORY_KEY_PREFIX}${String(userId)}`;
}

function parseStoredHistory(rawValue) {
    if (!rawValue) {
        return [];
    }

    try {
        const parsedValue = JSON.parse(rawValue);

        if (!Array.isArray(parsedValue)) {
            return [];
        }

        return parsedValue
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
                userMessage: String(item.userMessage || "").trim(),
                assistantReply: String(item.assistantReply || "").trim(),
                language: item.language === "hinglish" ? "hinglish" : "english",
                mode: item.mode === DIRECT_CHAT_MODE ? DIRECT_CHAT_MODE : ASSISTANT_CHAT_MODE,
                meta: item.meta && typeof item.meta === "object" ? item.meta : {},
                createdAt: String(item.createdAt || "").trim(),
            }))
            .filter((item) => item.userMessage && item.assistantReply);
    } catch (error) {
        console.error("Failed to parse Finance Buddy chat memory:", error.message);
        return [];
    }
}

function isFollowUpMessage(normalizedMessage = "") {
    if (!normalizedMessage) {
        return false;
    }

    return (
        /\b(what about|how about|same for|same thing|and for|and what about|what about that)\b/i.test(
            normalizedMessage
        ) ||
        /^(today|yesterday|this week|last week|this month|last month|last 7 days|last 30 days)$/i.test(
            normalizedMessage
        ) ||
        (/^(that|this|those|it)\b/i.test(normalizedMessage) && normalizedMessage.length <= 32)
    );
}

function getLastResolvedContext(history = []) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const resolvedContext = history[index]?.meta?.resolvedContext;

        if (resolvedContext && typeof resolvedContext === "object") {
            return resolvedContext;
        }
    }

    return null;
}

function parseCategoryFromMessage(normalizedMessage = "", lastContext = null, followUp = false) {
    const aliasEntries = Object.entries(CATEGORY_ALIAS_MAP).sort(
        (left, right) => right[0].length - left[0].length
    );

    for (const [category, aliases] of aliasEntries) {
        const categoryPattern = new RegExp(
            aliases.map((alias) => `\\b${escapeRegExp(alias)}\\b`).join("|"),
            "i"
        );

        if (categoryPattern.test(normalizedMessage)) {
            return { category, explicit: true };
        }
    }

    if (followUp && lastContext?.category) {
        return {
            category: String(lastContext.category).trim().toLowerCase(),
            explicit: false,
        };
    }

    return { category: null, explicit: false };
}

function parseRangeKeyFromMessage(normalizedMessage = "", lastContext = null, followUp = false) {
    if (/\ball time\b|\boverall\b|\bsince i started\b/.test(normalizedMessage)) {
        return { rangeKey: "all_time", explicit: true };
    }

    if (/\byesterday\b/.test(normalizedMessage)) {
        return { rangeKey: "yesterday", explicit: true };
    }

    if (/\btoday\b|\bso far today\b/.test(normalizedMessage)) {
        return { rangeKey: "today", explicit: true };
    }

    if (/\blast\s+week\b|\bprevious\s+week\b/.test(normalizedMessage)) {
        return { rangeKey: "last_week", explicit: true };
    }

    if (/\bthis\s+week\b|\bcurrent\s+week\b|\bweekly\b/.test(normalizedMessage)) {
        return { rangeKey: "this_week", explicit: true };
    }

    if (/\blast\s+month\b|\bprevious\s+month\b/.test(normalizedMessage)) {
        return { rangeKey: "last_month", explicit: true };
    }

    if (/\bthis\s+month\b|\bcurrent\s+month\b|\bmonthly\b/.test(normalizedMessage)) {
        return { rangeKey: "this_month", explicit: true };
    }

    if (/\blast\s*7\s*days\b|\bpast\s*7\s*days\b/.test(normalizedMessage)) {
        return { rangeKey: "last_7_days", explicit: true };
    }

    if (/\blast\s*30\s*days\b|\bpast\s*30\s*days\b/.test(normalizedMessage)) {
        return { rangeKey: "last_30_days", explicit: true };
    }

    if (followUp && lastContext?.rangeKey) {
        return { rangeKey: lastContext.rangeKey, explicit: false };
    }

    return { rangeKey: null, explicit: false };
}

function resolveDirectIntent(normalizedMessage = "", lastContext = null, followUp = false) {
    const hasQuantitativeCue =
        /\b(how much|what(?:'s| is)|show|tell me|give me|total|amount|did i|have i|am i|which|where|recent|latest)\b/.test(
            normalizedMessage
        );
    const hasAdviceCue =
        /\b(how can i|should i|tips?|advice|recommend|help me|plan|improve|reduce|cut down|save more|save money|invest|debt|best way|strategy|why)\b/.test(
            normalizedMessage
        );
    const hasBudgetCue =
        /\bbudget\b|\bover budget\b|\boverspend\b|\boverspent\b|\bremaining budget\b|\bbudget left\b/.test(
            normalizedMessage
        );
    const hasRecentCue =
        /\brecent\b|\blatest\b|\blast transactions\b|\brecent transactions\b/.test(normalizedMessage);
    const hasTopExpenseCue =
        /\btop spending\b|\btop expense\b|\bbiggest expense\b|\bhighest expense\b|\bwhere.*spend.*most\b|\bmost spent\b/.test(
            normalizedMessage
        );
    const hasSavingsRateCue = /\bsavings rate\b|\bsaving rate\b|\bwhat percent.*save\b/.test(normalizedMessage);
    const hasSavedAmountCue =
        /\bhow much .*save\b|\bhow much .*saved\b|\bleft over\b|\bsurplus\b|\bdeficit\b/.test(normalizedMessage);
    const hasBalanceCue = /\bbalance\b|\bnet\b|\bleft over\b|\bsurplus\b|\bdeficit\b/.test(normalizedMessage);
    const hasSummaryCue =
        /\bsummary\b|\boverview\b|\brecap\b|\bsnapshot\b|\bhow am i doing\b|\bwhere did my money go\b/.test(
            normalizedMessage
        );
    const hasIncomeCue =
        /\bincome\b|\bearn(?:ed)?\b|\bmade\b|\breceived\b|\bsalary\b|\bfreelance\b|\binvestment\b/.test(
            normalizedMessage
        );
    const hasExpenseCue =
        /\bspend(?:ing|t)?\b|\bexpense(?:s)?\b|\bcost\b|\bpaid\b/.test(normalizedMessage);

    if (hasBudgetCue) {
        return "budget_status";
    }

    if (hasRecentCue) {
        return "recent_transactions";
    }

    if (hasTopExpenseCue) {
        return "top_expense";
    }

    if (hasSavingsRateCue) {
        return "savings_rate";
    }

    if (hasSavedAmountCue || (hasBalanceCue && hasQuantitativeCue)) {
        return "balance";
    }

    if (hasSummaryCue) {
        return "summary_overview";
    }

    if (hasAdviceCue && !hasQuantitativeCue) {
        return null;
    }

    if (hasIncomeCue && hasQuantitativeCue) {
        return "income_total";
    }

    if (hasExpenseCue && hasQuantitativeCue) {
        return "expense_total";
    }

    if (followUp && DIRECT_INTENTS.has(lastContext?.intent)) {
        return lastContext.intent;
    }

    return null;
}

function parseBudgetFocus(normalizedMessage = "") {
    if (/\b(left|remaining|remain|budget left)\b/.test(normalizedMessage)) {
        return "remaining";
    }

    if (/\bover budget\b|\boverspend\b|\boverspent\b|\bexceeded\b/.test(normalizedMessage)) {
        return "over";
    }

    return "summary";
}

function parseOffsetLabelToMs(rawLabel = "") {
    const normalizedLabel = String(rawLabel || "").trim().toUpperCase();

    if (!normalizedLabel || normalizedLabel === "GMT" || normalizedLabel === "UTC") {
        return 0;
    }

    const match = normalizedLabel.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);

    if (!match) {
        return 0;
    }

    const [, sign, hourValue, minuteValue = "00"] = match;
    const offsetMs =
        (Number(hourValue) * 60 * 60 * 1000) + (Number(minuteValue) * 60 * 1000);

    return sign === "-" ? -offsetMs : offsetMs;
}

function getTimeZoneOffsetMs(date, timeZone) {
    try {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: resolveTimeZone(timeZone),
            timeZoneName: "shortOffset",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
        const timeZoneName = formatter
            .formatToParts(date)
            .find((part) => part.type === "timeZoneName")?.value;

        return parseOffsetLabelToMs(timeZoneName);
    } catch (error) {
        return 0;
    }
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
    return new Date(utcGuess.getTime() - offsetMs);
}

function parseDateKey(dateKey) {
    const [year, month, day] = String(dateKey || "1970-01-01").split("-").map(Number);
    return { year, month, day };
}

function buildMonthKey(parts) {
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function shiftDateParts(parts, { days = 0, months = 0 } = {}) {
    const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day || 1));
    if (days) {
        utcDate.setUTCDate(utcDate.getUTCDate() + days);
    }
    if (months) {
        utcDate.setUTCMonth(utcDate.getUTCMonth() + months);
    }

    return {
        year: utcDate.getUTCFullYear(),
        month: utcDate.getUTCMonth() + 1,
        day: utcDate.getUTCDate(),
    };
}

function buildRangeContext(rangeKey = "this_month", timeZone) {
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const now = new Date();
    const zonedToday = getZonedDateParts(now, resolvedTimeZone);
    const todayParts = {
        year: zonedToday.year,
        month: zonedToday.month,
        day: zonedToday.day,
    };
    const currentWeekStartParts = parseDateKey(getWeekStartDateKey(now, resolvedTimeZone, "monday"));
    const currentMonthStartParts = {
        year: zonedToday.year,
        month: zonedToday.month,
        day: 1,
    };

    switch (rangeKey) {
        case "today": {
            const nextDay = shiftDateParts(todayParts, { days: 1 });
            return {
                key: "today",
                label: "today",
                startDate: zonedDateTimeToUtc({ ...todayParts, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...nextDay, hour: 0 }, resolvedTimeZone),
            };
        }
        case "yesterday": {
            const yesterday = shiftDateParts(todayParts, { days: -1 });
            return {
                key: "yesterday",
                label: "yesterday",
                startDate: zonedDateTimeToUtc({ ...yesterday, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...todayParts, hour: 0 }, resolvedTimeZone),
            };
        }
        case "last_week": {
            const previousWeekStart = shiftDateParts(currentWeekStartParts, { days: -7 });
            return {
                key: "last_week",
                label: "last week",
                startDate: zonedDateTimeToUtc({ ...previousWeekStart, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...currentWeekStartParts, hour: 0 }, resolvedTimeZone),
            };
        }
        case "this_week": {
            const nextWeekStart = shiftDateParts(currentWeekStartParts, { days: 7 });
            return {
                key: "this_week",
                label: "this week",
                startDate: zonedDateTimeToUtc({ ...currentWeekStartParts, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...nextWeekStart, hour: 0 }, resolvedTimeZone),
            };
        }
        case "last_month": {
            const previousMonthStart = shiftDateParts(currentMonthStartParts, { months: -1 });
            return {
                key: "last_month",
                label: "last month",
                startDate: zonedDateTimeToUtc({ ...previousMonthStart, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...currentMonthStartParts, hour: 0 }, resolvedTimeZone),
            };
        }
        case "last_7_days":
            return {
                key: "last_7_days",
                label: "the last 7 days",
                startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                endDate: now,
            };
        case "last_30_days":
            return {
                key: "last_30_days",
                label: "the last 30 days",
                startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endDate: now,
            };
        case "all_time":
            return {
                key: "all_time",
                label: "all time",
                startDate: null,
                endDate: null,
            };
        case "this_month":
        default: {
            const nextMonthStart = shiftDateParts(currentMonthStartParts, { months: 1 });
            return {
                key: "this_month",
                label: "this month",
                startDate: zonedDateTimeToUtc({ ...currentMonthStartParts, hour: 0 }, resolvedTimeZone),
                endDate: zonedDateTimeToUtc({ ...nextMonthStart, hour: 0 }, resolvedTimeZone),
            };
        }
    }
}

function buildRangeContextForMonthKey(monthKey, timeZone) {
    const [year, month] = String(monthKey).split("-").map(Number);
    const nextMonth = shiftDateParts({ year, month, day: 1 }, { months: 1 });
    const resolvedTimeZone = resolveTimeZone(timeZone);

    return {
        key: "month",
        label: formatMonthLabel(monthKey, resolvedTimeZone),
        startDate: zonedDateTimeToUtc({ year, month, day: 1, hour: 0 }, resolvedTimeZone),
        endDate: zonedDateTimeToUtc({ ...nextMonth, hour: 0 }, resolvedTimeZone),
    };
}

function getBudgetMonthSelection(rangeKey, timeZone) {
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const currentMonthKey = getCurrentMonthKey(resolvedTimeZone);

    if (rangeKey === "last_month") {
        const currentMonthParts = {
            year: Number(currentMonthKey.split("-")[0]),
            month: Number(currentMonthKey.split("-")[1]),
            day: 1,
        };
        const previousMonthParts = shiftDateParts(currentMonthParts, { months: -1 });
        const monthKey = buildMonthKey(previousMonthParts);

        return {
            monthKey,
            monthLabel: formatMonthLabel(monthKey, resolvedTimeZone),
            approximate: false,
        };
    }

    return {
        monthKey: currentMonthKey,
        monthLabel: formatMonthLabel(currentMonthKey, resolvedTimeZone),
        approximate: rangeKey !== "this_month",
    };
}

function buildMatch(userObjectId, rangeContext, category) {
    const match = { userId: userObjectId };

    if (rangeContext?.startDate || rangeContext?.endDate) {
        match.date = {};

        if (rangeContext.startDate) {
            match.date.$gte = rangeContext.startDate;
        }

        if (rangeContext.endDate) {
            match.date.$lt = rangeContext.endDate;
        }
    }

    if (category) {
        match.category = category;
    }

    return match;
}

async function getTotalAmount(model, userObjectId, rangeContext, category = null) {
    const [result] = await model.aggregate([
        { $match: buildMatch(userObjectId, rangeContext, category) },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return Number(result?.total || 0);
}

async function getFinancialSnapshotForRange({ userId, rangeContext, recentLimit = 5 }) {
    const userObjectId = new Types.ObjectId(String(userId));

    const [incomeTotal, expenseTotal, topExpenseCategories, incomeRows, expenseRows] = await Promise.all([
        getTotalAmount(Income, userObjectId, rangeContext),
        getTotalAmount(Expense, userObjectId, rangeContext),
        Expense.aggregate([
            { $match: buildMatch(userObjectId, rangeContext) },
            { $group: { _id: "$category", total: { $sum: "$amount" } } },
            { $sort: { total: -1 } },
            { $limit: 3 },
        ]),
        Income.find(buildMatch(userObjectId, rangeContext))
            .sort({ date: -1 })
            .limit(recentLimit)
            .select("title amount category date")
            .lean(),
        Expense.find(buildMatch(userObjectId, rangeContext))
            .sort({ date: -1 })
            .limit(recentLimit)
            .select("title amount category date")
            .lean(),
    ]);

    const recentTransactions = [
        ...incomeRows.map((item) => ({ ...item, type: "income" })),
        ...expenseRows.map((item) => ({ ...item, type: "expense" })),
    ]
        .sort((left, right) => new Date(right.date) - new Date(left.date))
        .slice(0, recentLimit);

    const totalBalance = Number(incomeTotal) - Number(expenseTotal);
    const savingsRate =
        Number(incomeTotal) > 0 ? Number((((incomeTotal - expenseTotal) / incomeTotal) * 100).toFixed(1)) : null;

    return {
        totalIncome: Number(incomeTotal || 0),
        totalExpenses: Number(expenseTotal || 0),
        totalBalance,
        savingsRate,
        topExpenseCategories: topExpenseCategories.map((item) => ({
            category: String(item._id || "").trim().toLowerCase() || "others",
            amount: Number(item.total || 0),
        })),
        recentTransactions,
    };
}

function buildRecentTransactionReply(snapshot, rangeLabel, language, timeZone) {
    if (!snapshot.recentTransactions.length) {
        return language === "hinglish"
            ? `${capitalize(rangeLabel)} ke liye abhi recent transactions nahi dikh rahe.`
            : `I do not see any recent transactions for ${rangeLabel} yet.`;
    }

    const lines = snapshot.recentTransactions.slice(0, 3).map((item, index) => {
        const typeLabel =
            language === "hinglish" ? (item.type === "income" ? "Income" : "Expense") : capitalize(item.type);
        return `${index + 1}. ${typeLabel} | ${item.title} | ${formatCurrency(item.amount)} on ${formatDate(
            item.date,
            timeZone
        )}`;
    });

    const prefix =
        language === "hinglish"
            ? `${capitalize(rangeLabel)} ke latest transactions ye rahe:`
            : `Here are your latest transactions for ${rangeLabel}:`;

    return [prefix, ...lines].join("\n");
}

function buildDirectSummaryReply({ snapshot, budgetSnapshot, rangeLabel, language }) {
    if (!snapshot.totalIncome && !snapshot.totalExpenses) {
        return language === "hinglish"
            ? `${capitalize(rangeLabel)} mein abhi income ya expense activity nahi hai. Kuch transactions add kar, phir main zyada useful summary dunga.`
            : `There is no income or expense activity in ${rangeLabel} yet. Add a few transactions and I will have a much sharper summary.`;
    }

    const topExpense = snapshot.topExpenseCategories[0];
    const budgetSummary = budgetSnapshot?.summary;

    if (language === "hinglish") {
        const parts = [
            `${capitalize(rangeLabel)} mein tera income ${formatCurrency(snapshot.totalIncome)} tha aur expense ${formatCurrency(
                snapshot.totalExpenses
            )}, matlab net ${snapshot.totalBalance >= 0 ? formatCurrency(snapshot.totalBalance) : `-${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`,
        ];

        if (topExpense) {
            parts.push(`${capitalize(topExpense.category)} sabse bada expense hai at ${formatCurrency(topExpense.amount)}.`);
        }

        if (budgetSummary?.activeBudgets) {
            if (budgetSummary.overBudgetCount > 0) {
                parts.push(
                    `${budgetSummary.overBudgetCount} budget over hai${budgetSummary.closeToLimitCount > 0 ? ` aur ${budgetSummary.closeToLimitCount} close hai` : ""}.`
                );
            } else if (budgetSummary.closeToLimitCount > 0) {
                parts.push(`${budgetSummary.closeToLimitCount} budget limit ke kaafi paas hai.`);
            }
        }

        return parts.join(" ");
    }

    const parts = [
        `For ${rangeLabel}, you earned ${formatCurrency(snapshot.totalIncome)} and spent ${formatCurrency(
            snapshot.totalExpenses
        )}, so you are ${snapshot.totalBalance >= 0 ? `up ${formatCurrency(snapshot.totalBalance)}` : `down ${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`,
    ];

    if (topExpense) {
        parts.push(`${capitalize(topExpense.category)} is the biggest expense at ${formatCurrency(topExpense.amount)}.`);
    }

    if (budgetSummary?.activeBudgets) {
        if (budgetSummary.overBudgetCount > 0) {
            parts.push(
                `${budgetSummary.overBudgetCount} budget ${budgetSummary.overBudgetCount === 1 ? "is" : "are"} over the limit${budgetSummary.closeToLimitCount > 0 ? ` and ${budgetSummary.closeToLimitCount} ${budgetSummary.closeToLimitCount === 1 ? "is" : "are"} close` : ""}.`
            );
        } else if (budgetSummary.closeToLimitCount > 0) {
            parts.push(
                `${budgetSummary.closeToLimitCount} budget ${budgetSummary.closeToLimitCount === 1 ? "is" : "are"} close to the limit.`
            );
        }
    }

    return parts.join(" ");
}

function buildDirectExpenseReply({ snapshot, totalSpent, category, rangeLabel, language }) {
    const topExpense = snapshot.topExpenseCategories[0];

    if (language === "hinglish") {
        if (category) {
            return `${capitalize(rangeLabel)} mein tune ${capitalize(category)} pe ${formatCurrency(totalSpent)} spend kiya.`;
        }

        const parts = [`${capitalize(rangeLabel)} mein total spend ${formatCurrency(totalSpent)} hai.`];
        if (topExpense) {
            parts.push(`${capitalize(topExpense.category)} sabse bada chunk hai at ${formatCurrency(topExpense.amount)}.`);
        }
        return parts.join(" ");
    }

    if (category) {
        return `You spent ${formatCurrency(totalSpent)} on ${capitalize(category)} in ${rangeLabel}.`;
    }

    const parts = [`You spent ${formatCurrency(totalSpent)} in ${rangeLabel}.`];
    if (topExpense) {
        parts.push(`${capitalize(topExpense.category)} was the biggest slice at ${formatCurrency(topExpense.amount)}.`);
    }
    return parts.join(" ");
}

function buildDirectIncomeReply({ totalIncome, category, rangeLabel, language }) {
    if (language === "hinglish") {
        if (category) {
            return `${capitalize(rangeLabel)} mein ${capitalize(category)} se ${formatCurrency(totalIncome)} aya.`;
        }

        return `${capitalize(rangeLabel)} mein total income ${formatCurrency(totalIncome)} hai.`;
    }

    if (category) {
        return `You brought in ${formatCurrency(totalIncome)} from ${capitalize(category)} in ${rangeLabel}.`;
    }

    return `You brought in ${formatCurrency(totalIncome)} in ${rangeLabel}.`;
}

function buildDirectBalanceReply({ snapshot, rangeLabel, language }) {
    if (language === "hinglish") {
        return `${capitalize(rangeLabel)} mein income ${formatCurrency(snapshot.totalIncome)} aur expenses ${formatCurrency(
            snapshot.totalExpenses
        )} hai, toh net ${snapshot.totalBalance >= 0 ? formatCurrency(snapshot.totalBalance) : `-${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`;
    }

    return `For ${rangeLabel}, income is ${formatCurrency(snapshot.totalIncome)} and expenses are ${formatCurrency(
        snapshot.totalExpenses
    )}, so you are ${snapshot.totalBalance >= 0 ? `left with ${formatCurrency(snapshot.totalBalance)}` : `short by ${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`;
}

function buildDirectSavingsRateReply({ snapshot, rangeLabel, language }) {
    if (!snapshot.totalIncome) {
        return language === "hinglish"
            ? `${capitalize(rangeLabel)} ke liye income logged nahi hai, isliye savings rate nikalna possible nahi hai abhi.`
            : `There is no income logged for ${rangeLabel}, so I cannot calculate a savings rate yet.`;
    }

    if (language === "hinglish") {
        return `${capitalize(rangeLabel)} ka tera savings rate ${formatPercent(snapshot.savingsRate)} hai. Matlab ${formatCurrency(
            snapshot.totalBalance
        )} bacha from ${formatCurrency(snapshot.totalIncome)} income.`;
    }

    return `Your savings rate for ${rangeLabel} is ${formatPercent(snapshot.savingsRate)}. That is ${formatCurrency(
        snapshot.totalBalance
    )} left from ${formatCurrency(snapshot.totalIncome)} income.`;
}

function buildDirectTopExpenseReply({ snapshot, rangeLabel, language }) {
    const topExpense = snapshot.topExpenseCategories[0];

    if (!topExpense) {
        return language === "hinglish"
            ? `${capitalize(rangeLabel)} mein koi expense activity nahi dikh rahi abhi.`
            : `I do not see any expenses in ${rangeLabel} yet.`;
    }

    if (language === "hinglish") {
        return `${capitalize(rangeLabel)} ka sabse bada expense ${capitalize(topExpense.category)} hai at ${formatCurrency(
            topExpense.amount
        )}.`;
    }

    return `Your biggest expense in ${rangeLabel} is ${capitalize(topExpense.category)} at ${formatCurrency(
        topExpense.amount
    )}.`;
}

async function buildBudgetReply({
    userId,
    category,
    budgetFocus,
    budgetSelection,
    language,
    timeZone,
}) {
    const budgetSnapshot = await getBudgetSnapshot({
        userId,
        month: budgetSelection.monthKey,
        timeZone,
    });
    const budgetSummary = budgetSnapshot.summary;
    const monthRange = buildRangeContextForMonthKey(budgetSelection.monthKey, timeZone);
    const budgetScopeNote = budgetSelection.approximate
        ? language === "hinglish"
            ? ` Budgets monthly track hote hain, isliye main ${budgetSelection.monthLabel} use kar raha hoon.`
            : ` Budgets are tracked monthly, so I am using ${budgetSelection.monthLabel}.`
        : "";

    if (category) {
        const categoryBudget = budgetSnapshot.budgets.find((item) => item.category === category);

        if (!categoryBudget) {
            const spentWithoutBudget = await getTotalAmount(
                Expense,
                new Types.ObjectId(String(userId)),
                monthRange,
                category
            );

            return language === "hinglish"
                ? `${budgetSelection.monthLabel} mein tune ${capitalize(category)} pe ${formatCurrency(
                    spentWithoutBudget
                )} spend kiya, lekin is category ka budget set nahi hai.${budgetScopeNote}`
                : `You spent ${formatCurrency(spentWithoutBudget)} on ${capitalize(
                    category
                )} in ${budgetSelection.monthLabel}, but there is no budget set for that category.${budgetScopeNote}`;
        }

        if (categoryBudget.overspend > 0) {
            return language === "hinglish"
                ? `${budgetSelection.monthLabel} ka tera ${capitalize(category)} budget ${formatCurrency(
                    categoryBudget.amount
                )} hai aur spend ${formatCurrency(categoryBudget.spent)} ho chuka hai, toh tu ${formatCurrency(
                    categoryBudget.overspend
                )} over hai.${budgetScopeNote}`
                : `Your ${capitalize(category)} budget for ${budgetSelection.monthLabel} is ${formatCurrency(
                    categoryBudget.amount
                )}, and you have already spent ${formatCurrency(
                    categoryBudget.spent
                )}, so you are over by ${formatCurrency(categoryBudget.overspend)}.${budgetScopeNote}`;
        }

        return language === "hinglish"
            ? `${budgetSelection.monthLabel} mein ${capitalize(category)} budget ${formatCurrency(
                categoryBudget.amount
            )} ka hai. Ab tak ${formatCurrency(categoryBudget.spent)} use hua hai, toh ${formatCurrency(
                categoryBudget.remaining
            )} left hai.${budgetScopeNote}`
            : `Your ${capitalize(category)} budget for ${budgetSelection.monthLabel} is ${formatCurrency(
                categoryBudget.amount
            )}. You have used ${formatCurrency(categoryBudget.spent)} so far, so ${formatCurrency(
                categoryBudget.remaining
            )} is still left.${budgetScopeNote}`;
    }

    if (!budgetSummary.activeBudgets) {
        return language === "hinglish"
            ? `${budgetSelection.monthLabel} ke liye abhi koi budgets set nahi hain.${budgetScopeNote}`
            : `You do not have any budgets set for ${budgetSelection.monthLabel}.${budgetScopeNote}`;
    }

    if (budgetFocus === "remaining") {
        return language === "hinglish"
            ? `${budgetSelection.monthLabel} mein active budgets ke across ${formatCurrency(
                budgetSummary.totalRemaining
            )} remaining hai. ${budgetSummary.overBudgetCount > 0 ? `${budgetSummary.overBudgetCount} category over budget hai.` : "Abhi koi category over budget nahi hai."}${budgetScopeNote}`
            : `Across your active budgets for ${budgetSelection.monthLabel}, you have ${formatCurrency(
                budgetSummary.totalRemaining
            )} remaining. ${budgetSummary.overBudgetCount > 0 ? `${budgetSummary.overBudgetCount} ${budgetSummary.overBudgetCount === 1 ? "category is" : "categories are"} over budget.` : "No category is over budget right now."}${budgetScopeNote}`;
    }

    if (budgetSummary.overBudgetCount > 0 || budgetSummary.closeToLimitCount > 0) {
        return language === "hinglish"
            ? `${budgetSelection.monthLabel} mein ${budgetSummary.overBudgetCount} budget over hai aur ${budgetSummary.closeToLimitCount} close hai. Total remaining ${formatCurrency(
                budgetSummary.totalRemaining
            )} hai.${budgetScopeNote}`
            : `For ${budgetSelection.monthLabel}, ${budgetSummary.overBudgetCount} ${budgetSummary.overBudgetCount === 1 ? "budget is" : "budgets are"} over the limit and ${budgetSummary.closeToLimitCount} ${budgetSummary.closeToLimitCount === 1 ? "is" : "are"} close. Total remaining is ${formatCurrency(
                budgetSummary.totalRemaining
            )}.${budgetScopeNote}`;
    }

    return language === "hinglish"
        ? `${budgetSelection.monthLabel} ke budgets abhi on track lag rahe hain. ${formatCurrency(
            budgetSummary.totalRemaining
        )} abhi bhi available hai.${budgetScopeNote}`
        : `Your budgets for ${budgetSelection.monthLabel} look on track. ${formatCurrency(
            budgetSummary.totalRemaining
        )} is still available.${budgetScopeNote}`;
}

async function getChatHistory(userId) {
    if (!userId) {
        return [];
    }

    const rawValue = await redis.get(buildMemoryKey(userId));
    return parseStoredHistory(rawValue).slice(-CHAT_MEMORY_MAX_TURNS);
}

async function appendChatTurn({
    userId,
    userMessage,
    assistantReply,
    language,
    mode,
    meta = {},
}) {
    if (!userId || !userMessage || !assistantReply) {
        return;
    }

    const history = await getChatHistory(userId);
    history.push({
        userMessage: String(userMessage).trim(),
        assistantReply: String(assistantReply).trim(),
        language: language === "hinglish" ? "hinglish" : "english",
        mode: mode === DIRECT_CHAT_MODE ? DIRECT_CHAT_MODE : ASSISTANT_CHAT_MODE,
        meta,
        createdAt: new Date().toISOString(),
    });

    await redis.setEx(
        buildMemoryKey(userId),
        CHAT_MEMORY_TTL_SECONDS,
        JSON.stringify(history.slice(-CHAT_MEMORY_MAX_TURNS))
    );
}

async function resolveDirectChatReply({
    userId,
    message,
    language = "english",
    timeZone,
    history = [],
}) {
    const normalizedMessage = String(message || "").trim().toLowerCase();
    const followUp = isFollowUpMessage(normalizedMessage);
    const lastContext = getLastResolvedContext(history);
    const { category } = parseCategoryFromMessage(normalizedMessage, lastContext, followUp);
    const { rangeKey } = parseRangeKeyFromMessage(normalizedMessage, lastContext, followUp);
    const intent = resolveDirectIntent(normalizedMessage, lastContext, followUp);

    if (!DIRECT_INTENTS.has(intent)) {
        return null;
    }

    const resolvedRangeKey = rangeKey || "this_month";
    const rangeContext = buildRangeContext(resolvedRangeKey, timeZone);
    const userObjectId = new Types.ObjectId(String(userId));
    const snapshot = await getFinancialSnapshotForRange({
        userId,
        rangeContext,
        recentLimit: 5,
    });

    let reply;

    switch (intent) {
        case "summary_overview": {
            const budgetSelection = getBudgetMonthSelection(resolvedRangeKey, timeZone);
            const budgetSnapshot = await getBudgetSnapshot({
                userId,
                month: budgetSelection.monthKey,
                timeZone,
            });
            reply = buildDirectSummaryReply({
                snapshot,
                budgetSnapshot,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        }
        case "expense_total": {
            const totalSpent = category
                ? await getTotalAmount(Expense, userObjectId, rangeContext, category)
                : snapshot.totalExpenses;
            reply = buildDirectExpenseReply({
                snapshot,
                totalSpent,
                category,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        }
        case "income_total": {
            const totalIncome = category
                ? await getTotalAmount(Income, userObjectId, rangeContext, category)
                : snapshot.totalIncome;
            reply = buildDirectIncomeReply({
                totalIncome,
                category,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        }
        case "balance":
            reply = buildDirectBalanceReply({
                snapshot,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        case "savings_rate":
            reply = buildDirectSavingsRateReply({
                snapshot,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        case "top_expense":
            reply = buildDirectTopExpenseReply({
                snapshot,
                rangeLabel: rangeContext.label,
                language,
            });
            break;
        case "budget_status": {
            const budgetSelection = getBudgetMonthSelection(resolvedRangeKey, timeZone);
            reply = await buildBudgetReply({
                userId,
                category,
                budgetFocus: parseBudgetFocus(normalizedMessage),
                budgetSelection,
                language,
                timeZone,
            });
            break;
        }
        case "recent_transactions":
            reply = buildRecentTransactionReply(snapshot, rangeContext.label, language, timeZone);
            break;
        default:
            return null;
    }

    return {
        reply,
        mode: DIRECT_CHAT_MODE,
        source: "database",
        intent,
        rangeKey: resolvedRangeKey,
        rangeLabel: rangeContext.label,
        category,
        resolvedContext: {
            intent,
            rangeKey: resolvedRangeKey,
            category,
        },
    };
}

function buildConversationSnippet(history = []) {
    const recentTurns = history
        .filter((turn) => {
            const assistantReply = String(turn?.assistantReply || "").trim();

            return assistantReply.length >= 12 && /[.!?]$/.test(assistantReply);
        })
        .slice(-CHAT_AI_HISTORY_MAX_TURNS);

    if (!recentTurns.length) {
        return "No prior conversation.";
    }

    return recentTurns
        .flatMap((turn) => [`User: ${turn.userMessage}`, `Assistant: ${turn.assistantReply}`])
        .join("\n");
}

function buildBudgetPromptSnippet(budgetSnapshot) {
    if (!budgetSnapshot?.summary?.activeBudgets) {
        return "- No monthly budgets are set right now.";
    }

    const importantBudgets = budgetSnapshot.budgets
        .slice(0, 4)
        .map(
            (item) =>
                `- ${capitalize(item.category)}: budget ${formatCurrency(item.amount)}, spent ${formatCurrency(
                    item.spent
                )}, remaining ${formatCurrency(item.remaining)}, status ${item.status}`
        )
        .join("\n");

    return [
        `- Active budgets: ${budgetSnapshot.summary.activeBudgets}`,
        `- Total remaining: ${formatCurrency(budgetSnapshot.summary.totalRemaining)}`,
        `- Over budget count: ${budgetSnapshot.summary.overBudgetCount}`,
        `- Close to limit count: ${budgetSnapshot.summary.closeToLimitCount}`,
        importantBudgets,
    ]
        .filter(Boolean)
        .join("\n");
}

function buildAssistantFallbackReply({ snapshot, budgetSnapshot, rangeLabel, language }) {
    if (!snapshot.totalIncome && !snapshot.totalExpenses) {
        return language === "hinglish"
            ? `Finance Buddy abhi thoda busy hai. ${capitalize(rangeLabel)} mein activity kam hai, toh filhal best move hai regular transactions log karna aur thodi der baad phir try karna.`
            : `Finance Buddy is taking a short breather. There is not much activity in ${rangeLabel} yet, so the best move for now is to keep logging transactions and try again in a bit.`;
    }

    const topExpense = snapshot.topExpenseCategories[0];
    const budgetSummary = budgetSnapshot?.summary;

    if (language === "hinglish") {
        const parts = [
            `Finance Buddy abhi unavailable hai, but ${rangeLabel} mein income ${formatCurrency(
                snapshot.totalIncome
            )} aur expense ${formatCurrency(snapshot.totalExpenses)} hai, toh net ${snapshot.totalBalance >= 0 ? formatCurrency(snapshot.totalBalance) : `-${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`,
        ];

        if (topExpense) {
            parts.push(`${capitalize(topExpense.category)} sabse bada expense hai at ${formatCurrency(topExpense.amount)}.`);
        }

        if (budgetSummary?.overBudgetCount > 0) {
            parts.push(`${budgetSummary.overBudgetCount} budget over limit hai, toh wahi first fix kar.`);
        }

        return parts.join(" ");
    }

    const parts = [
        `Finance Buddy is temporarily unavailable, but in ${rangeLabel} you earned ${formatCurrency(
            snapshot.totalIncome
        )} and spent ${formatCurrency(snapshot.totalExpenses)}, leaving ${snapshot.totalBalance >= 0 ? formatCurrency(snapshot.totalBalance) : `-${formatAbsoluteCurrency(snapshot.totalBalance)}`}.`,
    ];

    if (topExpense) {
        parts.push(`${capitalize(topExpense.category)} is your biggest expense at ${formatCurrency(topExpense.amount)}.`);
    }

    if (budgetSummary?.overBudgetCount > 0) {
        parts.push(`${budgetSummary.overBudgetCount} budget ${budgetSummary.overBudgetCount === 1 ? "is" : "are"} over the limit, so that is the first place to tighten up.`);
    }

    return parts.join(" ");
}

function buildAssistantCoachReply({ snapshot, budgetSnapshot, rangeLabel, language }) {
    if (!snapshot.totalIncome && !snapshot.totalExpenses) {
        return language === "hinglish"
            ? `${capitalize(rangeLabel)} mein abhi zyada activity nahi hai. Sabse pehle regular transactions log kar, phir main better saving aur budget advice de paunga.`
            : `There is not much activity in ${rangeLabel} yet. Start by logging transactions consistently, and I will be able to give much sharper savings and budget advice.`;
    }

    const topExpense = snapshot.topExpenseCategories[0];
    const budgetSummary = budgetSnapshot?.summary;

    if (language === "hinglish") {
        const parts = [];

        if (topExpense) {
            parts.push(`${capitalize(rangeLabel)} mein sabse bada expense ${capitalize(topExpense.category)} hai at ${formatCurrency(topExpense.amount)}.`);
        } else {
            parts.push(`${capitalize(rangeLabel)} mein total expense ${formatCurrency(snapshot.totalExpenses)} hai.`);
        }

        if (budgetSummary?.overBudgetCount > 0) {
            parts.push(`${budgetSummary.overBudgetCount} budget over limit hai, toh pehle wahi categories tighten kar.`);
        } else if (snapshot.totalBalance > 0) {
            parts.push(`${formatCurrency(snapshot.totalBalance)} bach raha hai, toh isme se 20% alag save karna ek simple next step hoga.`);
        } else {
            parts.push(`Expenses income se ${formatAbsoluteCurrency(snapshot.totalBalance)} zyada hain, toh biggest expense category ko 10-15% cut karna fastest fix hoga.`);
        }

        return parts.join(" ");
    }

    const parts = [];

    if (topExpense) {
        parts.push(`${capitalize(topExpense.category)} is your biggest expense in ${rangeLabel} at ${formatCurrency(topExpense.amount)}.`);
    } else {
        parts.push(`Your total spending in ${rangeLabel} is ${formatCurrency(snapshot.totalExpenses)}.`);
    }

    if (budgetSummary?.overBudgetCount > 0) {
        parts.push(`${budgetSummary.overBudgetCount} budget ${budgetSummary.overBudgetCount === 1 ? "is" : "are"} over the limit, so that is the first place to tighten up.`);
    } else if (snapshot.totalBalance > 0) {
        parts.push(`You still have ${formatCurrency(snapshot.totalBalance)} left over, so moving 20% of that into savings would be a simple next step.`);
    } else {
        parts.push(`Expenses are ahead of income by ${formatAbsoluteCurrency(snapshot.totalBalance)}, so trimming the biggest expense category by 10-15% is the quickest fix.`);
    }

    return parts.join(" ");
}

async function buildAssistantPromptContext({
    userId,
    message,
    language = "english",
    timeZone,
    history = [],
}) {
    const normalizedMessage = String(message || "").trim().toLowerCase();
    const followUp = isFollowUpMessage(normalizedMessage);
    const lastContext = getLastResolvedContext(history);
    const { category } = parseCategoryFromMessage(normalizedMessage, lastContext, followUp);
    const { rangeKey } = parseRangeKeyFromMessage(normalizedMessage, lastContext, followUp);
    const resolvedRangeKey = rangeKey || "this_month";
    const rangeContext = buildRangeContext(resolvedRangeKey, timeZone);
    const budgetSelection = getBudgetMonthSelection(resolvedRangeKey, timeZone);
    const [snapshot, budgetSnapshot] = await Promise.all([
        getFinancialSnapshotForRange({
            userId,
            rangeContext,
            recentLimit: 5,
        }),
        getBudgetSnapshot({
            userId,
            month: budgetSelection.monthKey,
            timeZone,
        }),
    ]);

    const languageInstruction =
        language === "hinglish"
            ? "Respond only in natural Hinglish using short, friendly sentences."
            : "Respond in natural conversational English.";
    const recentTransactionsText = snapshot.recentTransactions.length
        ? snapshot.recentTransactions
              .map(
                  (item) =>
                      `- ${capitalize(item.type)} | ${item.title} | ${formatCurrency(item.amount)} | ${formatDate(
                          item.date,
                          timeZone
                      )}`
              )
              .join("\n")
        : "- No recent transactions in this window.";

    const prompt = `You are Finance Buddy, an in-app money assistant for a personal finance app.

Use the exact financial data below. If the user wants a precise number, never invent one. If the data does not support a precise answer, say that plainly and give the closest safe guidance.

${languageInstruction}

Style rules:
- Be warm, concise, and practical.
- Keep the answer to 2-4 sentences.
- Reference exact numbers from the data when useful.
- Add one concrete next step when giving advice.
- Do not lecture or sound robotic.

Current user message:
${JSON.stringify(String(message || "").trim())}

Recent conversation:
${buildConversationSnippet(followUp ? history : [])}

Resolved context:
- Time window: ${rangeContext.label}
- Detected category: ${category || "none"}
- Budget month in app: ${budgetSelection.monthLabel}

Exact finance data for ${rangeContext.label}:
- Income: ${formatCurrency(snapshot.totalIncome)}
- Expenses: ${formatCurrency(snapshot.totalExpenses)}
- Balance: ${snapshot.totalBalance >= 0 ? formatCurrency(snapshot.totalBalance) : `-${formatAbsoluteCurrency(snapshot.totalBalance)}`}
- Savings rate: ${snapshot.savingsRate === null ? "not available" : formatPercent(snapshot.savingsRate)}
- Top expense categories: ${snapshot.topExpenseCategories.length ? snapshot.topExpenseCategories.map((item) => `${capitalize(item.category)} (${formatCurrency(item.amount)})`).join(", ") : "none"}

Recent transactions:
${recentTransactionsText}

Budget snapshot:
${buildBudgetPromptSnippet(budgetSnapshot)}

If the user is asking for strategy or coaching, answer that directly using the numbers above.
If the user asks a vague follow-up, use the recent conversation to infer the missing context safely.
If the user asks something unrelated to finances, gently steer back to finance help.`;

    return {
        prompt,
        coachFallbackReply: buildAssistantCoachReply({
            snapshot,
            budgetSnapshot,
            rangeLabel: rangeContext.label,
            language,
        }),
        errorFallbackReply: buildAssistantFallbackReply({
            snapshot,
            budgetSnapshot,
            rangeLabel: rangeContext.label,
            language,
        }),
        fallbackReply: buildAssistantFallbackReply({
            snapshot,
            budgetSnapshot,
            rangeLabel: rangeContext.label,
            language,
        }),
        mode: ASSISTANT_CHAT_MODE,
        source: "assistant",
        intent: "assistant_coaching",
        rangeKey: resolvedRangeKey,
        rangeLabel: rangeContext.label,
        category,
        resolvedContext: {
            intent: "assistant",
            rangeKey: resolvedRangeKey,
            category,
        },
    };
}

module.exports = {
    ASSISTANT_CHAT_MODE,
    DIRECT_CHAT_MODE,
    appendChatTurn,
    buildAssistantCoachReply,
    buildAssistantPromptContext,
    getChatHistory,
    resolveDirectChatReply,
};
