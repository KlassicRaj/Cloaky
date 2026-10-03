const { createDecision } = require("../domain/decision");
const { normalizeVisitor } = require("../domain/visitor");

function createRuleTestingService({ projectService, ruleRepository, ruleEngine }) {
    return {
        async testRules(projectId, authenticatedUserId, input) {
            const project = await projectService.getById(projectId, authenticatedUserId);
            if (!project) return null;

            const rules = await ruleRepository.listByProjectId(projectId);
            const visitor = normalizeVisitor(input.visitor);
            const decision = createDecision(await ruleEngine.evaluateRules(visitor, rules));
            if (!decision.matched) {
                return {
                    ...decision,
                    triggered: false,
                    configuredAction: "none",
                    frequencyStatus: "not_applicable",
                    ruleName: null,
                    priority: null,
                };
            }

            const rule = rules.find(({ id }) => id === decision.ruleId);
            if (!rule) {
                return {
                    matched: true,
                    ruleId: decision.ruleId,
                    ruleName: null,
                    priority: null,
                    action: "none",
                    destinationUrl: null,
                    fullscreenMode: "off",
                    triggered: false,
                    configuredAction: "none",
                    frequencyStatus: "unavailable",
                    reason: "rule_configuration_unavailable",
                };
            }

            const simulation = input.frequencySimulation;
            let frequencyStatus = "disabled";
            let frequencyAllowed = true;
            let reason = decision.reason;

            if (rule.frequency_enabled === true) {
                const elapsed = simulation.secondsSincePreviousTrigger ?? 0;
                if (rule.frequency_mode === "return_after" && simulation.visit === "first_visit") {
                    frequencyStatus = "recorded";
                    frequencyAllowed = false;
                    reason = "frequency_recorded";
                } else if (
                    simulation.visit === "returning" &&
                    elapsed < rule.frequency_seconds
                ) {
                    frequencyStatus = "limited";
                    frequencyAllowed = false;
                    reason = "frequency_limited";
                } else {
                    frequencyStatus = "triggered";
                    reason = "frequency_triggered";
                }
            }

            const action = frequencyAllowed ? decision.action : "none";
            return {
                matched: true,
                ruleId: decision.ruleId,
                ruleName: rule.name,
                priority: rule.priority,
                action,
                destinationUrl: action === "none" ? null : decision.destinationUrl,
                fullscreenMode: action === "none" ? "off" : decision.fullscreenMode,
                triggered: frequencyAllowed && action !== "none",
                configuredAction: decision.action,
                frequencyStatus,
                reason,
            };
        },
    };
}

module.exports = { createRuleTestingService };
