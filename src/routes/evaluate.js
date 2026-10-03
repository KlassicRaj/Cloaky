const express = require("express");
const { createEvaluateController } = require("../controllers/evaluateController");
const { createProjectCors } = require("../middleware/projectCors");

function createEvaluateRouter({ evaluationService, projectRepository }) {
    const router = express.Router();
    router.use("/evaluate", createProjectCors({ projectRepository }));
    router.post("/evaluate", createEvaluateController({ evaluationService }));
    return router;
}

module.exports = { createEvaluateRouter };