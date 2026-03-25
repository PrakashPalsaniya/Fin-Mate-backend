const User = require("../models/User.js");
const { normalizeSummaryRange } = require("../services/financialSummaryService.js");
const {
    deliverSummary,
    getSummaryDeliveryHistory,
    SUMMARY_CHANNELS,
    sanitizeSummaryDeliveryError,
} = require("../services/summaryDeliveryService.js");

const normalizeChannels = (value) => {
    const rawChannels = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(",")
            : [];

    return rawChannels
        .map((channel) => String(channel || "").trim().toLowerCase())
        .filter((channel, index, channels) =>
            SUMMARY_CHANNELS.includes(channel) && channels.indexOf(channel) === index
        );
};

exports.sendSummaryNow = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password").lean();

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const frequency = normalizeSummaryRange(req.body?.frequency || "daily");
        const channels = normalizeChannels(req.body?.channels);
        const result = await deliverSummary({
            user,
            frequency,
            source: "manual",
            requestedChannels: channels,
            now: new Date(),
        });

        return res.status(200).json({
            message: `${frequency} summary processed`,
            ...result,
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.message || "Failed to send summary",
        });
    }
};

exports.getSummaryHistory = async (req, res) => {
    try {
        const parsedLimit = Number(req.query.limit || 10);
        const history = await getSummaryDeliveryHistory({
            userId: req.user.id,
            limit:
                Number.isInteger(parsedLimit) && parsedLimit > 0
                    ? Math.min(parsedLimit, 25)
                    : 10,
        });

        return res.status(200).json({
            history: history.map((item) => ({
                ...item,
                lastError: item.lastError
                    ? sanitizeSummaryDeliveryError({
                        channel: item.channel,
                        rawMessage: item.lastError,
                    })
                    : null,
            })),
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to load summary delivery history",
            error: error.message,
        });
    }
};
