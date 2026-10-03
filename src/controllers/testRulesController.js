const { projectIdSchema } = require("../validation/projectValidation");
const { testRulesRequestSchema } = require("../validation/testRulesValidation");

function validationResponse(res, issues) {
    return res.status(400).json({
        error: "validation_error",
        details: issues.map(({ code, message, path }) => ({ code, message, path })),
    });
}

function createTestRulesController({ ruleTestingService }) {
    return {
        async test(req, res, next) {
            const projectId = projectIdSchema.safeParse(req.params.projectId);
            if (!projectId.success) {
                return validationResponse(res, projectId.error.issues.map((issue) => ({
                    ...issue,
                    path: ["projectId", ...issue.path],
                })));
            }

            const validation = testRulesRequestSchema.safeParse(req.body);
            if (!validation.success) return validationResponse(res, validation.error.issues);

            try {
                const result = await ruleTestingService.testRules(
                    projectId.data,
                    req.userId,
                    validation.data,
                );
                if (!result) return res.status(404).json({ error: "project_not_found" });
                return res.json(result);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },
    };
}

module.exports = { createTestRulesController };
