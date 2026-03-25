const crypto = require("crypto");
const redis = require("../../config/redis.js");
const User = require("../../models/User.js");
const { serializeTelegramAccount } = require("../../utils/serializeTelegramAccount.js");
const {
    assertTelegramConfigured,
    buildTelegramDeepLink,
    getTelegramLinkCodeTtlSeconds,
    getTelegramPublicConfig,
} = require("./telegramConfig.js");

const buildLinkCodeKey = (code) => `telegram:link:${code}`;

const normalizeTelegramChat = (chat = {}) => ({
    chatId: String(chat.id || "").trim(),
    username: chat.username ? String(chat.username).trim() : null,
    firstName: chat.first_name ? String(chat.first_name).trim() : null,
    lastName: chat.last_name ? String(chat.last_name).trim() : null,
});

const generateTelegramLinkSession = async ({ userId }) => {
    assertTelegramConfigured();

    if (!userId) {
        const error = new Error("User ID is required");
        error.status = 400;
        throw error;
    }

    const code = crypto.randomBytes(16).toString("hex");
    const now = new Date();
    const linkCodeTtlSeconds = getTelegramLinkCodeTtlSeconds();
    const expiresAt = new Date(now.getTime() + linkCodeTtlSeconds * 1000);

    await redis.setEx(
        buildLinkCodeKey(code),
        linkCodeTtlSeconds,
        JSON.stringify({
            userId: String(userId),
            createdAt: now.toISOString(),
        })
    );

    return {
        code,
        deepLink: buildTelegramDeepLink(code),
        manualCommand: `/start ${code}`,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: linkCodeTtlSeconds,
        bot: getTelegramPublicConfig(),
    };
};

const consumeTelegramLinkCode = async (code) => {
    const normalizedCode = String(code || "").trim();

    if (!normalizedCode) {
        return null;
    }

    const key = buildLinkCodeKey(normalizedCode);
    const storedPayload = await redis.get(key);

    if (!storedPayload) {
        return null;
    }

    await redis.del(key);

    return JSON.parse(storedPayload);
};

const findUserByTelegramChatId = async (chatId) =>
    User.findOne({ "telegram.chatId": String(chatId || "").trim() });

const linkTelegramChat = async ({ userId, chat }) => {
    const normalizedChat = normalizeTelegramChat(chat);

    if (!normalizedChat.chatId) {
        const error = new Error("Telegram chat ID is required");
        error.status = 400;
        throw error;
    }

    const user = await User.findById(userId);
    if (!user) {
        const error = new Error("User not found");
        error.status = 404;
        throw error;
    }

    const conflictingUser = await User.findOne({
        "telegram.chatId": normalizedChat.chatId,
        _id: { $ne: user._id },
    });

    if (conflictingUser) {
        const error = new Error(
            "This Telegram chat is already linked to another account. Unlink it first before reconnecting."
        );
        error.status = 409;
        throw error;
    }

    const now = new Date();
    const previousChatId = String(user.telegram?.chatId || "").trim();

    user.telegram = {
        chatId: normalizedChat.chatId,
        username: normalizedChat.username,
        firstName: normalizedChat.firstName,
        lastName: normalizedChat.lastName,
        linkedAt:
            previousChatId && previousChatId === normalizedChat.chatId && user.telegram?.linkedAt
                ? user.telegram.linkedAt
                : now,
        lastInteractionAt: now,
    };

    await user.save();
    return user;
};

const unlinkTelegramChat = async ({ userId }) => {
    const user = await User.findByIdAndUpdate(
        userId,
        {
            $unset: {
                telegram: 1,
            },
        },
        {
            new: true,
        }
    );

    if (!user) {
        const error = new Error("User not found");
        error.status = 404;
        throw error;
    }

    return user;
};

const touchTelegramInteraction = async ({ chatId, chat }) => {
    const normalizedChatId = String(chatId || chat?.id || "").trim();

    if (!normalizedChatId) {
        return null;
    }

    const updates = {
        "telegram.lastInteractionAt": new Date(),
    };

    if (chat?.username) {
        updates["telegram.username"] = String(chat.username).trim();
    }

    if (chat?.first_name) {
        updates["telegram.firstName"] = String(chat.first_name).trim();
    }

    if (chat?.last_name) {
        updates["telegram.lastName"] = String(chat.last_name).trim();
    }

    return User.findOneAndUpdate(
        { "telegram.chatId": normalizedChatId },
        { $set: updates },
        { new: true }
    );
};

const buildTelegramStatus = (user) => ({
    bot: getTelegramPublicConfig(),
    telegram: {
        linked: Boolean(user?.telegram?.chatId),
        account: serializeTelegramAccount(user?.telegram),
    },
});

module.exports = {
    buildTelegramStatus,
    consumeTelegramLinkCode,
    findUserByTelegramChatId,
    generateTelegramLinkSession,
    linkTelegramChat,
    touchTelegramInteraction,
    unlinkTelegramChat,
};
