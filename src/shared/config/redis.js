const { createClient } = require("redis");

const isProduction = process.env.NODE_ENV === "production";

// Normalize Redis URL - handle pasted env format
const normalizeRedisUrl = (rawUrl) => {
    if (!rawUrl) return "";
    const trimmedUrl = String(rawUrl).trim();
    if (trimmedUrl.startsWith("REDIS_URL=")) {
        return trimmedUrl.slice("REDIS_URL=".length).trim();
    }
    return trimmedUrl;
};

const redisUrl = normalizeRedisUrl(process.env.REDIS_URL);
const redisConnectTimeout = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 5000);
const redisMaxRetries = Number(process.env.REDIS_MAX_RETRIES || 3);

// Validate Redis configuration is provided
if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is required");
}

const buildSocketConfig = (overrides = {}) => ({
    connectTimeout: redisConnectTimeout,
    reconnectStrategy: (retries) => {
        if (retries > redisMaxRetries) {
            console.error(`Redis reconnection failed after ${redisMaxRetries} retries`);
            throw new Error("Redis connection failed");
        }
        return Math.min((retries + 1) * 500, 2000);
    },
    ...overrides,
});

// Create Redis client with URL
let client;
let redisConnected = false;
let connectPromise = null;

try {
    client = createClient({
        url: redisUrl,
        socket: buildSocketConfig(),
    });

    client.on("error", (err) => {
        console.error("Redis Client Error:", err.message);
        redisConnected = false;
    });

    client.on("connect", () => {
        console.log("Redis Connected successfully");
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
} catch (error) {
    throw new Error(`Failed to initialize Redis client: ${error.message}`);
}

// Redis wrapper - no fallback to in-memory
const redisWrapper = {
    connect: async () => {
        if (redisConnected || client.isOpen) {
            return;
        }

        if (connectPromise) {
            return connectPromise;
        }

        connectPromise = client
            .connect()
            .catch((err) => {
                console.error("Failed to connect to Redis:", err.message);
                redisConnected = false;
                throw err;
            })
            .finally(() => {
                connectPromise = null;
            });

        return connectPromise;
    },

    // Set with expiration
    setEx: async (key, ttl, value) => {
        return await client.setEx(key, ttl, value);
    },

    // Alternative: set with EX flag (same as setEx)
    set: async (key, value, mode, duration) => {
        if (mode === "EX") {
            return await client.setEx(key, duration, value);
        }
        return await client.set(key, value);
    },

    // Get value
    get: async (key) => {
        return await client.get(key);
    },

    // Delete key(s)
    del: async (...keys) => {
        return await client.del(...keys);
    },

    // Increment numeric value
    incr: async (key) => {
        return await client.incr(key);
    },

    // Set expiration on an existing key
    expire: async (key, ttl) => {
        return await client.expire(key, ttl);
    },

    // Scan for keys matching pattern
    scan: async (cursor, matchOption, pattern, countOption, count) => {
        const result = await client.scan(cursor, {
            MATCH: pattern,
            COUNT: count,
        });
        return [result.cursor.toString(), result.keys];
    },

    // Check TTL
    ttl: async (key) => {
        return await client.ttl(key);
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
