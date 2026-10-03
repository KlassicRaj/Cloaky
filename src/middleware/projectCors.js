function validationError(res) {
    return res.status(400).json({ error: "validation_error", details: [] });
}

function createProjectCors({ projectRepository }) {
    return async function projectCors(req, res, next) {
        const origin = req.get("Origin");
        if (!origin) {
            return next();
        }

        const projectKey = req.query.projectKey;
        if (typeof projectKey !== "string" || projectKey.trim() === "") {
            return validationError(res);
        }

        try {
            const project = await projectRepository.findByProjectKey(projectKey);
            if (!project) {
                return res.status(404).json({ error: "project_not_found" });
            }

            const allowedOrigins = project.allowed_origins;
            const isAllowed = Array.isArray(allowedOrigins) &&
                origin !== "*" &&
                allowedOrigins.includes(origin);

            if (!isAllowed) {
                return res.status(403).json({ error: "origin_not_allowed" });
            }

            res.setHeader("Access-Control-Allow-Origin", origin);
            res.vary("Origin");
            res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");

            if (req.method === "OPTIONS") {
                return res.status(204).end();
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = { createProjectCors };