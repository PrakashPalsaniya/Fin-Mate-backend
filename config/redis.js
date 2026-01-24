const { createClient } = require('redis');

// In-memory fallback storage when Redis is not available
let inMemoryStorage = new Map();

const client = createClient({
  username: "default",
  password: "Od4tpLX0luCkQFZ45AF8the0haNR9cHz",
  socket: {
    host: "redis-12569.c13.us-east-1-3.ec2.cloud.redislabs.com",
    port: 12569
  }
});

let redisConnected = false;

client.on('error', (err) => {
    console.error('❌ Redis Client Error:', err);
    redisConnected = false;
});

client.on('connect', () => {
    console.log('✅ Redis Connected');
    redisConnected = true;
});

client.on('ready', () => {
    console.log('✅ Redis Client Ready');
    redisConnected = true;
});

client.on('end', () => {
    console.log('❌ Redis Connection Ended');
    redisConnected = false;
});

// Connect to Redis
(async () => {
    try {
        await client.connect();
    } catch (err) {
        console.error('Failed to connect to Redis, using in-memory storage:', err.message);
        redisConnected = false;
    }
})();

// Wrapper functions with fallback to in-memory storage
const redisWrapper = {
    // Set with expiration
    setEx: async (key, ttl, value) => {
        if (redisConnected) {
            return await client.setEx(key, ttl, value);
        } else {
            inMemoryStorage.set(key, { value, expiresAt: Date.now() + (ttl * 1000) });
            return 'OK';
        }
    },

    // Alternative: set with EX flag (same as setEx)
    set: async (key, value, mode, duration) => {
        if (redisConnected) {
            if (mode === 'EX') {
                return await client.setEx(key, duration, value);
            }
            return await client.set(key, value);
        } else {
            if (mode === 'EX') {
                inMemoryStorage.set(key, { value, expiresAt: Date.now() + (duration * 1000) });
            } else {
                inMemoryStorage.set(key, { value, expiresAt: Infinity });
            }
            return 'OK';
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
            return await client.del(keys);
        } else {
            let count = 0;
            for (const key of keys) {
                if (inMemoryStorage.delete(key)) count++;
            }
            return count;
        }
    },

    // Scan for keys matching pattern
    scan: async (cursor, matchOption, pattern, countOption, count) => {
        if (redisConnected) {
            const result = await client.scan(cursor, {
                MATCH: pattern,
                COUNT: count
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
            return ['0', keys]; // Always return cursor '0' for in-memory
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
        if (redisConnected) {
            return await client.quit();
        }
    },

    // Check connection status
    isConnected: () => redisConnected
};

module.exports = redisWrapper;
