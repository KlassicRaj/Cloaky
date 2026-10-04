const env = require("../config/env");

const INCREMENT_WITH_EXPIRY_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return { count, redis.call("TTL", KEYS[1]) }
`;

function createRateLimit({
    redisClient,
    clientIpService,
    visitorIdentityService,
    limit = env.RATE_LIMIT_PER_MINUTE,
    windowSeconds = 60,
    keyPrefix = "rate_limit",
    failClosed = false,
}) {
    const prefix = typeof keyPrefix === "string" && keyPrefix.trim()
        ? keyPrefix.trim().replace(/:+$/, "")
        : "rate_limit";

    return async function rateLimit(req, res, next) {
        function unavailable() {
            if (failClosed) {
                console.error("Rate limiter unavailable; rejecting request.");
                return res.status(503).json({ error: "rate_limit_unavailable" });
            }

            console.error("Rate limiter unavailable; allowing evaluation request.");
            return next();
        }

        let counter;

        try {
            const clientIp = await clientIpService.getClientIp(req);
            if (typeof clientIp !== "string" || clientIp.trim() === "") {
                return unavailable();
            }

            const visitorId = await visitorIdentityService.createVisitorId(clientIp);
            if (typeof visitorId !== "string" || visitorId.trim() === "") {
                return unavailable();
            }

            const key = `${prefix}:${visitorId}`;
            counter = await redisClient.eval(
                INCREMENT_WITH_EXPIRY_SCRIPT,
                1,
                key,
                windowSeconds,
            );
        } catch {
            return unavailable();
        }

        const count = Number(counter?.[0]);
        const ttl = Number(counter?.[1]);
        if (!Number.isInteger(count) || count < 1 || !Number.isInteger(ttl) || ttl < 0) {
            return unavailable();
        }

        if (count > limit) {
            if (ttl > 0) {
                res.setHeader("Retry-After", String(ttl));
            }

            return res.status(429).json({ error: "rate_limit_exceeded" });
        }

        return next();
    };
}

module.exports = { createRateLimit };