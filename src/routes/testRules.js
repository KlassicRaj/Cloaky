const express = require("express");
const { createTestRulesController } = require("../controllers/testRulesController");

function createTestRulesRouter({ ruleTestingService }) {
    const router = express.Router();
    const controller = createTestRulesController({ ruleTestingService });

    router.post("/:projectId/test-rules", controller.test);

    return router;
}

module.exports = { createTestRulesRouter };
