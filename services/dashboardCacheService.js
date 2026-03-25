const crypto = require("crypto");
const redis = require("../config/redis.js");

const DASHBOARD_CACHE_TTL_SECONDS = Number(
    process.env.DASHBOARD_CACHE_TTL_SECONDS || 60
);
const DASHBOARD_CACHE_VERSION = 1;

const hashDashboardVariant = (value = "") =>
    crypto.createHash("sha1").update(String(value || "").trim()).digest("hex").substring(0, 12);

const buildDashboardCacheKey = ({ userId, timeZone }) =>
    `dashboard:v${DASHBOARD_CACHE_VERSION}:${String(userId)}:${hashDashboardVariant(timeZone)}`;

const parseCachedDashboardPayload = (rawValue) => {
    if (!rawValue) {
        return null;
    }

    try {
        const parsedValue = JSON.parse(rawValue);

        if (parsedValue?.data && typeof parsedValue.data === "object") {
            return parsedValue.data;
        }
    } catch (error) {
        console.error("Failed to parse cached dashboard payload:", error.message);
    }

    return null;
};

const getCachedDashboardResponse = async ({ userId, timeZone }) => {
    const cacheKey = buildDashboardCacheKey({ userId, timeZone });
    const cachedResponse = parseCachedDashboardPayload(await redis.get(cacheKey));

    return {
        cacheKey,
        data: cachedResponse,
    };
};

const setCachedDashboardResponse = async ({ userId, timeZone, data }) => {
    if (!userId || !data) {
        return null;
    }

    const cacheKey = buildDashboardCacheKey({ userId, timeZone });

    await redis.setEx(
        cacheKey,
        DASHBOARD_CACHE_TTL_SECONDS,
        JSON.stringify({
            generatedAt: new Date().toISOString(),
            data,
        })
    );

    return cacheKey;
};

const invalidateDashboardCache = async ({ userId }) => {
    if (!userId) {
        return 0;
    }

    const pattern = `dashboard:v${DASHBOARD_CACHE_VERSION}:${String(userId)}:*`;
    let cursor = "0";
    const keys = [];

    do {
        const [nextCursor, matchedKeys] = await redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100
        );
        cursor = nextCursor;
        keys.push(...matchedKeys);
    } while (cursor !== "0");

    if (keys.length === 0) {
        return 0;
    }

    const batchSize = 100;
    let deletedCount = 0;

    for (let index = 0; index < keys.length; index += batchSize) {
        const batch = keys.slice(index, index + batchSize);
        deletedCount += await redis.del(...batch);
    }

    return deletedCount;
};

module.exports = {
    DASHBOARD_CACHE_TTL_SECONDS,
    buildDashboardCacheKey,
    getCachedDashboardResponse,
    invalidateDashboardCache,
    setCachedDashboardResponse,
};
