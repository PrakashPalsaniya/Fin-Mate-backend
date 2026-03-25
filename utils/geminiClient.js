const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_GEMINI_RETRY_DELAY_MS = 60 * 1000;

const getGeminiUrl = () => {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
};

const getGeminiErrorStatus = (error) => Number(error?.response?.status || 0);

const getGeminiErrorMessage = (error) => {
    return (
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        "Unknown Gemini API error"
    );
};

const isGeminiQuotaError = (error) => {
    const status = getGeminiErrorStatus(error);
    const providerStatus = String(
        error?.response?.data?.error?.status ||
            error?.response?.data?.status ||
            error?.code ||
            ""
    ).toUpperCase();
    const message = getGeminiErrorMessage(error);

    return (
        status === 429 ||
        providerStatus === "RESOURCE_EXHAUSTED" ||
        /quota|resource exhausted|rate limit|too many requests|limit exceeded/i.test(
            message
        )
    );
};

const parseRetryDelayMsFromValue = (value = "") => {
    const normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
        return 0;
    }

    if (/^\d+(?:\.\d+)?s$/i.test(normalizedValue)) {
        return Math.ceil(Number.parseFloat(normalizedValue) * 1000);
    }

    if (/^\d+(?:\.\d+)?ms$/i.test(normalizedValue)) {
        return Math.ceil(Number.parseFloat(normalizedValue));
    }

    return 0;
};

const getGeminiRetryDelayMs = (error) => {
    const retryDelayFromDetails = error?.response?.data?.error?.details
        ?.find((detail) => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo")
        ?.retryDelay;
    const parsedRetryDelayFromDetails = parseRetryDelayMsFromValue(retryDelayFromDetails);

    if (parsedRetryDelayFromDetails > 0) {
        return parsedRetryDelayFromDetails;
    }

    const message = getGeminiErrorMessage(error);
    const retryDelayMatch = String(message || "").match(/Please retry in\s+(\d+(?:\.\d+)?)(ms|s)\.?/i);

    if (!retryDelayMatch) {
        return DEFAULT_GEMINI_RETRY_DELAY_MS;
    }

    const [, amount, unit] = retryDelayMatch;
    const normalizedValue = `${amount}${unit}`;
    return parseRetryDelayMsFromValue(normalizedValue) || DEFAULT_GEMINI_RETRY_DELAY_MS;
};

const logGeminiError = (context, error) => {
    console.error(`${context}:`, getGeminiErrorMessage(error));

    if (error?.response?.data) {
        console.error(`${context} response:`, JSON.stringify(error.response.data));
    }
};

module.exports = {
    GEMINI_API_KEY,
    GEMINI_MODEL,
    getGeminiErrorStatus,
    getGeminiRetryDelayMs,
    getGeminiUrl,
    getGeminiErrorMessage,
    isGeminiQuotaError,
    logGeminiError,
};
