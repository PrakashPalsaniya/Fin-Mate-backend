const SummaryDelivery = require("../models/SummaryDelivery.js");
const { normalizeUserSettings } = require("../utils/userSettings.js");
const { normalizeSummaryRange } = require("./financialSummaryService.js");
const { sendEmail } = require("./emailService.js");
const { sendMessage } = require("./telegram/telegramApi.js");
const {
    buildSummaryEmailContent,
    buildSummarySnapshot,
    buildSummaryTelegramContent,
} = require("./summaryDigestContentService.js");
const { getOrCreateSummaryPayload } = require("./summaryGenerationCacheService.js");
const {
    getWeekStartDateKey,
    getZonedDateParts,
    isLocalTimeAtOrAfter,
} = require("../utils/timezone.js");
const {
    getRawSummaryDeliveryError,
    sanitizeSummaryDeliveryError,
} = require("../utils/summaryDeliveryError.js");

const SUMMARY_CHANNELS = Object.freeze(["telegram", "email"]);
const SUMMARY_FREQUENCIES = Object.freeze(["daily", "weekly", "monthly"]);
const SUMMARY_DELIVERY_RETRY_COOLDOWN_MS = Number(
    process.env.SUMMARY_DELIVERY_RETRY_COOLDOWN_MS || 15 * 60 * 1000
);
const SUMMARY_MANUAL_SEND_DEDUP_SECONDS = Number(
    process.env.SUMMARY_MANUAL_SEND_DEDUP_SECONDS || 5 * 60
);

const isSummaryDeliveryRetryCooldownActive = (deliveryRecord) => {
    const lastAttemptAt = new Date(deliveryRecord?.lastAttemptAt || 0).getTime();

    if (!lastAttemptAt || !Number.isFinite(lastAttemptAt)) {
        return false;
    }

    return Date.now() - lastAttemptAt < SUMMARY_DELIVERY_RETRY_COOLDOWN_MS;
};

const getEligibleSummaryChannels = (user) => {
    const settings = normalizeUserSettings(user?.settings || {});
    const channels = [];

    if (settings.notifications.telegramEnabled !== false && user?.telegram?.chatId) {
        channels.push("telegram");
    }

    if (settings.notifications.emailEnabled && user?.email) {
        channels.push("email");
    }

    return channels;
};

const getScheduledSummaryContexts = (user, now = new Date()) => {
    const settings = normalizeUserSettings(user?.settings || {});
    const timeZone = settings.timezone || "Asia/Kolkata";
    const zonedParts = getZonedDateParts(now, timeZone);
    const scheduledTime = settings.summaries?.dailyTime || "08:00";

    if (!isLocalTimeAtOrAfter(zonedParts, scheduledTime)) {
        return [];
    }

    const contexts = [];

    if (settings.notifications.dailySummary) {
        contexts.push({
            frequency: "daily",
            deliveryKey: `daily:${zonedParts.dateKey}`,
            scheduledDateKey: zonedParts.dateKey,
            timeZone,
        });
    }

    if (
        settings.notifications.weeklySummary &&
        zonedParts.weekday === settings.summaries.weeklyDay
    ) {
        const weekStartDateKey = getWeekStartDateKey(now, timeZone, "monday");

        contexts.push({
            frequency: "weekly",
            deliveryKey: `weekly:${weekStartDateKey}`,
            scheduledDateKey: weekStartDateKey,
            timeZone,
        });
    }

    if (
        settings.notifications.monthlySummary &&
        zonedParts.day === Number(settings.summaries.monthlyDay)
    ) {
        contexts.push({
            frequency: "monthly",
            deliveryKey: `monthly:${zonedParts.monthKey}`,
            scheduledDateKey: zonedParts.monthKey,
            timeZone,
        });
    }

    return contexts;
};

const claimSummaryDelivery = async ({
    userId,
    frequency,
    channel,
    deliveryKey,
    scheduledDateKey = null,
    source = "scheduled",
}) => {
    const query = {
        userId,
        frequency,
        channel,
        deliveryKey,
    };

    const existingDelivery = await SummaryDelivery.findOne(query);

    if (!existingDelivery) {
        try {
            const createdDelivery = await SummaryDelivery.create({
                ...query,
                source,
                scheduledDateKey,
                status: "processing",
                attempts: 1,
                lastAttemptAt: new Date(),
            });

            return {
                claimed: true,
                record: createdDelivery,
            };
        } catch (error) {
            if (error?.code === 11000) {
                return {
                    claimed: false,
                    reason: "duplicate_claim",
                };
            }

            throw error;
        }
    }

    if (existingDelivery.status === "sent" || existingDelivery.status === "processing") {
        return {
            claimed: false,
            reason: existingDelivery.status === "sent" ? "already_sent" : "processing",
            record: existingDelivery,
        };
    }

    if (
        existingDelivery.status === "failed" &&
        source === "scheduled" &&
        isSummaryDeliveryRetryCooldownActive(existingDelivery)
    ) {
        return {
            claimed: false,
            reason: "cooldown",
            record: existingDelivery,
        };
    }

    existingDelivery.status = "processing";
    existingDelivery.attempts = Number(existingDelivery.attempts || 0) + 1;
    existingDelivery.lastAttemptAt = new Date();
    existingDelivery.lastError = null;
    existingDelivery.source = source;
    existingDelivery.scheduledDateKey = scheduledDateKey;
    await existingDelivery.save();

    return {
        claimed: true,
        record: existingDelivery,
    };
};

const markSummaryDeliverySent = async ({ record, summary, providerMessageId = null }) => {
    record.status = "sent";
    record.sentAt = new Date();
    record.lastError = null;
    record.providerMessageId = providerMessageId ? String(providerMessageId) : null;
    record.summarySnapshot = buildSummarySnapshot(summary);
    await record.save();

    return record;
};

const markSummaryDeliveryFailed = async ({ record, error }) => {
    const rawError = getRawSummaryDeliveryError(error);
    console.error(
        `Summary delivery failed (${record.frequency}/${record.channel}/${record.userId}):`,
        rawError
    );

    record.status = "failed";
    record.lastError = sanitizeSummaryDeliveryError({
        channel: record.channel,
        error,
        rawMessage: rawError,
    });
    await record.save();

    return record;
};

const sendSummaryToChannel = async ({ channel, user, frequency, summary, timeZone }) => {
    if (channel === "telegram") {
        const result = await sendMessage({
            chatId: user.telegram.chatId,
            text: buildSummaryTelegramContent({
                user,
                summary,
                frequency,
            }),
        });

        return {
            providerMessageId: result?.message_id ? String(result.message_id) : null,
        };
    }

    if (channel === "email") {
        const emailContent = buildSummaryEmailContent({
            user,
            summary,
            frequency,
            timeZone,
        });

        const result = await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            htmlContent: emailContent.htmlContent,
            textContent: emailContent.textContent,
        });

        return {
            providerMessageId: result?.messageId ? String(result.messageId) : null,
        };
    }

    const error = new Error("Unsupported summary delivery channel");
    error.status = 400;
    throw error;
};

const mapUnclaimedSummaryChannelResult = ({ channel, claimResult }) => ({
    channel,
    status: "skipped",
    reason: claimResult.reason || "already_processed",
});

const buildManualSummaryDeliveryKey = ({ frequency, now }) => {
    const dedupWindowMs = Math.max(1, SUMMARY_MANUAL_SEND_DEDUP_SECONDS) * 1000;
    const dedupBucket = Math.floor(new Date(now).getTime() / dedupWindowMs);

    return `manual:${normalizeSummaryRange(frequency)}:${dedupBucket}`;
};

const deliverSummary = async ({
    user,
    frequency,
    source = "scheduled",
    deliveryKey,
    scheduledDateKey = null,
    requestedChannels,
    now = new Date(),
}) => {
    const normalizedFrequency = normalizeSummaryRange(frequency);
    const settings = normalizeUserSettings(user?.settings || {});
    const timeZone = settings.timezone || "Asia/Kolkata";
    const channels = (Array.isArray(requestedChannels) && requestedChannels.length > 0
        ? requestedChannels
        : getEligibleSummaryChannels(user)
    ).filter((channel) => SUMMARY_CHANNELS.includes(channel));

    if (channels.length === 0) {
        const error = new Error("No eligible summary delivery channels are available for this account.");
        error.status = 400;
        throw error;
    }

    const effectiveDeliveryKey =
        deliveryKey ||
        (source === "manual"
            ? buildManualSummaryDeliveryKey({
                frequency: normalizedFrequency,
                now,
            })
            : `scheduled:${normalizedFrequency}:${now.toISOString()}`);
    const claimResults = [];

    for (const channel of channels) {
        const claimResult = await claimSummaryDelivery({
            userId: user._id,
            frequency: normalizedFrequency,
            channel,
            deliveryKey: effectiveDeliveryKey,
            scheduledDateKey,
            source,
        });

        claimResults.push({
            channel,
            claimResult,
        });
    }

    const claimedResults = claimResults.filter(({ claimResult }) => claimResult.claimed);

    if (claimedResults.length === 0) {
        return {
            frequency: normalizedFrequency,
            deliveryKey: effectiveDeliveryKey,
            summary: null,
            channels: claimResults.map(mapUnclaimedSummaryChannelResult),
        };
    }

    let summary;

    try {
        ({ summary } = await getOrCreateSummaryPayload({
            userId: user._id,
            frequency: normalizedFrequency,
            deliveryKey: effectiveDeliveryKey,
        }));
    } catch (error) {
        const results = [];

        for (const { channel, claimResult } of claimResults) {
            if (!claimResult.claimed) {
                results.push(
                    mapUnclaimedSummaryChannelResult({
                        channel,
                        claimResult,
                    })
                );
                continue;
            }

            await markSummaryDeliveryFailed({
                record: claimResult.record,
                error,
            });

            results.push({
                channel,
                status: "failed",
                error: sanitizeSummaryDeliveryError({
                    channel,
                    error,
                }),
            });
        }

        return {
            frequency: normalizedFrequency,
            deliveryKey: effectiveDeliveryKey,
            summary: null,
            channels: results,
        };
    }

    const results = [];

    for (const { channel, claimResult } of claimResults) {
        if (!claimResult.claimed) {
            results.push(
                mapUnclaimedSummaryChannelResult({
                    channel,
                    claimResult,
                })
            );
            continue;
        }

        try {
            const sendResult = await sendSummaryToChannel({
                channel,
                user,
                frequency: normalizedFrequency,
                summary,
                timeZone,
            });

            await markSummaryDeliverySent({
                record: claimResult.record,
                summary,
                providerMessageId: sendResult.providerMessageId,
            });

            results.push({
                channel,
                status: "sent",
            });
        } catch (error) {
            await markSummaryDeliveryFailed({
                record: claimResult.record,
                error,
            });

            results.push({
                channel,
                status: "failed",
                error: sanitizeSummaryDeliveryError({
                    channel,
                    error,
                }),
            });
        }
    }

    return {
        frequency: normalizedFrequency,
        deliveryKey: effectiveDeliveryKey,
        summary,
        channels: results,
    };
};

const getSummaryDeliveryHistory = async ({ userId, limit = 10 }) =>
    SummaryDelivery.find({ userId })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

module.exports = {
    SUMMARY_CHANNELS,
    SUMMARY_FREQUENCIES,
    deliverSummary,
    buildManualSummaryDeliveryKey,
    getEligibleSummaryChannels,
    getScheduledSummaryContexts,
    getSummaryDeliveryHistory,
    sanitizeSummaryDeliveryError,
};
