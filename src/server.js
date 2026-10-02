const express = require("express");
const env = require("./config/env");
const redis = require("./config/redis");
const healthRouter = require("./routes/health");
const { createEvaluateRouter } = require("./routes/evaluate");
const projectRepository = require("./repositories/projectRepository");
const ruleRepository = require("./repositories/ruleRepository");
const { evaluateRules } = require("./services/ruleEngine");
const { FrequencyService } = require("./services/frequencyService");
const geoIpService = require("./services/geoIpService");
const clientIpService = require("./services/clientIpService");
const clientInfoService = require("./services/clientInfoService");
const visitorIdentityService = require("./services/visitorIdentityService");
const { createEvaluationService } = require("./services/evaluationService");

function createRealEvaluationService() {
    return createEvaluationService({
        projectRepository,
        ruleRepository,
        clientIpService,
        geoIpService,
        clientInfoService,
        visitorIdentityService,
        frequencyService: new FrequencyService(redis),
        ruleEngine: { evaluateRules },
    });
}

function createApp({ evaluationService = createRealEvaluationService() } = {}) {
    const app = express();

    app.use(express.json());
    app.use(healthRouter);
    app.use("/api/v1", createEvaluateRouter({ evaluationService }));

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