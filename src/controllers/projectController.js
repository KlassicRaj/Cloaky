const {
    createProjectSchema,
    projectIdSchema,
    updateProjectSchema,
} = require("../validation/projectValidation");

function validationResponse(res, issues) {
    return res.status(400).json({
        error: "validation_error",
        details: issues.map(({ code, message, path }) => ({ code, message, path })),
    });
}

function validProjectId(req, res) {
    const result = projectIdSchema.safeParse(req.params.projectId);
    if (!result.success) {
        validationResponse(res, result.error.issues.map((issue) => ({
            ...issue,
            path: ["projectId", ...issue.path],
        })));
        return null;
    }
    return result.data;
}

function createProjectController({ projectService }) {
    return {
        async list(req, res, next) {
            try {
                return res.json(await projectService.list(req.userId));
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },

        async create(req, res, next) {
            const validation = createProjectSchema.safeParse(req.body);
            if (!validation.success) {
                return validationResponse(res, validation.error.issues);
            }

            try {
                const project = await projectService.create(validation.data, req.userId);
                return res.status(201).json(project);
            } catch (error) {
                if (error?.code === "23505") {
                    return res.status(409).json({ error: "project_key_already_exists" });
                }
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },

        async getById(req, res, next) {
            const projectId = validProjectId(req, res);
            if (!projectId) return;

            try {
                const project = await projectService.getById(projectId, req.userId);
                if (!project) {
                    return res.status(404).json({ error: "project_not_found" });
                }
                return res.json(project);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },

        async updateById(req, res, next) {
            const projectId = validProjectId(req, res);
            if (!projectId) return;

            const validation = updateProjectSchema.safeParse(req.body);
            if (!validation.success) {
                return validationResponse(res, validation.error.issues);
            }

            try {
                const project = await projectService.updateById(projectId, validation.data, req.userId);
                if (!project) {
                    return res.status(404).json({ error: "project_not_found" });
                }
                return res.json(project);
            } catch (error) {
                if (error?.code === "AUTH_USER_UNAVAILABLE") {
                    return res.status(401).json({ error: "unauthorized" });
                }
                return next(error);
            }
        },

        async deleteById(req, res, next) {
            const projectId = validProjectId(req, res);
            if (!projectId) return;

            try {
                const deleted = await projectService.deleteById(projectId, req.userId);
                if (!deleted) {
                    return res.status(404).json({ error: "project_not_found" });
                }
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

module.exports = { createProjectController };