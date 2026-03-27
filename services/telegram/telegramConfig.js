const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");

const TELEGRAM_ENV_PATH = path.resolve(__dirname, "..", "..", ".env");

const normalizeString = (value = "") => String(value || "").trim();
const normalizePositiveInteger = (value, fallback) => {
    const parsedValue = Number(value);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const loadTelegramEnv = () => {
    dotenv.config({
        path: TELEGRAM_ENV_PATH,
        override: true,
        quiet: true,
    });
};

const getTelegramEnv = () => {
    loadTelegramEnv();

    return {
        botToken: normalizeString(process.env.TELEGRAM_BOT_TOKEN),
        botUsername: normalizeString(process.env.TELEGRAM_BOT_USERNAME).replace(/^@/, ""),
        webhookUrl: normalizeString(process.env.TELEGRAM_WEBHOOK_URL),
        webhookSecret: normalizeString(process.env.TELEGRAM_WEBHOOK_SECRET),
        linkCodeTtlSeconds: normalizePositiveInteger(
            process.env.TELEGRAM_LINK_CODE_TTL_SECONDS,
            600
        ),
        pendingIntentTtlSeconds: normalizePositiveInteger(
            process.env.TELEGRAM_PENDING_INTENT_TTL_SECONDS,
            900
        ),
        processedUpdateTtlSeconds: normalizePositiveInteger(
            process.env.TELEGRAM_PROCESSED_UPDATE_TTL_SECONDS,
            86400
        ),
    };
};

const getTelegramBotToken = () => getTelegramEnv().botToken;
const getTelegramBotUsername = () => getTelegramEnv().botUsername;
const getTelegramWebhookUrl = () => getTelegramEnv().webhookUrl;
const getTelegramWebhookSecret = () => getTelegramEnv().webhookSecret;
const getTelegramLinkCodeTtlSeconds = () => getTelegramEnv().linkCodeTtlSeconds;
const getTelegramPendingIntentTtlSeconds = () => getTelegramEnv().pendingIntentTtlSeconds;
const getTelegramProcessedUpdateTtlSeconds = () => getTelegramEnv().processedUpdateTtlSeconds;
const isTelegramWebhookSecretConfigured = () => Boolean(getTelegramWebhookSecret());

const isTelegramConfigured = () => Boolean(getTelegramBotToken());

const assertTelegramConfigured = () => {
    if (!isTelegramConfigured()) {
        const error = new Error(
            "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN to backend/.env."
        );
        error.status = 503;
        throw error;
    }
};

const getTelegramBotApiBaseUrl = () => {
    assertTelegramConfigured();
    return `https://api.telegram.org/bot${getTelegramBotToken()}`;
};

const buildTelegramDeepLink = (code = "") => {
    const botUsername = getTelegramBotUsername();
    if (!botUsername) {
        return null;
    }

    const normalizedCode = normalizeString(code);
    return normalizedCode
        ? `https://t.me/${botUsername}?start=${encodeURIComponent(normalizedCode)}`
        : `https://t.me/${botUsername}`;
};

const getTelegramPublicConfig = () => {
    const env = getTelegramEnv();

    return {
        configured: Boolean(env.botToken),
        username: env.botUsername || null,
        canGenerateDeepLink: Boolean(env.botUsername),
        webhookConfigured: Boolean(env.webhookUrl),
        webhookUrl: env.webhookUrl || null,
    };
};

const isTelegramSecretValid = (incomingSecret) => {
    const webhookSecret = getTelegramWebhookSecret();

    if (!webhookSecret) {
        return false;
    }

    const expectedBuffer = Buffer.from(webhookSecret);
    const actualBuffer = Buffer.from(normalizeString(incomingSecret));

    if (expectedBuffer.length !== actualBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

module.exports = {
    assertTelegramConfigured,
    buildTelegramDeepLink,
    getTelegramBotApiBaseUrl,
    getTelegramBotToken,
    getTelegramBotUsername,
    getTelegramEnv,
    getTelegramLinkCodeTtlSeconds,
    getTelegramPendingIntentTtlSeconds,
    getTelegramProcessedUpdateTtlSeconds,
    getTelegramPublicConfig,
    getTelegramWebhookSecret,
    getTelegramWebhookUrl,
    isTelegramConfigured,
    isTelegramWebhookSecretConfigured,
    isTelegramSecretValid,
    loadTelegramEnv,
};
