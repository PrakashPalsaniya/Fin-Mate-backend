const maskChatId = (chatId) => {
    const normalizedChatId = String(chatId || "").trim();

    if (!normalizedChatId) {
        return null;
    }

    if (normalizedChatId.length <= 4) {
        return normalizedChatId;
    }

    return `...${normalizedChatId.slice(-4)}`;
};

const serializeTelegramAccount = (telegram = {}) => {
    const chatId = String(telegram.chatId || "").trim();

    if (!chatId) {
        return null;
    }

    const nameParts = [telegram.firstName, telegram.lastName]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    return {
        chatId,
        maskedChatId: maskChatId(chatId),
        username: telegram.username || null,
        firstName: telegram.firstName || null,
        lastName: telegram.lastName || null,
        displayName: nameParts.join(" ") || telegram.username || "Telegram user",
        linkedAt: telegram.linkedAt || null,
        lastInteractionAt: telegram.lastInteractionAt || null,
    };
};

module.exports = {
    maskChatId,
    serializeTelegramAccount,
};
