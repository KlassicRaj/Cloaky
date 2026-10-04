const express = require("express");
const { createRuleController } = require("../controllers/ruleController");

function createRulesManagementRouter({ ruleService }) {
    const router = express.Router();
    const controller = createRuleController({ ruleService });

    router.get("/:projectId/rules", controller.list);
    router.post("/:projectId/rules", controller.create);
    router.patch("/:projectId/rules/:ruleId", controller.update);
    router.delete("/:projectId/rules/:ruleId", controller.delete);

    return router;
}

module.exports = { createRulesManagementRouter };