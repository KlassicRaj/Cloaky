const { eventPaginationSchema, projectIdSchema } = require("../validation/eventValidation");

function validationResponse(res, issues) {
    return res.status(400).json({
        error: "validation_error",
        details: issues.map(({ code, message, path }) => ({ code, message, path })),
    });
}

function createEventController({ eventService }) {
    return {
        async list(req, res, next) {
            const projectId = projectIdSchema.safeParse(req.params.projectId);
            if (!projectId.success) {
                return validationResponse(res, projectId.error.issues.map((issue) => ({
                    ...issue,
                    path: ["projectId", ...issue.path],
                })));
            }

            const pagination = eventPaginationSchema.safeParse(req.query);
            if (!pagination.success) {
                return validationResponse(res, pagination.error.issues.map((issue) => ({
                    ...issue,
                    path: ["query", ...issue.path],
                })));
            }

            try {
                const result = await eventService.listByProjectId(
                    projectId.data,
                    req.userId,
                    pagination.data,
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

module.exports = { createEventController };
