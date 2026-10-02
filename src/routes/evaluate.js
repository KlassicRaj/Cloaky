const express = require("express");
const { createEvaluateController } = require("../controllers/evaluateController");

function createEvaluateRouter({ evaluationService }) {
    const router = express.Router();
    router.post("/evaluate", createEvaluateController({ evaluationService }));
    return router;
}

module.exports = { createEvaluateRouter };