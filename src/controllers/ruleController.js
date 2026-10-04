const { projectIdSchema, ruleIdSchema, createRuleSchema, updateRuleSchema } = require("../validation/ruleValidation");

function validationResponse(res, issues) {
    return res.status(400).json({
        error: "validation_error",
        details: issues.map(({ code, message, path }) => ({ code, message, path })),
    });
}

function validateIds(req, res, includeRuleId = false) {
    const projectIdResult = projectIdSchema.safeParse(req.params.projectId);
    if (!projectIdResult.success) {
        validationResponse(res, projectIdResult.error.issues.map((issue) => ({
            ...issue,
            path: ["projectId", ...issue.path],
        })));
        return null;
    }

    if (!includeRuleId) return { projectId: projectIdResult.data };

    const ruleIdResult = ruleIdSchema.safeParse(req.params.ruleId);
    if (!ruleIdResult.success) {
        validationResponse(res, ruleIdResult.error.issues.map((issue) => ({
            ...issue,
            path: ["ruleId", ...issue.path],
        })));
        return null;
    }

    return { projectId: projectIdResult.data, ruleId: ruleIdResult.data };
}

function createRuleController({ ruleService }) {
    return {
        async list(req, res, next) {
            const ids = validateIds(req, res);
            if (!ids) return;

            try {
                const rules = await ruleService.listByProjectId(ids.projectId, req.userId);
                if (!rules) return res.status(404).json({ error: "project_not_found" });
                return res.json(rules);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },

        async create(req, res, next) {
            const ids = validateIds(req, res);
            if (!ids) return;

            const validation = createRuleSchema.safeParse(req.body);
            if (!validation.success) return validationResponse(res, validation.error.issues);

            try {
                const rule = await ruleService.create(ids.projectId, validation.data, req.userId);
                if (!rule) return res.status(404).json({ error: "project_not_found" });
                return res.status(201).json(rule);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                if (error?.code === "RULE_CONFIGURATION_INVALID") {
                    return validationResponse(res, error.issues);
                }
                return next(error);
            }
        },

        async update(req, res, next) {
            const ids = validateIds(req, res, true);
            if (!ids) return;

            const validation = updateRuleSchema.safeParse(req.body);
            if (!validation.success) return validationResponse(res, validation.error.issues);

            try {
                const rule = await ruleService.updateById(ids.projectId, ids.ruleId, validation.data, req.userId);
                if (!rule) return res.status(404).json({ error: "rule_not_found" });
                return res.json(rule);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                if (error?.code === "RULE_CONFIGURATION_INVALID") {
                    return validationResponse(res, error.issues);
                }
                return next(error);
            }
        },

        async delete(req, res, next) {
            const ids = validateIds(req, res, true);
            if (!ids) return;

            try {
                const deleted = await ruleService.deleteById(ids.projectId, ids.ruleId, req.userId);
                if (!deleted) return res.status(404).json({ error: "rule_not_found" });
                return res.json({ deleted: true });
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },
    };
}

module.exports = { createRuleController };