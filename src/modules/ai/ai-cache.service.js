const redis = require("../../shared/config/redis.js");
const {
    getFinancialSummary,
    normalizeSummaryRange,
} = require("./ai.service.js");

const SUMMARY_GENERATION_CACHE_TTL_SECONDS = 60 * 60 * 24 * 3;
const SUMMARY_GENERATION_CACHE_VERSION = 1;

const buildSummaryGenerationCacheKey = ({ userId, frequency, deliveryKey }) =>
    `summary:generation:v${SUMMARY_GENERATION_CACHE_VERSION}:${String(userId)}:${normalizeSummaryRange(
        frequency
    )}:${String(deliveryKey || "").trim()}`;

const parseCachedSummaryPayload = (rawValue) => {
    if (!rawValue) {
        return null;
    }

    try {
        const parsedValue = JSON.parse(rawValue);

        if (parsedValue?.summary && typeof parsedValue.summary === "object") {
            return parsedValue.summary;
        }
    } catch (error) {
        console.error("Failed to parse cached summary payload:", error.message);
    }

    return null;
};

const getOrCreateSummaryPayload = async ({
    userId,
    frequency,
    deliveryKey,
}) => {
    if (!userId) {
        throw new Error("User ID is required to generate a summary payload.");
    }

    if (!deliveryKey) {
        throw new Error("Delivery key is required to generate a summary payload.");
    }

    const cacheKey = buildSummaryGenerationCacheKey({
        userId,
        frequency,
        deliveryKey,
    });
    const cachedSummary = parseCachedSummaryPayload(await redis.get(cacheKey));

    if (cachedSummary) {
        return {
            summary: cachedSummary,
            cached: true,
            cacheKey,
        };
    }

    const summary = await getFinancialSummary({
        userId,
        range: frequency,
    });

    try {
        await redis.setEx(
            cacheKey,
            SUMMARY_GENERATION_CACHE_TTL_SECONDS,
            JSON.stringify({
                generatedAt: new Date().toISOString(),
                summary,
            })
        );
    } catch (error) {
        console.error("Failed to cache generated summary payload:", error.message);
    }

    return {
        summary,
        cached: false,
        cacheKey,
    };
};

module.exports = {
    buildSummaryGenerationCacheKey,
    getOrCreateSummaryPayload,
};
