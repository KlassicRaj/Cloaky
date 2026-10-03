const { z } = require("zod");

const destinationUrlSchema = z.string().trim().min(1).transform((value, context) => {
    let url;

    try {
        url = new URL(value);
    } catch {
        context.addIssue({
            code: "custom",
            message: "Destination URL must be an absolute HTTP or HTTPS URL",
        });
        return z.NEVER;
    }

    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
        context.addIssue({
            code: "custom",
            message: "Destination URL must use HTTP or HTTPS",
        });
        return z.NEVER;
    }

    return url.toString();
});

function validateDestinationUrl(value) {
    return destinationUrlSchema.safeParse(value);
}

const ruleDestinationSchema = z.object({
    action: z.enum(["redirect", "open_new_tab", "none"]),
    destination_url: z.unknown().optional(),
}).strict().superRefine((rule, context) => {
    if (rule.action === "none") {
        if (rule.destination_url !== undefined && rule.destination_url !== null) {
            context.addIssue({
                code: "custom",
                path: ["destination_url"],
                message: "Rules with action none must not have a destination URL",
            });
        }
        return;
    }

    const validation = validateDestinationUrl(rule.destination_url);
    if (!validation.success) {
        for (const issue of validation.error.issues) {
            context.addIssue({
                code: "custom",
                path: ["destination_url"],
                message: issue.message,
            });
        }
    }
}).transform((rule) => ({
    action: rule.action,
    destination_url: rule.action === "none"
        ? null
        : validateDestinationUrl(rule.destination_url).data,
}));

module.exports = {
    destinationUrlSchema,
    ruleDestinationSchema,
    validateDestinationUrl,
};