const RETURN_AFTER_SCRIPT = `
local last_visit = redis.call("GET", KEYS[1])
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local frequency_milliseconds = tonumber(ARGV[1]) * 1000

if not last_visit then
    redis.call("SET", KEYS[1], tostring(now), "EX", ARGV[2])
    return 1
end

if now - tonumber(last_visit) < frequency_milliseconds then
    return 0
end

redis.call("SET", KEYS[1], tostring(now), "EX", ARGV[2])
return 2
`;

const MAX_FREQUENCY_SECONDS = Math.floor(2147483647 / 2);

function normalizeIdentifier(value) {
    if (typeof value === "number" && !Number.isFinite(value)) {
        return null;
    }

    if (typeof value !== "string" && typeof value !== "number") {
        return null;
    }

    const identifier = String(value).trim();
    return identifier ? encodeURIComponent(identifier) : null;
}

function normalizePrefix(prefix) {
    if (typeof prefix !== "string" || prefix.trim() === "") {
        return "frequency";
    }

    return prefix.trim().replace(/:+$/, "");
}

class FrequencyService {
    constructor(redisClient, { keyPrefix = "frequency" } = {}) {
        this.redisClient = redisClient;
        this.keyPrefix = normalizePrefix(keyPrefix);
    }

    async checkAndRecord(input = {}) {
        const options = input && typeof input === "object" ? input : {};

        if (options.frequencyEnabled === false) {
            return { triggered: true, reason: "frequency_disabled" };
        }

        const projectId = normalizeIdentifier(options.projectId);
        const ruleId = normalizeIdentifier(options.ruleId);
        const visitorId = normalizeIdentifier(options.visitorId);
        const { frequencyEnabled, frequencySeconds, frequencyMode } = options;

        if (
            frequencyEnabled !== true ||
            !projectId ||
            !ruleId ||
            !visitorId ||
            !Number.isInteger(frequencySeconds) ||
            frequencySeconds <= 0 ||
            frequencySeconds > MAX_FREQUENCY_SECONDS ||
            !["cooldown", "return_after"].includes(frequencyMode)
        ) {
            return { triggered: false, reason: "frequency_invalid" };
        }

        const key = `${this.keyPrefix}:${projectId}:${ruleId}:${visitorId}`;

        try {
            if (frequencyMode === "cooldown") {
                const result = await this.redisClient.set(
                    key,
                    "1",
                    "EX",
                    frequencySeconds,
                    "NX",
                );

                return result === "OK"
                    ? { triggered: true, reason: "frequency_triggered" }
                    : { triggered: false, reason: "frequency_limited" };
            }

            const retentionSeconds = frequencySeconds * 2;
            const result = await this.redisClient.eval(
                RETURN_AFTER_SCRIPT,
                1,
                key,
                frequencySeconds,
                retentionSeconds,
            );

            if (Number(result) === 1) {
                return { triggered: false, reason: "frequency_recorded" };
            }

            if (Number(result) === 2) {
                return { triggered: true, reason: "frequency_triggered" };
            }

            return { triggered: false, reason: "frequency_limited" };
        } catch (error) {
            console.error("Frequency service Redis operation failed:", error);
            return { triggered: false, reason: "frequency_unavailable" };
        }
    }
}

module.exports = { FrequencyService };