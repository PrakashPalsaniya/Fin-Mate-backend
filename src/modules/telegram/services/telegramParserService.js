const axios = require("axios");
const { TRANSACTION_ICON_MAP } = require("../../../shared/utils/transaction.config.js");
const {
    OPENROUTER_API_KEY,
    buildOpenRouterHeaders,
    getOpenRouterChatCompletionsUrl,
    getOpenRouterRetryDelayMs,
    isOpenRouterRateLimitError,
    logOpenRouterError,
} = require("../../ai/openrouter.js");
const { parseAIJSON } = require("../../../shared/utils/ai-json.utils.js");

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

const buildDraftResult = ({ type, amount, category, title, date, confidence, sourceText }) => ({
    status: "ready",
    confidence,
    draft: {
        type,
        title: normalizeWhitespace(title).slice(0, 80),
        category,
        amount: Number(amount),
        date: date || new Date().toISOString().split("T")[0],
        sourceText,
    },
});

const buildUnclearResult = (reply) => ({
    status: "unclear",
    reply: reply || "I could not confidently extract a transaction. Try something like 'Spent 420 on lunch today'.",
});

const extractOpenRouterMessageText = (responseData = {}) => {
    const content = responseData?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    return "";
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
                    content: "Extract finance transactions from text. Return ONLY JSON.",
                },
                {
                    role: "user",
                    content: `Extract one finance transaction from: "${text}"
                    
                    Return ONLY valid JSON with this shape:
                    {
                      "intent": "transaction" | "unclear",
                      "type": "expense" | "income",
                      "title": "short title",
                      "category": "one of: ${allowedCategoryList}",
                      "amount": number,
                      "date": "YYYY-MM-DD",
                      "confidence": 0.0-1.0,
                      "reply": "clarification if unclear"
                    }
                    
                    Today is ${today}.`,
                },
            ],
            temperature: 0.1,
            response_format: { type: "json_object" },
        },
        { headers: buildOpenRouterHeaders() }
    );

    const rawText = extractOpenRouterMessageText(response.data);
    const parsed = parseAIJSON(rawText);

    if (parsed.intent !== "transaction" || !parsed.type || !parsed.amount) {
        return buildUnclearResult(parsed.reply);
    }

    // Final validation against allowed types/categories
    const type = (parsed.type === "income" || parsed.type === "expense") ? parsed.type : "expense";
    const allowedForType = ALLOWED_CATEGORIES[type] || [];
    const category = allowedForType.includes(parsed.category) ? parsed.category : "others";

    return buildDraftResult({
        type,
        amount: parsed.amount,
        category,
        title: parsed.title || "Transaction",
        date: parsed.date,
        confidence: parsed.confidence || 0.85,
        sourceText: text,
    });
};

const parseTelegramTransactionMessage = async ({ text, timeZone = "Asia/Kolkata" }) => {
    const normalizedText = normalizeWhitespace(text);
    if (!normalizedText) return buildUnclearResult();

    if (TELEGRAM_PARSER_USE_OPENROUTER && OPENROUTER_API_KEY && Date.now() >= openRouterBlockedUntil) {
        try {
            return await parseTransactionWithOpenRouter({ text: normalizedText, timeZone });
        } catch (error) {
            logOpenRouterError("Telegram parser error", error);
            if (isOpenRouterRateLimitError(error)) {
                openRouterBlockedUntil = Date.now() + Math.max(getOpenRouterRetryDelayMs(error), TELEGRAM_PARSER_OPENROUTER_COOLDOWN_MS);
            }
        }
    }

    return buildUnclearResult("I'm having trouble processing transactions right now. Please try again later.");
};

module.exports = {
    ALLOWED_CATEGORIES,
    parseTelegramTransactionMessage,
};
