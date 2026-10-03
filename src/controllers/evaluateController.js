const { createDecision } = require("../domain/decision");
const {
    evaluateProjectKeySchema,
    evaluateRequestSchema,
} = require("../validation/evaluateValidation");

function createEvaluateController({ evaluationService }) {
    return async function evaluateController(req, res, next) {
        const projectKeyValidation = evaluateProjectKeySchema.safeParse(req.query.projectKey);
        if (!projectKeyValidation.success) {
            return res.status(400).json({
                error: "validation_error",
                details: projectKeyValidation.error.issues.map(({ code, message, path }) => ({
                    code,
                    message,
                    path: ["projectKey", ...path],
                })),
            });
        }

        const validation = evaluateRequestSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: "validation_error",
                details: validation.error.issues.map(({ code, message, path }) => ({
                    code,
                    message,
                    path,
                })),
            });
        }

        const clientInfo = validation.data;

        try {
            const result = await evaluationService.evaluate({
            projectKey: projectKeyValidation.data,
                request: req,
                clientInfo,
            });
            const decision = createDecision(result);
            const status = decision.reason === "project_not_found" ? 404 : 200;

            return res.status(status).json(decision);
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = { createEvaluateController };