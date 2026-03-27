const { createClient } = require("redis");

// In-memory fallback storage when Redis is not available
const inMemoryStorage = new Map();
const isProduction = process.env.NODE_ENV === "production";

const normalizeRedisUrl = (rawUrl) => {
    if (!rawUrl) {
        return "";
    }

    const trimmedUrl = String(rawUrl).trim();

    // Be forgiving if the env value was pasted as `REDIS_URL=redis://...`
    if (trimmedUrl.startsWith("REDIS_URL=")) {
        return trimmedUrl.slice("REDIS_URL=".length).trim();
    }

    return trimmedUrl;
};

const redisUrl = normalizeRedisUrl(process.env.REDIS_URL);
const redisPort = Number(process.env.REDIS_PORT || 6379);
const redisConnectTimeout = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000);
const redisMaxRetries = Number(process.env.REDIS_MAX_RETRIES || 3);
const redisDisabled = String(process.env.REDIS_DISABLED || "").trim().toLowerCase() === "true";
const redisRequiredInProduction =
    isProduction &&
    String(process.env.REDIS_REQUIRED_IN_PRODUCTION || "true").trim().toLowerCase() !== "false";
const hasExplicitRedisConfig = Boolean(
    redisUrl ||
    process.env.REDIS_HOST ||
    process.env.REDIS_USERNAME ||
    process.env.REDIS_PASSWORD
);
const shouldAttemptRedis = !redisDisabled && (hasExplicitRedisConfig || !isProduction);
let client;

if (redisRequiredInProduction && redisDisabled) {
    throw new Error("Redis cannot be disabled in production when REDIS_REQUIRED_IN_PRODUCTION is enabled.");
}

if (redisRequiredInProduction && !hasExplicitRedisConfig) {
    throw new Error("Redis must be explicitly configured in production.");
}

const buildSocketConfig = (overrides = {}) => ({
    connectTimeout: redisConnectTimeout,
    reconnectStrategy: (retries) => {
        if (retries >= redisMaxRetries) {
            console.warn("Redis reconnect limit reached, switching to in-memory storage.");
            return false;
        }

        return Math.min((retries + 1) * 500, 2000);
    },
    ...overrides,
});

if (shouldAttemptRedis) {
    try {
        client = createClient(
            redisUrl
                ? {
                    url: redisUrl,
                    socket: buildSocketConfig(),
                }
                : {
                    username: process.env.REDIS_USERNAME || undefined,
                    password: process.env.REDIS_PASSWORD || undefined,
                    socket: buildSocketConfig({
                        host: process.env.REDIS_HOST || "127.0.0.1",
                        port: redisPort,
                    }),
                }
        );
    } catch (error) {
        if (redisRequiredInProduction) {
            throw error;
        }
        console.error("Invalid Redis configuration, falling back to in-memory storage:", error.message);
        client = null;
    }
} else {
    if (redisRequiredInProduction) {
        throw new Error("Redis is required in production but was not configured.");
    }
    console.warn("Redis disabled or not configured for this environment. Using in-memory storage.");
}

let redisConnected = false;
let connectPromise = null;

if (client) {
    client.on("error", (err) => {
        console.error("Redis Client Error:", err.message);
        redisConnected = false;
    });

    client.on("connect", () => {
        console.log("Redis Connected");
        redisConnected = true;
    });

    client.on("ready", () => {
        console.log("Redis Client Ready");
        redisConnected = true;
    });

    client.on("end", () => {
        console.log("Redis Connection Ended");
        redisConnected = false;
    });
}

// Wrapper functions with fallback to in-memory storage
const redisWrapper = {
    connect: async () => {
        if (!client) {
            return;
        }

        if (redisConnected || client.isOpen) {
            return;
        }

        if (connectPromise) {
            return connectPromise;
        }

        connectPromise = client
            .connect()
            .catch((err) => {
                console.error("Failed to connect to Redis, using in-memory storage:", err.message);
                redisConnected = false;
                if (redisRequiredInProduction) {
                    throw err;
                }
            })
            .finally(() => {
                connectPromise = null;
            });

        return connectPromise;
    },

    // Set with expiration
    setEx: async (key, ttl, value) => {
        if (redisConnected) {
            return await client.setEx(key, ttl, value);
        } else {
            inMemoryStorage.set(key, { value, expiresAt: Date.now() + (ttl * 1000) });
            return "OK";
        }
    },

    // Alternative: set with EX flag (same as setEx)
    set: async (key, value, mode, duration) => {
        if (redisConnected) {
            if (mode === "EX") {
                return await client.setEx(key, duration, value);
            }
            return await client.set(key, value);
        } else {
            if (mode === "EX") {
                inMemoryStorage.set(key, { value, expiresAt: Date.now() + (duration * 1000) });
            } else {
                inMemoryStorage.set(key, { value, expiresAt: Infinity });
            }
            return "OK";
        }
    },

    // Get value
    get: async (key) => {
        if (redisConnected) {
            return await client.get(key);
        } else {
            const item = inMemoryStorage.get(key);
            if (item && item.expiresAt > Date.now()) {
                return item.value;
            } else if (item) {
                inMemoryStorage.delete(key);
            }
            return null;
        }
    },

    // Delete key(s)
    del: async (...keys) => {
        if (redisConnected) {
            return await client.del(...keys);
        } else {
            let count = 0;
            for (const key of keys) {
                if (inMemoryStorage.delete(key)) count++;
            }
            return count;
        }
    },

    // Increment numeric value
    incr: async (key) => {
        if (redisConnected) {
            return await client.incr(key);
        } else {
            const item = inMemoryStorage.get(key);

            if (item && item.expiresAt <= Date.now()) {
                inMemoryStorage.delete(key);
            }

            const currentValue = Number(inMemoryStorage.get(key)?.value || 0);
            const nextValue = currentValue + 1;
            const expiresAt = inMemoryStorage.get(key)?.expiresAt ?? Infinity;

            inMemoryStorage.set(key, {
                value: String(nextValue),
                expiresAt,
            });

            return nextValue;
        }
    },

    // Set expiration on an existing key
    expire: async (key, ttl) => {
        if (redisConnected) {
            return await client.expire(key, ttl);
        } else {
            const item = inMemoryStorage.get(key);

            if (!item) {
                return 0;
            }

            inMemoryStorage.set(key, {
                ...item,
                expiresAt: Date.now() + (ttl * 1000),
            });

            return 1;
        }
    },

    // Scan for keys matching pattern
    scan: async (cursor, matchOption, pattern, countOption, count) => {
        if (redisConnected) {
            const result = await client.scan(cursor, {
                MATCH: pattern,
                COUNT: count,
            });
            return [result.cursor.toString(), result.keys];
        } else {
            // Fallback: scan in-memory storage
            const keys = [];
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            
            for (const key of inMemoryStorage.keys()) {
                if (regex.test(key)) {
                    keys.push(key);
                }
            }
            return ["0", keys]; // Always return cursor '0' for in-memory
        }
    },

    // Check TTL
    ttl: async (key) => {
        if (redisConnected) {
            return await client.ttl(key);
        } else {
            const item = inMemoryStorage.get(key);
            if (!item) return -2; // Key doesn't exist
            if (item.expiresAt === Infinity) return -1; // No expiration
            const remaining = Math.floor((item.expiresAt - Date.now()) / 1000);
            return remaining > 0 ? remaining : -2;
        }
    },

    // Quit connection
    quit: async () => {
        if (client?.isOpen) {
            return await client.quit();
        }
    },

    // Check connection status
    isConnected: () => redisConnected
};

module.exports = redisWrapper;
