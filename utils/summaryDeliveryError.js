const getRawSummaryDeliveryError = (error) =>
    String(
        error?.response?.data?.message ||
        error?.response?.data?.error?.message ||
        error?.message ||
        error ||
        "Unknown summary delivery error"
    ).trim();

const getSummaryDeliveryStatusCode = (error) =>
    Number(error?.status || error?.response?.status || 0);

const isNetworkDeliveryError = (error) => {
    const rawMessage = getRawSummaryDeliveryError(error);
    const errorCode = String(error?.code || "").trim().toUpperCase();

    return (
        ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(errorCode) ||
        /ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|socket hang up|Network Error|timeout/i.test(rawMessage)
    );
};

const sanitizeSummaryDeliveryError = ({ channel, error, rawMessage }) => {
    const normalizedChannel = String(channel || "").trim().toLowerCase();
    const message = String(rawMessage || getRawSummaryDeliveryError(error)).trim();
    const statusCode = getSummaryDeliveryStatusCode(error);

    if (normalizedChannel === "email") {
        if (/BREVO_API_KEY/i.test(message)) {
            return "Email summary is unavailable right now. Please try again later.";
        }

        if (/BREVO_SENDER_EMAIL/i.test(message) || /sender/i.test(message)) {
            return "Email summary is unavailable right now. Please try again later.";
        }

        if (statusCode === 401 || /401|unauthorized/i.test(message)) {
            return "Email summary is unavailable right now. Please try again later.";
        }

        if (statusCode === 403) {
            return "Email summary is unavailable right now. Please try again later.";
        }

        if (isNetworkDeliveryError(error || message)) {
            return "Email summary could not be delivered right now. Please try again later.";
        }

        return "Email summary failed. Please try again later.";
    }

    if (normalizedChannel === "telegram") {
        if (/Telegram bot is not configured|TELEGRAM_BOT_TOKEN/i.test(message)) {
            return "Telegram summary is unavailable right now. Please try again later.";
        }

        if (statusCode === 401 || statusCode === 404 || /401|404|unauthorized/i.test(message)) {
            return "Telegram summary is unavailable right now. Please try again later.";
        }

        if (/message is too long/i.test(message)) {
            return "Telegram summary could not be delivered right now. Please try again later.";
        }

        if (isNetworkDeliveryError(error || message)) {
            return "Telegram summary could not be delivered right now. Please try again later.";
        }

        return "Telegram summary failed. Please try again later.";
    }

    if (isNetworkDeliveryError(error || message)) {
        return "Delivery could not be completed right now. Please try again later.";
    }

    return "Delivery failed. Please try again later.";
};

module.exports = {
    getRawSummaryDeliveryError,
    getSummaryDeliveryStatusCode,
    isNetworkDeliveryError,
    sanitizeSummaryDeliveryError,
};
