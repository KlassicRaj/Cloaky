const { z } = require("zod");

const projectKeySchema = z.string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_-]+$/, "projectKey must use lowercase letters, numbers, underscores, or hyphens");

const projectOriginSchema = z.string().trim().min(1).max(500).transform((value, context) => {
    let url;

    try {
        url = new URL(value);
    } catch {
        context.addIssue({ code: "custom", message: "Origin must be a valid absolute HTTP or HTTPS origin" });
        return z.NEVER;
    }

    if (
        value === "*" ||
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        context.addIssue({ code: "custom", message: "Origin must contain only an HTTP or HTTPS origin" });
        return z.NEVER;
    }

    return url.origin;
});

const projectFields = {
    name: z.string().trim().min(1).max(150),
    projectKey: projectKeySchema,
    allowedOrigins: z.array(projectOriginSchema).max(100),
    enabled: z.boolean().optional(),
};

const createProjectSchema = z.object(projectFields).strict();

const updateProjectSchema = z.object({
    name: projectFields.name.optional(),
    allowedOrigins: projectFields.allowedOrigins.optional(),
    enabled: projectFields.enabled,
}).strict().refine((updates) => Object.keys(updates).length > 0, {
    message: "At least one project field must be provided",
});

const projectIdSchema = z.string().uuid();

module.exports = {
    createProjectSchema,
    projectIdSchema,
    projectKeySchema,
    projectOriginSchema,
    updateProjectSchema,
};