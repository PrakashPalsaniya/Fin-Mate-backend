const crypto = require("crypto");
const redis = require("../../../shared/config/redis.js");
const {
    getTelegramPendingIntentTtlSeconds,
    getTelegramProcessedUpdateTtlSeconds,
} = require("./telegramConfig.js");

const buildPendingIntentKey = (token) => `telegram:intent:${token}`;
const buildProcessedUpdateKey = (updateId) => `telegram:update:${updateId}`;
const buildUpdateResponseKey = (updateId) => `telegram:update-response:${updateId}`;

const createIntentToken = () => crypto.randomBytes(10).toString("hex");

const savePendingTransactionIntent = async (payload) => {
    const token = createIntentToken();
    const pendingIntentTtlSeconds = getTelegramPendingIntentTtlSeconds();

    await redis.setEx(
        buildPendingIntentKey(token),
        pendingIntentTtlSeconds,
        JSON.stringify({
            ...payload,
            createdAt: new Date().toISOString(),
        })
    );

    return {
        token,
        expiresInSeconds: pendingIntentTtlSeconds,
    };
};

const getPendingTransactionIntent = async (token) => {
    const storedPayload = await redis.get(buildPendingIntentKey(token));
    return storedPayload ? JSON.parse(storedPayload) : null;
};

const deletePendingTransactionIntent = async (token) =>
    redis.del(buildPendingIntentKey(token));

const isTelegramUpdateProcessed = async (updateId) => {
    if (updateId === undefined || updateId === null) {
        return false;
    }

    const value = await redis.get(buildProcessedUpdateKey(updateId));
    return Boolean(value);
};

const markTelegramUpdateProcessed = async (updateId) => {
    if (updateId === undefined || updateId === null) {
        return;
    }

    const processedUpdateTtlSeconds = getTelegramProcessedUpdateTtlSeconds();

    await redis.setEx(
        buildProcessedUpdateKey(updateId),
        processedUpdateTtlSeconds,
        "1"
    );
};

const getTelegramUpdateResponse = async (updateId) => {
    if (updateId === undefined || updateId === null) {
        return null;
    }

    const storedPayload = await redis.get(buildUpdateResponseKey(updateId));
    return storedPayload ? JSON.parse(storedPayload) : null;
};

const saveTelegramUpdateResponse = async (updateId, payload) => {
    if (updateId === undefined || updateId === null || !payload) {
        return;
    }

    const processedUpdateTtlSeconds = getTelegramProcessedUpdateTtlSeconds();

    await redis.setEx(
        buildUpdateResponseKey(updateId),
        processedUpdateTtlSeconds,
        JSON.stringify({
            ...payload,
            createdAt: new Date().toISOString(),
        })
    );
};

module.exports = {
    deletePendingTransactionIntent,
    getPendingTransactionIntent,
    getTelegramUpdateResponse,
    isTelegramUpdateProcessed,
    markTelegramUpdateProcessed,
    savePendingTransactionIntent,
    saveTelegramUpdateResponse,
};
