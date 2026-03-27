const User = require("../models/User.js");
const { serializeUser } = require("../utils/serializeUser.js");
const { createTransaction, TransactionServiceError } = require("../services/transactionService.js");
const {
    getFinancialSummary,
    normalizeSummaryRange,
} = require("../services/financialSummaryService.js");
const {
    getTelegramPublicConfig,
    isTelegramSecretValid,
    isTelegramWebhookSecretConfigured,
} = require("../services/telegram/telegramConfig.js");
const {
    answerCallbackQuery,
    editMessageText,
    getTelegramApiErrorDetails,
    sendMessage,
} = require("../services/telegram/telegramApi.js");
const {
    buildTelegramStatus,
    consumeTelegramLinkCode,
    findUserByTelegramChatId,
    generateTelegramLinkSession,
    linkTelegramChat,
    touchTelegramInteraction,
    unlinkTelegramChat,
} = require("../services/telegram/telegramLinkService.js");
const {
    deletePendingTransactionIntent,
    getPendingTransactionIntent,
    getTelegramUpdateResponse,
    isTelegramUpdateProcessed,
    markTelegramUpdateProcessed,
    savePendingTransactionIntent,
    saveTelegramUpdateResponse,
} = require("../services/telegram/telegramIntentService.js");
const { parseTelegramTransactionMessage } = require("../services/telegram/telegramParserService.js");
const {
    buildConfirmTransactionKeyboard,
    buildExpiredIntentMessage,
    buildHelpMessage,
    buildLinkedStartMessage,
    buildLinkRequiredMessage,
    buildLinkSuccessMessage,
    buildStatusMessage,
    buildSummaryMessage,
    buildTransactionCancelledMessage,
    buildTransactionPreviewMessage,
    buildTransactionSavedMessage,
} = require("../services/telegram/telegramMessageService.js");

const getErrorStatus = (error, fallback = 500) => error.status || fallback;

const getFreshUser = async (userId) => User.findById(userId).select("-password");

const getTelegramStatus = async (req, res) => {
    try {
        const user = await getFreshUser(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({
            ...buildTelegramStatus(user),
            user: serializeUser(user),
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to load Telegram status",
            error: error.message,
        });
    }
};

const startTelegramLink = async (req, res) => {
    try {
        const user = await getFreshUser(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const linkSession = await generateTelegramLinkSession({
            userId: user._id,
        });

        return res.status(200).json({
            message: "Telegram link code generated",
            ...buildTelegramStatus(user),
            linkSession,
            user: serializeUser(user),
        });
    } catch (error) {
        return res.status(getErrorStatus(error, 500)).json({
            message: error.message || "Failed to generate Telegram link",
        });
    }
};

const unlinkTelegram = async (req, res) => {
    try {
        const user = await unlinkTelegramChat({ userId: req.user.id });

        return res.status(200).json({
            message: "Telegram account unlinked successfully",
            ...buildTelegramStatus(user),
            user: serializeUser(user),
        });
    } catch (error) {
        return res.status(getErrorStatus(error, 500)).json({
            message: error.message || "Failed to unlink Telegram account",
        });
    }
};

const parseCommand = (text = "") => {
    const [rawCommand = "", ...args] = String(text || "").trim().split(/\s+/);
    const command = rawCommand.replace(/^\/+/, "").split("@")[0].toLowerCase();
    return { command, args };
};

const sendChatMessage = async (chatId, text, replyMarkup, updateId) => {
    if (updateId !== undefined && updateId !== null) {
        await saveTelegramUpdateResponse(updateId, {
            text,
            ...(replyMarkup ? { replyMarkup } : {}),
        });
    }

    return sendMessage({
        chatId,
        text,
        replyMarkup,
    });
};

const getBotDeepLink = () => {
    const botConfig = getTelegramPublicConfig();
    return botConfig.username ? `https://t.me/${botConfig.username}` : null;
};

const handleStartCommand = async (message, args, user, updateId) => {
    const chatId = String(message.chat?.id || "");

    if (!args[0]) {
        if (user) {
            return sendChatMessage(
                chatId,
                buildLinkedStartMessage({
                    account: buildTelegramStatus(user).telegram.account,
                    botUsername: getTelegramPublicConfig().username,
                }),
                undefined,
                updateId
            );
        }

        return sendChatMessage(
            chatId,
            buildLinkRequiredMessage({
                deepLink: getBotDeepLink(),
            }),
            undefined,
            updateId
        );
    }

    const linkRequest = await consumeTelegramLinkCode(args[0]);
    if (!linkRequest?.userId) {
        return sendChatMessage(
            chatId,
            "That link code is invalid or has expired. Generate a fresh one from Settings in the app.",
            undefined,
            updateId
        );
    }

    try {
        const user = await linkTelegramChat({
            userId: linkRequest.userId,
            chat: message.from || message.chat,
        });

        return sendChatMessage(
            chatId,
            buildLinkSuccessMessage({
                fullName: user.fullName,
            }),
            undefined,
            updateId
        );
    } catch (error) {
        return sendChatMessage(
            chatId,
            error.message || "Could not link this Telegram chat right now.",
            undefined,
            updateId
        );
    }
};

const handleSummaryCommand = async (message, args, user, updateId) => {
    const summary = await getFinancialSummary({
        userId: user._id,
        range: args[0] || "monthly",
    });

    return sendChatMessage(
        message.chat.id,
        buildSummaryMessage({
            ...summary,
            range: normalizeSummaryRange(args[0] || "monthly"),
        }),
        undefined,
        updateId
    );
};

const handleStatusCommand = async (message, user, updateId) =>
    sendChatMessage(
        message.chat.id,
        buildStatusMessage({
            account: buildTelegramStatus(user).telegram.account,
            bot: getTelegramPublicConfig(),
        }),
        undefined,
        updateId
    );

const handleTelegramCommand = async (message, user, updateId) => {
    const { command, args } = parseCommand(message.text);

    if (command === "start") {
        return handleStartCommand(message, args, user, updateId);
    }

    if (!user) {
        return sendChatMessage(
            message.chat.id,
            buildLinkRequiredMessage({
                deepLink: getBotDeepLink(),
            }),
            undefined,
            updateId
        );
    }

    if (command === "help") {
        return sendChatMessage(
            message.chat.id,
            buildHelpMessage({ botUsername: getTelegramPublicConfig().username }),
            undefined,
            updateId
        );
    }

    if (command === "summary") {
        return handleSummaryCommand(message, args, user, updateId);
    }

    if (command === "status") {
        return handleStatusCommand(message, user, updateId);
    }

    return sendChatMessage(
        message.chat.id,
        buildHelpMessage({ botUsername: getTelegramPublicConfig().username }),
        undefined,
        updateId
    );
};

const handleTelegramTextMessage = async (message, updateId) => {
    const chatId = String(message.chat?.id || "");
    const text = String(message.text || "").trim();
    const cachedResponse = await getTelegramUpdateResponse(updateId);

    if (cachedResponse?.text) {
        return sendChatMessage(chatId, cachedResponse.text, cachedResponse.replyMarkup);
    }

    const linkedUser = await findUserByTelegramChatId(chatId);

    if (text.startsWith("/")) {
        return handleTelegramCommand(message, linkedUser, updateId);
    }

    if (!linkedUser) {
        const replyText = buildLinkRequiredMessage({
            deepLink: getBotDeepLink(),
        });

        await saveTelegramUpdateResponse(updateId, {
            text: replyText,
        });

        return sendChatMessage(chatId, replyText);
    }

    await touchTelegramInteraction({
        chatId,
        chat: message.from || message.chat,
    });

    const parsed = await parseTelegramTransactionMessage({
        text,
        timeZone: linkedUser.settings?.timezone || "Asia/Kolkata",
    });

    if (parsed.status !== "ready") {
        await saveTelegramUpdateResponse(updateId, {
            text: parsed.reply,
        });

        return sendChatMessage(chatId, parsed.reply);
    }

    const pendingIntent = await savePendingTransactionIntent({
        userId: String(linkedUser._id),
        chatId,
        draft: parsed.draft,
    });

    const previewText = buildTransactionPreviewMessage(parsed.draft);
    const replyMarkup = buildConfirmTransactionKeyboard(pendingIntent.token);

    await saveTelegramUpdateResponse(updateId, {
        text: previewText,
        replyMarkup,
    });

    return sendChatMessage(
        chatId,
        previewText,
        replyMarkup
    );
};

const parseCallbackAction = (data = "") => {
    const parts = String(data || "").split(":");

    if (parts.length !== 3 || parts[0] !== "tx") {
        return null;
    }

    return {
        action: parts[1],
        token: parts[2],
    };
};

const safeEditTelegramMessage = async ({ chatId, messageId, text }) => {
    try {
        await editMessageText({
            chatId,
            messageId,
            text,
        });
    } catch (error) {
        if (!String(error?.response?.data?.description || "").includes("message is not modified")) {
            throw error;
        }
    }
};

const handleTelegramCallbackQuery = async (callbackQuery) => {
    const actionData = parseCallbackAction(callbackQuery.data);
    const chatId = String(callbackQuery.message?.chat?.id || "");
    const messageId = callbackQuery.message?.message_id;

    if (!actionData) {
        return answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Unsupported action.",
            showAlert: false,
        });
    }

    const pendingIntent = await getPendingTransactionIntent(actionData.token);

    if (!pendingIntent) {
        await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "This draft has expired.",
            showAlert: false,
        });

        return safeEditTelegramMessage({
            chatId,
            messageId,
            text: buildExpiredIntentMessage(),
        });
    }

    if (String(pendingIntent.chatId) !== chatId) {
        return answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "This action belongs to a different chat.",
            showAlert: true,
        });
    }

    if (actionData.action === "cancel") {
        await deletePendingTransactionIntent(actionData.token);
        await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Draft cancelled",
            showAlert: false,
        });

        return safeEditTelegramMessage({
            chatId,
            messageId,
            text: buildTransactionCancelledMessage(),
        });
    }

    if (actionData.action !== "confirm") {
        return answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Unsupported action.",
            showAlert: false,
        });
    }

    try {
        const transaction = await createTransaction({
            transactionType: pendingIntent.draft.type,
            userId: pendingIntent.userId,
            payload: pendingIntent.draft,
        });

        await deletePendingTransactionIntent(actionData.token);
        await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: "Transaction saved",
            showAlert: false,
        });

        return safeEditTelegramMessage({
            chatId,
            messageId,
            text: buildTransactionSavedMessage(transaction, pendingIntent.draft.type),
        });
    } catch (error) {
        const message =
            error instanceof TransactionServiceError
                ? error.message
                : "Failed to save this transaction.";

        await answerCallbackQuery({
            callbackQueryId: callbackQuery.id,
            text: message,
            showAlert: true,
        });

        return safeEditTelegramMessage({
            chatId,
            messageId,
            text: `Could not save this transaction.\n\n${message}`,
        });
    }
};

const handleTelegramWebhook = async (req, res) => {
    const incomingSecret = req.get("x-telegram-bot-api-secret-token");

    if (!isTelegramWebhookSecretConfigured()) {
        return res.status(503).json({
            message: "Telegram webhook secret is not configured",
        });
    }

    if (!isTelegramSecretValid(incomingSecret)) {
        return res.status(401).json({ message: "Invalid Telegram secret" });
    }

    const update = req.body || {};

    try {
        if (await isTelegramUpdateProcessed(update.update_id)) {
            return res.status(200).json({ ok: true, duplicate: true });
        }

        if (update.callback_query) {
            await handleTelegramCallbackQuery(update.callback_query);
        } else if (update.message?.text) {
            await handleTelegramTextMessage(update.message, update.update_id);
        } else if (update.message?.chat?.id) {
            await sendChatMessage(
                update.message.chat.id,
                "Text messages are supported right now. Try something like 'Spent 420 on groceries today'."
            );
        }

        await markTelegramUpdateProcessed(update.update_id);

        return res.status(200).json({ ok: true });
    } catch (error) {
        const errorDetails = getTelegramApiErrorDetails(error);
        console.error("Telegram webhook error:", {
            code: errorDetails.code,
            statusCode: errorDetails.statusCode,
            retryable: errorDetails.retryable,
            message: errorDetails.description,
        });

        return res.status(500).json({
            message: "Failed to process Telegram update",
        });
    }
};

module.exports = {
    getTelegramStatus,
    handleTelegramWebhook,
    startTelegramLink,
    unlinkTelegram,
};
