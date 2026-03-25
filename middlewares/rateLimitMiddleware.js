const crypto = require("crypto");
const redis = require("../config/redis.js");

const RATE_LIMIT_VERSION = 1;

const OTP_SEND_RATE_LIMIT_WINDOW_SECONDS = Number(
    process.env.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS || 15 * 60
);
const OTP_SEND_RATE_LIMIT_MAX = Number(
    process.env.OTP_SEND_RATE_LIMIT_MAX || 5
);
const OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS = Number(
    process.env.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS || 15 * 60
);
const OTP_VERIFY_RATE_LIMIT_MAX = Number(
    process.env.OTP_VERIFY_RATE_LIMIT_MAX || 10
);
const AI_SUMMARY_RATE_LIMIT_WINDOW_SECONDS = Number(
    process.env.AI_SUMMARY_RATE_LIMIT_WINDOW_SECONDS || 10 * 60
);
const AI_SUMMARY_RATE_LIMIT_MAX = Number(
    process.env.AI_SUMMARY_RATE_LIMIT_MAX || 12
);
const CHAT_RATE_LIMIT_WINDOW_SECONDS = Number(
    process.env.CHAT_RATE_LIMIT_WINDOW_SECONDS || 10 * 60
);
const CHAT_RATE_LIMIT_MAX = Number(
    process.env.CHAT_RATE_LIMIT_MAX || 30
);

const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();

const getClientIp = (req) => {
    const forwardedFor = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();

    return (
        forwardedFor ||
        String(req.ip || "").trim() ||
        String(req.socket?.remoteAddress || "").trim() ||
        "unknown"
    );
};

const hashRateLimitIdentifier = (value = "") =>
    crypto.createHash("sha1").update(String(value || "").trim()).digest("hex").substring(0, 24);

const buildRateLimitKey = ({ keyPrefix, identifier }) =>
    `rate_limit:v${RATE_LIMIT_VERSION}:${String(keyPrefix)}:${hashRateLimitIdentifier(identifier)}`;

const createRedisRateLimiter = ({
    keyPrefix,
    maxRequests,
    windowSeconds,
    message,
    buildIdentifiers,
}) => {
    if (!keyPrefix) {
        throw new Error("Rate limit keyPrefix is required");
    }

    return async (req, res, next) => {
        const identifiers = [
            ...new Set(
                (typeof buildIdentifiers === "function" ? buildIdentifiers(req) : [])
                    .map((identifier) => String(identifier || "").trim())
                    .filter(Boolean)
            ),
        ];

        if (identifiers.length === 0) {
            return next();
        }

        try {
            let highestCount = 0;
            let shortestTtl = windowSeconds;

            for (const identifier of identifiers) {
                const rateLimitKey = buildRateLimitKey({
                    keyPrefix,
                    identifier,
                });
                const requestCount = await redis.incr(rateLimitKey);

                if (requestCount === 1) {
                    await redis.expire(rateLimitKey, windowSeconds);
                }

                const ttl = await redis.ttl(rateLimitKey);
                highestCount = Math.max(highestCount, Number(requestCount || 0));
                shortestTtl =
                    ttl > 0 ? Math.min(shortestTtl, ttl) : shortestTtl;

                if (requestCount > maxRequests) {
                    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
                    res.setHeader("Retry-After", String(retryAfterSeconds));

                    return res.status(429).json({
                        message:
                            message ||
                            "Too many requests. Please wait a little before trying again.",
                        retryAfterSeconds,
                    });
                }
            }

            res.setHeader("X-RateLimit-Limit", String(maxRequests));
            res.setHeader(
                "X-RateLimit-Remaining",
                String(Math.max(maxRequests - highestCount, 0))
            );
            res.setHeader(
                "X-RateLimit-Reset",
                String(shortestTtl > 0 ? shortestTtl : windowSeconds)
            );

            return next();
        } catch (error) {
            console.error(`Rate limit check failed for ${keyPrefix}:`, error.message);
            return next();
        }
    };
};

const otpSendRateLimiter = createRedisRateLimiter({
    keyPrefix: "otp_send",
    maxRequests: OTP_SEND_RATE_LIMIT_MAX,
    windowSeconds: OTP_SEND_RATE_LIMIT_WINDOW_SECONDS,
    message: "Too many OTP requests. Please wait before requesting another code.",
    buildIdentifiers: (req) => {
        const email = normalizeEmail(req.body?.email);
        const ip = getClientIp(req);

        return [
            email ? `email:${email}` : null,
            ip ? `ip:${ip}` : null,
        ];
    },
});

const otpVerifyRateLimiter = createRedisRateLimiter({
    keyPrefix: "otp_verify",
    maxRequests: OTP_VERIFY_RATE_LIMIT_MAX,
    windowSeconds: OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    message: "Too many OTP verification attempts. Please wait before trying again.",
    buildIdentifiers: (req) => {
        const email = normalizeEmail(req.body?.email);
        const ip = getClientIp(req);

        return [
            email ? `email:${email}` : null,
            ip ? `ip:${ip}` : null,
        ];
    },
});

const aiSummaryRateLimiter = createRedisRateLimiter({
    keyPrefix: "ai_summary",
    maxRequests: AI_SUMMARY_RATE_LIMIT_MAX,
    windowSeconds: AI_SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
    message: "AI summary is being used a bit too quickly. Please wait and try again.",
    buildIdentifiers: (req) => [
        req.user?.id ? `user:${req.user.id}` : `ip:${getClientIp(req)}`,
    ],
});

const chatRateLimiter = createRedisRateLimiter({
    keyPrefix: "finance_buddy_chat",
    maxRequests: CHAT_RATE_LIMIT_MAX,
    windowSeconds: CHAT_RATE_LIMIT_WINDOW_SECONDS,
    message: "Finance Buddy is getting too many requests right now. Please try again shortly.",
    buildIdentifiers: (req) => [
        req.user?.id ? `user:${req.user.id}` : `ip:${getClientIp(req)}`,
    ],
});

module.exports = {
    aiSummaryRateLimiter,
    chatRateLimiter,
    createRedisRateLimiter,
    getClientIp,
    otpSendRateLimiter,
    otpVerifyRateLimiter,
};
