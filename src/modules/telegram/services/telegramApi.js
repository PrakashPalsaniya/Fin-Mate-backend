const axios = require("axios");
const https = require("https");
const {
    assertTelegramConfigured,
    getTelegramBotApiBaseUrl,
    getTelegramWebhookSecret,
} = require("./telegramConfig.js");

const TELEGRAM_HTTPS_AGENT = new https.Agent({
    keepAlive: false,
});

const sleep = (durationMs) =>
    new Promise((resolve) => setTimeout(resolve, durationMs));

const isRetryableTelegramError = (error) => {
    const errorCode = String(error?.code || "").trim().toUpperCase();
    const rawMessage = String(
        error?.response?.data?.description ||
        error?.response?.data?.message ||
        error?.message ||
        ""
    ).trim();

    return (
        ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(errorCode) ||
        /ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|socket hang up|Network Error|timeout/i.test(rawMessage)
    );
};

const getTelegramApiErrorDetails = (error) => ({
    statusCode: Number(error?.response?.status || error?.status || 0) || null,
    code: String(error?.code || "").trim().toUpperCase() || null,
    description: String(
        error?.response?.data?.description ||
        error?.response?.data?.message ||
        error?.message ||
        "Telegram API request failed"
    ).trim(),
    retryable: isRetryableTelegramError(error),
});

const createTelegramApiError = (error) => {
    const details = getTelegramApiErrorDetails(error);
    const normalizedError = new Error(details.description);

    normalizedError.name = "TelegramApiError";
    normalizedError.status = details.statusCode || 502;
    normalizedError.code = details.code;
    normalizedError.retryable = details.retryable;
    normalizedError.details = details;

    return normalizedError;
};

const callTelegramApi = async (method, payload = {}) => {
    assertTelegramConfigured();

    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await axios.post(`${getTelegramBotApiBaseUrl()}/${method}`, payload, {
                headers: {
                    "Content-Type": "application/json",
                },
                timeout: 12000,
                httpsAgent: TELEGRAM_HTTPS_AGENT,
            });

            return response.data?.result;
        } catch (error) {
            lastError = error;

            if (!isRetryableTelegramError(error) || attempt === 2) {
                throw createTelegramApiError(error);
            }

            await sleep(400 * (attempt + 1));
        }
    }

    throw createTelegramApiError(lastError);
};

const sendMessage = async ({ chatId, text, replyMarkup, disableWebPagePreview = true }) =>
    callTelegramApi("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: disableWebPagePreview,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });

const editMessageText = async ({ chatId, messageId, text, replyMarkup, disableWebPagePreview = true }) =>
    callTelegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: disableWebPagePreview,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });

const answerCallbackQuery = async ({ callbackQueryId, text, showAlert = false }) =>
    callTelegramApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
        show_alert: showAlert,
    });

const setWebhook = async ({ url, secretToken = getTelegramWebhookSecret() }) =>
    callTelegramApi("setWebhook", {
        url,
        ...(secretToken ? { secret_token: secretToken } : {}),
        allowed_updates: ["message", "callback_query"],
    });

const getWebhookInfo = async () => callTelegramApi("getWebhookInfo");

module.exports = {
    answerCallbackQuery,
    editMessageText,
    getWebhookInfo,
    getTelegramApiErrorDetails,
    sendMessage,
    setWebhook,
};
