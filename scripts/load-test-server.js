process.env.NODE_ENV = "test";

const env = require("../src/config/env");
const db = require("../src/config/db");
const redis = require("../src/config/redis");
const { createApp } = require("../src/server");
const projectRepository = require("../src/repositories/projectRepository");
const ruleRepository = require("../src/repositories/ruleRepository");
const eventRepository = require("../src/repositories/eventRepository");
const userRepository = require("../src/repositories/userRepository");
const { evaluateRules } = require("../src/services/ruleEngine");
const { FrequencyService } = require("../src/services/frequencyService");
const { createEventLoggingService } = require("../src/services/eventLoggingService");
const clientIpService = require("../src/services/clientIpService");
const clientInfoService = require("../src/services/clientInfoService");
const visitorIdentityService = require("../src/services/visitorIdentityService");
const configCacheService = require("../src/services/configCacheService");
const { createEvaluationService } = require("../src/services/evaluationService");
const { createRateLimit } = require("../src/middleware/rateLimit");
const { createSessionService } = require("../src/services/sessionService");
const { registerShutdownHandlers } = require("../src/services/shutdownService");

async function main() {
    const namespace = process.env.LOAD_TEST_NAMESPACE;
    if (!namespace || !/^load_test:[a-f0-9-]{36}$/.test(namespace)) {
        throw new Error("A unique load-test Redis namespace is required.");
    }

    const databaseResult = await db.raw("SELECT current_database()");
    if (databaseResult.rows[0]?.current_database !== "visitor_routing_test") {
        throw new Error("Load-test server may only use visitor_routing_test.");
    }
    await redis.connect();
    if (await redis.ping() !== "PONG") {
        throw new Error("Redis preflight did not return PONG.");
    }
    configCacheService.clear();

    const configurationReads = { projects: 0, rules: 0 };
    const instrumentedProjectRepository = {
        ...projectRepository,
        findByProjectKey(projectKey) {
            configurationReads.projects += 1;
            return projectRepository.findByProjectKey(projectKey);
        },
    };
    const instrumentedRuleRepository = {
        ...ruleRepository,
        listByProjectId(projectId) {
            configurationReads.rules += 1;
            return ruleRepository.listByProjectId(projectId);
        },
    };
    const evaluationService = createEvaluationService({
        projectRepository: instrumentedProjectRepository,
        ruleRepository: instrumentedRuleRepository,
        clientIpService,
        geoIpService: require("../src/services/geoIpService"),
        clientInfoService,
        visitorIdentityService,
        frequencyService: new FrequencyService(redis, {
            keyPrefix: `${namespace}:frequency`,
        }),
        ruleEngine: { evaluateRules },
        eventLoggingService: createEventLoggingService({ eventRepository }),
        configCacheService,
    });
    const app = createApp({
        evaluationService,
        projectRepository: instrumentedProjectRepository,
        sessionService: createSessionService({
            secret: require("node:crypto").randomBytes(48).toString("base64url"),
        }),
        rateLimitMiddleware: createRateLimit({
            redisClient: redis,
            clientIpService,
            visitorIdentityService,
            limit: Number(process.env.LOAD_TEST_REQUESTS) * 4,
            keyPrefix: `${namespace}:rate-limit`,
        }),
        loginRateLimitMiddleware: createRateLimit({
            redisClient: redis,
            clientIpService,
            visitorIdentityService,
            limit: 100,
            keyPrefix: `${namespace}:login-rate-limit`,
        }),
    });

    app.get("/__load_test/metrics", (req, res) => {
        res.json(configurationReads);
    });

    await require("../src/services/geoIpService").initialize();
    const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        console.log(`LOAD_TEST_READY ${JSON.stringify({ port })}`);
    });
    registerShutdownHandlers(server, { database: db, redisClient: redis });
}

main().catch(async () => {
    console.error("Load-test server failed its isolated service preflight.");
    await db.destroy().catch(() => {});
    redis.disconnect();
    process.exitCode = 1;
});
