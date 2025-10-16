const { createClient } = require('redis');

// In-memory fallback storage when Redis is not available
let inMemoryStorage = new Map();

const client = createClient({
    username: 'default',
    password: 'Od4tpLX0luCkQFZ45AF8the0haNR9cHz',
    socket: {
        host: 'redis-16393.crce217.ap-south-1-1.ec2.redns.redis-cloud.com',
        port:  16393
    }
});

let redisConnected = false;

client.on('error', (err) => {
    console.error('Redis Client Error:', err);
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
    setEx: async (key, ttl, value) => {
        if (redisConnected) {
            return await client.setEx(key, ttl, value);
        } else {
            // Fallback to in-memory storage
            inMemoryStorage.set(key, { value, expiresAt: Date.now() + (ttl * 1000) });
            return 'OK';
        }
    },

    get: async (key) => {
        if (redisConnected) {
            return await client.get(key);
        } else {
            // Fallback to in-memory storage
            const item = inMemoryStorage.get(key);
            if (item && item.expiresAt > Date.now()) {
                return item.value;
            } else if (item) {
                // Expired, remove it
                inMemoryStorage.delete(key);
            }
            return null;
        }
    },

    del: async (key) => {
        if (redisConnected) {
            return await client.del(key);
        } else {
            // Fallback to in-memory storage
            return inMemoryStorage.delete(key) ? 1 : 0;
        }
    },

    quit: async () => {
        if (redisConnected) {
            return await client.quit();
        }
    },

    isConnected: () => redisConnected
};

module.exports = redisWrapper;
