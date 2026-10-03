const express = require("express");
const { createEvaluateController } = require("../controllers/evaluateController");
const { createProjectCors } = require("../middleware/projectCors");

function createEvaluateRouter({ evaluationService, projectRepository, rateLimitMiddleware }) {
    const router = express.Router();
    router.use("/evaluate", createProjectCors({ projectRepository }));
    router.post("/evaluate", rateLimitMiddleware, createEvaluateController({ evaluationService }));
    return router;
}

module.exports = { createEvaluateRouter };