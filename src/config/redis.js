const Redis = require("ioredis");
const env = require("./env");

const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(attempt) {
        return attempt > 3 ? null : Math.min(attempt * 100, 300);
    },
});

redis.on("error", (error) => {
    console.error("Redis connection error:", error.message);
});

module.exports = redis;