const axios = require("axios");
const { TRANSACTION_ICON_MAP } = require("../../utils/transactionConfig.js");
const {
    OPENROUTER_API_KEY,
    buildOpenRouterHeaders,
    getOpenRouterChatCompletionsUrl,
    getOpenRouterRetryDelayMs,
    isOpenRouterRateLimitError,
    logOpenRouterError,
} = require("../../utils/openRouterClient.js");
const { parseAIJSON } = require("../../utils/aiJson.js");

const TELEGRAM_PARSER_OPENROUTER_COOLDOWN_MS = Number(
    process.env.TELEGRAM_PARSER_OPENROUTER_COOLDOWN_MS || 60000
);
const TELEGRAM_PARSER_USE_OPENROUTER =
    String(process.env.TELEGRAM_PARSER_USE_OPENROUTER || "true").trim().toLowerCase() !== "false";
const TELEGRAM_PARSER_OPENROUTER_MODEL = String(
    process.env.TELEGRAM_PARSER_OPENROUTER_MODEL ||
        process.env.OPENROUTER_MODEL ||
        "openai/gpt-4o-mini"
).trim();
let openRouterBlockedUntil = 0;

const ALLOWED_CATEGORIES = Object.freeze({
    income: Object.keys(TRANSACTION_ICON_MAP.income),
    expense: Object.keys(TRANSACTION_ICON_MAP.expense),
});

const TYPE_KEYWORDS = Object.freeze({
    income: [
        "earn",
        "earned",
        "income",
        "salary",
        "credited",
        "credit",
        "received",
        "receive",
        "got paid",
        "bonus",
        "freelance",
        "profit",
        "sold",
    ],
    expense: [
        "spent",
        "spend",
        "expense",
        "paid",
        "pay",
        "bought",
        "buy",
        "purchase",
        "purchased",
        "recharge",
        "bill",
        "rent",
        "fare",
        "ordered",
    ],
});

const CATEGORY_KEYWORDS = Object.freeze({
    expense: {
        rent: ["rent", "flat", "house", "hostel", "room"],
        entertainment: ["movie", "netflix", "prime", "game", "entertainment", "outing"],
        food: ["food", "groceries", "grocery", "restaurant", "cafe", "lunch", "dinner", "breakfast", "snack"],
        transport: ["uber", "ola", "auto", "taxi", "bus", "train", "metro", "fuel", "petrol", "diesel", "travel", "transport"],
        utilities: ["electricity", "water", "wifi", "internet", "mobile bill", "recharge", "utility", "utilities", "bill"],
        healthcare: ["doctor", "hospital", "medicine", "medical", "health", "healthcare", "pharmacy", "clinic"],
        education: ["fees", "fee", "course", "tuition", "education", "school", "college", "book", "exam"],
        shopping: ["shopping", "amazon", "flipkart", "clothes", "cloth", "mall", "purchase"],
    },
    income: {
        salary: ["salary", "paycheck", "payroll", "wage"],
        freelance: ["freelance", "client", "gig", "project"],
        business: ["business", "sale", "sales", "revenue", "shop"],
        investment: ["interest", "dividend", "investment", "stock", "mutual fund", "return"],
    },
});

const CATEGORY_LABELS = Object.freeze({
    income: {
        salary: "Salary",
        freelance: "Freelance payment",
        business: "Business income",
        investment: "Investment return",
        others: "Other income",
    },
    expense: {
        rent: "Rent payment",
        entertainment: "Entertainment",
        food: "Food expense",
        transport: "Transport expense",
        utilities: "Utilities bill",
        healthcare: "Healthcare expense",
        education: "Education expense",
        shopping: "Shopping",
        others: "Other expense",
    },
});

const normalizeWhitespace = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const getTodayDateString = (timeZone = "UTC") => {
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });

        return formatter.format(new Date());
    } catch (error) {
        return new Date().toISOString().split("T")[0];
    }
};

const addDays = (dateString, days) => {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split("T")[0];
};

const extractExplicitDate = (text = "", timeZone = "UTC") => {
    const normalizedText = normalizeWhitespace(text).toLowerCase();
    const today = getTodayDateString(timeZone);

    if (normalizedText.includes("yesterday")) {
        return addDays(today, -1);
    }

    if (normalizedText.includes("today")) {
        return today;
    }

    const isoMatch = normalizedText.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
        return isoMatch[1];
    }

    const slashMatch = normalizedText.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
    if (!slashMatch) {
        return today;
    }

    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = slashMatch[3] ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]) : Number(today.slice(0, 4));

    if (
        Number.isInteger(day) &&
        Number.isInteger(month) &&
        Number.isInteger(year) &&
        day >= 1 &&
        day <= 31 &&
        month >= 1 &&
        month <= 12
    ) {
        return `${year.toString().padStart(4, "0")}-${month
            .toString()
            .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }

    return today;
};

const normalizeType = (value = "", text = "") => {
    const normalizedValue = normalizeWhitespace(value).toLowerCase();
    if (normalizedValue === "income" || normalizedValue === "expense") {
        return normalizedValue;
    }

    const normalizedText = normalizeWhitespace(text).toLowerCase();

    if (TYPE_KEYWORDS.income.some((keyword) => normalizedText.includes(keyword))) {
        return "income";
    }

    if (TYPE_KEYWORDS.expense.some((keyword) => normalizedText.includes(keyword))) {
        return "expense";
    }

    return null;
};

const detectCategoryFromText = (transactionType, text = "") => {
    const normalizedText = normalizeWhitespace(text).toLowerCase();
    const categoryKeywords = CATEGORY_KEYWORDS[transactionType] || {};

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some((keyword) => normalizedText.includes(keyword))) {
            return category;
        }
    }

    return "others";
};

const normalizeCategory = (transactionType, candidate = "", text = "") => {
    const allowedCategories = ALLOWED_CATEGORIES[transactionType] || [];
    const normalizedCandidate = normalizeWhitespace(candidate).toLowerCase();

    if (allowedCategories.includes(normalizedCandidate)) {
        return normalizedCandidate;
    }

    return detectCategoryFromText(transactionType, `${candidate} ${text}`);
};

const normalizeAmount = (value) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Number(value);
    }

    const normalizedValue = String(value || "")
        .replace(/[^\d.,-]/g, " ")
        .replace(/,/g, "")
        .trim();

    const match = normalizedValue.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    const parsedValue = Number(match[0]);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const extractAmountFromText = (text = "") => {
    const sanitizedText = normalizeWhitespace(text)
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
        .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, " ");

    const matches = [...sanitizedText.matchAll(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi)];
    const amounts = matches
        .map((match) => Number(String(match[1] || "").replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value > 0);

    if (amounts.length === 0) {
        return null;
    }

    return Math.max(...amounts);
};

const buildTitleFromText = ({ title, transactionType, category, text }) => {
    const normalizedTitle = normalizeWhitespace(title);
    if (normalizedTitle) {
        return normalizedTitle.slice(0, 80);
    }

    const normalizedText = normalizeWhitespace(text).toLowerCase();
    const customTitles = [
        { keyword: "groceries", title: "Groceries" },
        { keyword: "grocery", title: "Groceries" },
        { keyword: "uber", title: "Uber ride" },
        { keyword: "ola", title: "Ola ride" },
        { keyword: "rent", title: "Rent" },
        { keyword: "salary", title: "Salary" },
        { keyword: "freelance", title: "Freelance payment" },
        { keyword: "interest", title: "Interest income" },
    ];

    const matchedTitle = customTitles.find((item) => normalizedText.includes(item.keyword));
    if (matchedTitle) {
        return matchedTitle.title;
    }

    return CATEGORY_LABELS[transactionType]?.[category] || (transactionType === "income" ? "Other income" : "Other expense");
};

const buildDraftResult = ({ transactionType, amount, category, title, date, confidence, sourceText }) => ({
    status: "ready",
    confidence,
    draft: {
        type: transactionType,
        title,
        category,
        amount,
        date,
        sourceText,
    },
});

const buildUnclearResult = (reply) => ({
    status: "unclear",
    reply:
        reply ||
        "I could not confidently extract a transaction. Try a message like 'Spent 420 on groceries today' or 'Received 15000 salary'.",
});

const buildOpenRouterUnavailableResult = () => ({
    status: "unclear",
    mode: "fallback",
    reply:
        "Transaction parsing is currently unavailable. Please try again later.",
});

const extractOpenRouterMessageText = (responseData = {}) => {
    const content = responseData?.choices?.[0]?.message?.content;

    if (typeof content === "string") {
        return content;
    }

    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .map((item) => {
            if (typeof item === "string") {
                return item;
            }

            if (typeof item?.text === "string") {
                return item.text;
            }

            if (typeof item?.content === "string") {
                return item.content;
            }

            return "";
        })
        .join("")
        .trim();
};

const parseTransactionWithOpenRouter = async ({ text, timeZone }) => {
    const today = getTodayDateString(timeZone);
    const allowedCategoryList = [
        ...ALLOWED_CATEGORIES.expense,
        ...ALLOWED_CATEGORIES.income,
    ].join(", ");
    const response = await axios.post(
        getOpenRouterChatCompletionsUrl(),
        {
            model: TELEGRAM_PARSER_OPENROUTER_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You extract finance transactions from Telegram messages for an expense tracker. Return only a single valid JSON object and no markdown.",
                },
                {
                    role: "user",
                    content: `Extract one finance transaction from this Telegram message.

Return ONLY valid JSON with this exact shape:
{
  "intent": "transaction" | "unclear" | "other",
  "type": "expense" | "income" | null,
  "title": "short title",
  "category": "one of: ${allowedCategoryList}",
  "amount": 0,
  "date": "YYYY-MM-DD",
  "confidence": 0.0,
  "reply": "short user-facing clarification if unclear"
}

Rules:
- Today in the user's timezone is ${today}.
- Use YYYY-MM-DD for date.
- Pick only one transaction from the message.
- If the message is not clearly a transaction, set intent to "unclear" or "other".
- If title is missing, infer a short title from the text.
- Never include markdown or code fences.

User message: "${text}"`,
                },
            ],
            temperature: 0.1,
            max_tokens: 400,
            response_format: {
                type: "json_object",
            },
        },
        {
            headers: buildOpenRouterHeaders(),
        }
    );

    const rawText = extractOpenRouterMessageText(response.data);
    const parsed = parseAIJSON(rawText);

    if (String(parsed.intent || "").toLowerCase() !== "transaction") {
        return buildUnclearResult(parsed.reply);
    }

    const transactionType = normalizeType(parsed.type, text);
    const amount = normalizeAmount(parsed.amount);

    if (!transactionType || !amount) {
        return buildUnclearResult(parsed.reply);
    }

    const category = normalizeCategory(transactionType, parsed.category, text);

    return buildDraftResult({
        transactionType,
        amount,
        category,
        title: buildTitleFromText({
            title: parsed.title,
            transactionType,
            category,
            text,
        }),
        date: extractExplicitDate(parsed.date || text, timeZone),
        confidence:
            typeof parsed.confidence === "number" && parsed.confidence > 0
                ? Number(parsed.confidence.toFixed(2))
                : 0.88,
        sourceText: text,
    });
};

const parseTransactionHeuristically = ({ text, timeZone }) => {
    const transactionType = normalizeType("", text);
    const amount = extractAmountFromText(text);

    if (!transactionType || !amount) {
        return buildUnclearResult();
    }

    const category = detectCategoryFromText(transactionType, text);

    return buildDraftResult({
        transactionType,
        amount,
        category,
        title: buildTitleFromText({
            title: "",
            transactionType,
            category,
            text,
        }),
        date: extractExplicitDate(text, timeZone),
        confidence: 0.74,
        sourceText: text,
    });
};

const getOpenRouterCooldownRemainingMs = () =>
    Math.max(0, openRouterBlockedUntil - Date.now());

const activateOpenRouterCooldown = (error) => {
    const retryDelayMs = Math.max(
        getOpenRouterRetryDelayMs(error),
        TELEGRAM_PARSER_OPENROUTER_COOLDOWN_MS
    );
    openRouterBlockedUntil = Date.now() + retryDelayMs;
};

const parseTelegramTransactionMessage = async ({ text, timeZone = "Asia/Kolkata" }) => {
    const normalizedText = normalizeWhitespace(text);

    if (!normalizedText) {
        return buildUnclearResult("Send a transaction message in text, for example 'Spent 420 on groceries today'.");
    }

    if (
        TELEGRAM_PARSER_USE_OPENROUTER &&
        OPENROUTER_API_KEY &&
        getOpenRouterCooldownRemainingMs() === 0
    ) {
        try {
            return await parseTransactionWithOpenRouter({
                text: normalizedText,
                timeZone,
            });
        } catch (error) {
            if (isOpenRouterRateLimitError(error)) {
                activateOpenRouterCooldown(error);
                logOpenRouterError("Telegram parser rate-limit fallback", error);

                const heuristicResult = parseTransactionHeuristically({
                    text: normalizedText,
                    timeZone,
                });

                if (heuristicResult.status === "ready") {
                    return {
                        ...heuristicResult,
                        mode: "heuristic_fallback",
                    };
                }

                return buildOpenRouterUnavailableResult();
            }

            logOpenRouterError("Telegram parser fallback", error);
        }
    }

    return parseTransactionHeuristically({
        text: normalizedText,
        timeZone,
    });
};

module.exports = {
    ALLOWED_CATEGORIES,
    parseTelegramTransactionMessage,
};
