const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * The set of intents that map to instant DB lookups.
 * Anything outside this set goes to the AI assistant.
 */
const DIRECT_INTENTS = new Set([
    "expense_total",
    "income_total",
    "balance",
    "savings_rate",
    "top_expense",
    "budget_status",
    "recent_transactions",
]);

const ALL_INTENT_LABELS = [
    ...DIRECT_INTENTS,
    "advice",
];

/**
 * Builds a short 1-2 line context snippet from chat history
 * so the classifier can resolve follow-up messages correctly.
 */
function buildContextSnippet(history = []) {
    if (!history.length) return "";

    const lastTurns = history.slice(-2);
    return lastTurns
        .map((turn) => `User: ${turn.userMessage}\nBot: ${turn.assistantReply}`)
        .join("\n");
}

/**
 * Uses Gemini to classify a user message into one intent label.
 * Falls back to null on any error so the caller can use regex as safety net.
 *
 * @param {string} message - Normalised user message
 * @param {Array}  history - Recent chat history turns
 * @returns {Promise<string|null>} - One of ALL_INTENT_LABELS, or null on failure
 */
async function classifyIntent(message, history = []) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        });

        const contextSnippet = buildContextSnippet(history);

        const prompt = `You are a financial chat intent classifier. Your job is to classify a user message into exactly one intent label.

INTENT LABELS and when to use them:
- expense_total    → User asking HOW MUCH they spent (e.g. "how much did I spend", "what did I spend on food")
- income_total     → User asking HOW MUCH they earned (e.g. "how much income", "what did I earn")
- balance          → User asking about net balance, leftover money, surplus/deficit (e.g. "what is my balance", "how much is left")
- savings_rate     → User asking about savings percentage or rate (e.g. "what is my savings rate", "what percent do I save")
- top_expense      → User asking WHICH category they spend most on (e.g. "biggest expense", "where do I spend the most")
- budget_status    → User checking CURRENT budget status — are they over/under, how much is remaining (e.g. "am I over budget", "how much budget is left")
- recent_transactions → User asking to SEE recent or latest transactions (e.g. "show my latest transactions", "what did I buy recently")
- advice           → User asking for TIPS, RECOMMENDATIONS, IDEAS, PLANS, or HOW TO DO SOMETHING — always use this for anything requesting suggestions or coaching (e.g. "how can I save more", "give me budget ideas", "how much should I set for rent", "what should I do", "can you help me plan")

CRITICAL RULE: If the user is asking for IDEAS, PLANS, RECOMMENDATIONS, or "how much should I..." → always use "advice".
CRITICAL RULE: "budget status" = checking existing budget → budget_status. "budget ideas/plans/suggestions" = asking for advice → advice.
${contextSnippet ? `\nRecent conversation:\n${contextSnippet}\n` : ""}
User message: "${message}"

Reply with ONLY the single intent label. No explanation. No punctuation. No quotes.`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,      // Fully deterministic
                topK: 1,             // Greedy decoding
                maxOutputTokens: 8,  // Just the label word
            },
        });

        const raw = result.response.text().trim().toLowerCase().replace(/[^a-z_]/g, "");

        // Exact match
        if (ALL_INTENT_LABELS.includes(raw)) {
            return raw;
        }

        // Partial match fallback (handles whitespace or minor hallucination)
        const partial = ALL_INTENT_LABELS.find((label) => raw.includes(label));
        if (partial) {
            return partial;
        }

        // If Gemini hallucinated something unknown, default to advice
        // so it reaches the AI assistant rather than returning a wrong DB answer
        console.warn(`[IntentClassifier] Unrecognised label "${raw}", defaulting to advice`);
        return "advice";
    } catch (err) {
        // On any error (quota, network, etc.) return null so the caller
        // can fall back to the existing regex-based classifier
        console.error("[IntentClassifier] LLM classification failed, falling back to regex:", err.message);
        return null;
    }
}

module.exports = { classifyIntent, DIRECT_INTENTS };
