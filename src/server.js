const express = require("express");
const env = require("./config/env");
const redis = require("./config/redis");
const healthRouter = require("./routes/health");
const { createEvaluateRouter } = require("./routes/evaluate");
const { createRedirectRouter } = require("./routes/redirect");
const sdkRouter = require("./routes/sdk");
const { createRateLimit } = require("./middleware/rateLimit");
const { createRequireAuth } = require("./middleware/requireAuth");
const projectRepository = require("./repositories/projectRepository");
const ruleRepository = require("./repositories/ruleRepository");
const eventRepository = require("./repositories/eventRepository");
const userRepository = require("./repositories/userRepository");
const { evaluateRules } = require("./services/ruleEngine");
const { FrequencyService } = require("./services/frequencyService");
const { createEventLoggingService } = require("./services/eventLoggingService");
const geoIpService = require("./services/geoIpService");
const clientIpService = require("./services/clientIpService");
const clientInfoService = require("./services/clientInfoService");
const visitorIdentityService = require("./services/visitorIdentityService");
const { createEvaluationService } = require("./services/evaluationService");
const { createProjectService } = require("./services/projectService");
const { createProjectsRouter } = require("./routes/projects");
const { createRuleService } = require("./services/ruleService");
const { createRulesManagementRouter } = require("./routes/rules");
const { createAuthRouter } = require("./routes/auth");
const { createSessionService } = require("./services/sessionService");
const { createAuthService } = require("./services/authService");
const configCacheService = require("./services/configCacheService");
const { createEventService } = require("./services/eventService");
const { createEventsRouter } = require("./routes/events");

const eventLoggingService = createEventLoggingService({ eventRepository });
const sessionService = createSessionService({ secret: env.SESSION_SECRET });
const authService = createAuthService({ userRepository });

function createRealEvaluationService(projectRepositoryInstance = projectRepository) {
    return createEvaluationService({
        projectRepository: projectRepositoryInstance,
        ruleRepository,
        clientIpService,
        geoIpService,
        clientInfoService,
        visitorIdentityService,
        frequencyService: new FrequencyService(redis),
        ruleEngine: { evaluateRules },
        eventLoggingService,
        configCacheService,
    });
}

function createApp({
    evaluationService,
    projectRepository: projectRepositoryInstance = projectRepository,
    projectService,
    eventService,
    eventRepository: eventRepositoryInstance = eventRepository,
    ruleService,
    authService: authServiceInstance,
    sessionService: sessionServiceInstance,
    userRepository: userRepositoryInstance = userRepository,
    requireAuthMiddleware,
    cookieSecure,
    loginRateLimitMiddleware,
    rateLimitMiddleware,
} = {}) {
    const app = express();
    const configuredEvaluationService = evaluationService ||
        createRealEvaluationService(projectRepositoryInstance);
    const configuredRateLimitMiddleware = rateLimitMiddleware || createRateLimit({
        redisClient: redis,
        clientIpService,
        visitorIdentityService,
    });
    const configuredProjectService = projectService || createProjectService({
        projectRepository: projectRepositoryInstance,
        userRepository: userRepositoryInstance,
        configCacheService,
    });
    const configuredRuleService = ruleService || createRuleService({
        projectRepository: projectRepositoryInstance,
        ruleRepository,
        userRepository: userRepositoryInstance,
        configCacheService,
    });
    const configuredEventService = eventService || createEventService({
        projectService: configuredProjectService,
        eventRepository: eventRepositoryInstance,
    });
    const configuredSessionService = sessionServiceInstance || sessionService;
    const configuredAuthService = authServiceInstance ||
        (userRepositoryInstance === userRepository
            ? authService
            : createAuthService({ userRepository: userRepositoryInstance }));
    const configuredRequireAuth = requireAuthMiddleware || createRequireAuth({
        sessionService: configuredSessionService,
        userRepository: userRepositoryInstance,
    });
    const configuredLoginRateLimit = loginRateLimitMiddleware || createRateLimit({
        redisClient: redis,
        clientIpService,
        visitorIdentityService,
        limit: 10,
        keyPrefix: "login_rate_limit",
    });

    app.use(express.json());
    app.use(healthRouter);
    app.use("/api/auth", createAuthRouter({
        authService: configuredAuthService,
        sessionService: configuredSessionService,
        cookieSecure: cookieSecure ?? (env.COOKIE_SECURE || env.NODE_ENV === "production"),
        loginRateLimitMiddleware: configuredLoginRateLimit,
    }));
    app.use("/api/projects", configuredRequireAuth);
    app.use("/api/projects", createProjectsRouter({ projectService: configuredProjectService }));
    app.use("/api/projects", createEventsRouter({ eventService: configuredEventService }));
    app.use("/api/projects", createRulesManagementRouter({ ruleService: configuredRuleService }));
    app.use(sdkRouter);
    app.use(createRedirectRouter({ evaluationService: configuredEvaluationService }));
    app.use("/api/v1", createEvaluateRouter({
        evaluationService: configuredEvaluationService,
        projectRepository: projectRepositoryInstance,
        rateLimitMiddleware: configuredRateLimitMiddleware,
    }));

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }

        if (error?.type === "entity.parse.failed") {
            return res.status(400).json({ error: "validation_error", details: [] });
        }

        if (env.NODE_ENV === "development") {
            console.error("Request failed:", error);
        }

        return res.status(500).json({ error: "internal_error" });
    });

    return app;
}

const app = createApp();

async function startServer() {
    await geoIpService.initialize();
    return app.listen(env.PORT, () => {
        console.log(`Server running on port ${env.PORT}`);
    });
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error("Server startup failed:", error);
        process.exitCode = 1;
    });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
