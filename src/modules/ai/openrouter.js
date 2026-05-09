const DEFAULT_OPENROUTER_RETRY_DELAY_MS = 60 * 1000;

// Keep a fallback alias so the current backend/.env entry still works immediately.
const OPENROUTER_API_KEY =
    process.env.OPENROUTER_API_KEY ||
    process.env.openroutetapi ||
    process.env.OPEN_ROUTER_API_KEY ||
    "";
const OPENROUTER_BASE_URL = String(
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
)
    .trim()
    .replace(/\/+$/, "");
const OPENROUTER_SITE_URL = String(
    process.env.OPENROUTER_SITE_URL || process.env.CLIENT_URL || ""
).trim();
const OPENROUTER_APP_NAME = String(
    process.env.OPENROUTER_APP_NAME || "FinMate"
).trim();

const getOpenRouterChatCompletionsUrl = () =>
    `${OPENROUTER_BASE_URL}/chat/completions`;

const getOpenRouterModelsUrl = () => `${OPENROUTER_BASE_URL}/models`;

const buildOpenRouterHeaders = () => {
    const headers = {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
    };

    if (OPENROUTER_SITE_URL) {
        headers["HTTP-Referer"] = OPENROUTER_SITE_URL;
    }

    if (OPENROUTER_APP_NAME) {
        headers["X-OpenRouter-Title"] = OPENROUTER_APP_NAME;
        headers["X-Title"] = OPENROUTER_APP_NAME;
    }

    return headers;
};

const getOpenRouterErrorStatus = (error) => Number(error?.response?.status || 0);

const getOpenRouterErrorMessage = (error) =>
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "Unknown OpenRouter API error";

const parseRetryDelayMsFromValue = (value = "") => {
    const normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
        return 0;
    }

    if (/^\d+(?:\.\d+)?$/.test(normalizedValue)) {
        return Math.ceil(Number.parseFloat(normalizedValue) * 1000);
    }

    if (/^\d+(?:\.\d+)?s$/i.test(normalizedValue)) {
        return Math.ceil(Number.parseFloat(normalizedValue) * 1000);
    }

    if (/^\d+(?:\.\d+)?ms$/i.test(normalizedValue)) {
        return Math.ceil(Number.parseFloat(normalizedValue));
    }

    return 0;
};

const getOpenRouterRetryDelayMs = (error) => {
    const retryAfterHeader =
        error?.response?.headers?.["retry-after"] ||
        error?.response?.headers?.["Retry-After"];
    const parsedRetryAfterHeader = parseRetryDelayMsFromValue(retryAfterHeader);

    if (parsedRetryAfterHeader > 0) {
        return parsedRetryAfterHeader;
    }

    const message = getOpenRouterErrorMessage(error);
    const retryDelayMatch = String(message || "").match(
        /retry(?:ing)?(?:\s+after|\s+in)?\s+(\d+(?:\.\d+)?)(ms|s|seconds?)?/i
    );

    if (!retryDelayMatch) {
        return DEFAULT_OPENROUTER_RETRY_DELAY_MS;
    }

    const [, amount, unit = "s"] = retryDelayMatch;
    const normalizedUnit = /^seconds?$/i.test(unit) ? "s" : unit;
    return (
        parseRetryDelayMsFromValue(`${amount}${normalizedUnit}`) ||
        DEFAULT_OPENROUTER_RETRY_DELAY_MS
    );
};

const isOpenRouterRateLimitError = (error) => {
    const status = getOpenRouterErrorStatus(error);
    const message = getOpenRouterErrorMessage(error);

    return (
        status === 402 ||
        status === 429 ||
        /quota|rate limit|too many requests|retry later|insufficient credits|payment required/i.test(
            message
        )
    );
};

const logOpenRouterError = (context, error) => {
    console.error(`${context}:`, getOpenRouterErrorMessage(error));

    if (error?.response?.data) {
        console.error(`${context} response:`, JSON.stringify(error.response.data));
    }
};

module.exports = {
    OPENROUTER_API_KEY,
    buildOpenRouterHeaders,
    getOpenRouterChatCompletionsUrl,
    getOpenRouterErrorStatus,
    getOpenRouterErrorMessage,
    getOpenRouterModelsUrl,
    getOpenRouterRetryDelayMs,
    isOpenRouterRateLimitError,
    logOpenRouterError,
};
