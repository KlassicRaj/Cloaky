const { isIP } = require("node:net");
const { z } = require("zod");
const { SUPPORTED_RULE_FIELDS, SUPPORTED_RULE_OPERATORS } = require("../domain/rule");
const { ruleDestinationSchema, validateDestinationUrl } = require("./urlValidation");

const numericFields = new Set([
    "screen_width",
    "screen_height",
]);
const stringOperators = new Set(["contains", "starts_with"]);
const numericOperators = new Set(["greater_than", "less_than"]);
const frequencyModes = ["cooldown", "return_after"];
const maxFrequencySeconds = 1073741823;

function validIpv4Cidr(value) {
    if (typeof value !== "string") return false;

    const parts = value.split("/");
    if (
        parts.length !== 2 ||
        isIP(parts[0]) !== 4 ||
        !/^\d{1,2}$/.test(parts[1])
    ) {
        return false;
    }

    return Number(parts[1]) <= 32;
}

function conditionValueIssue(condition) {
    const { field, operator, value } = condition;

    if (value === undefined || value === null) {
        return "Condition value is required";
    }

    if (numericOperators.has(operator)) {
        if (!numericFields.has(field)) return "Numeric comparisons require a numeric field";
        if (typeof value !== "number" || !Number.isFinite(value)) return "Condition value must be a finite number";
        if (field === "screen_width" || field === "screen_height") {
            if (value <= 0) return "Condition value must be positive";
        }
        return null;
    }

    if (field === "ip" && operator === "cidr") {
        return validIpv4Cidr(value) ? null : "CIDR conditions require a valid IPv4 CIDR";
    }

    if (operator === "cidr") return "CIDR operator is supported only for the ip field";

    if (numericFields.has(field)) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return "Numeric condition fields require a finite number";
        }
        if ((field === "screen_width" || field === "screen_height") && value <= 0) {
            return "Condition value must be positive";
        }
        if (stringOperators.has(operator)) return "String operators cannot be used with numeric fields";
        return null;
    }

    if (typeof value !== "string" || value.trim() === "") {
        return "Condition value must be a non-empty string";
    }

    if (field === "ip" && ["equals", "not_equals"].includes(operator) && isIP(value) === 0) {
        return "IP equality conditions require a valid IP address";
    }

    return null;
}

let ruleConditionSchema;

const leafConditionSchema = z.object({
    field: z.enum(SUPPORTED_RULE_FIELDS),
    operator: z.enum(SUPPORTED_RULE_OPERATORS),
    value: z.unknown(),
}).strict().superRefine((condition, context) => {
    const message = conditionValueIssue(condition);
    if (message) {
        context.addIssue({ code: "custom", path: ["value"], message });
    }
});

const logicalConditionSchema = z.object({
    operator: z.enum(["AND", "OR"]),
    conditions: z.array(z.lazy(() => ruleConditionSchema)).min(1).max(50),
}).strict();

ruleConditionSchema = z.union([logicalConditionSchema, leafConditionSchema]);

const prioritySchema = z.number().int().min(0).max(1000000);
const frequencySecondsSchema = z.number().int().positive().max(maxFrequencySeconds);

const createRuleSchema = z.object({
    name: z.string().trim().min(1).max(150),
    priority: prioritySchema.default(0),
    enabled: z.boolean().default(true),
    conditions: ruleConditionSchema,
    action: z.enum(["none", "redirect", "open_new_tab"]),
    destinationUrl: z.unknown().optional().nullable(),
    frequencyEnabled: z.boolean().default(false),
    frequencySeconds: frequencySecondsSchema.optional().nullable(),
    frequencyMode: z.enum(frequencyModes).optional().nullable(),
    fullscreenMode: z.enum(["off", "prompt"]),
}).strict().superRefine((rule, context) => {
    const destination = ruleDestinationSchema.safeParse({
        action: rule.action,
        destination_url: rule.destinationUrl,
    });
    if (!destination.success) {
        for (const issue of destination.error.issues) {
            context.addIssue({
                code: "custom",
                path: ["destinationUrl", ...issue.path.filter((part) => part !== "destination_url")],
                message: issue.message,
            });
        }
    }

    if (rule.frequencyEnabled) {
        if (!Number.isInteger(rule.frequencySeconds) || rule.frequencySeconds <= 0) {
            context.addIssue({ code: "custom", path: ["frequencySeconds"], message: "A positive integer is required when frequency is enabled" });
        }
        if (!frequencyModes.includes(rule.frequencyMode)) {
            context.addIssue({ code: "custom", path: ["frequencyMode"], message: "A valid frequency mode is required when frequency is enabled" });
        }
    } else if (
        (rule.frequencySeconds !== undefined && rule.frequencySeconds !== null) ||
        (rule.frequencyMode !== undefined && rule.frequencyMode !== null)
    ) {
        context.addIssue({ code: "custom", path: ["frequencyEnabled"], message: "Frequency settings require frequencyEnabled to be true" });
    }
}).transform((rule) => {
    const destination = ruleDestinationSchema.parse({
        action: rule.action,
        destination_url: rule.destinationUrl,
    });

    return {
        ...rule,
        destinationUrl: destination.destination_url,
        frequencyEnabled: rule.frequencyEnabled,
        frequencySeconds: rule.frequencyEnabled ? rule.frequencySeconds : null,
        frequencyMode: rule.frequencyEnabled ? rule.frequencyMode : null,
    };
});

const updateRuleSchema = z.object({
    name: z.string().trim().min(1).max(150).optional(),
    priority: prioritySchema.optional(),
    enabled: z.boolean().optional(),
    conditions: ruleConditionSchema.optional(),
    action: z.enum(["none", "redirect", "open_new_tab"]).optional(),
    destinationUrl: z.unknown().optional().nullable(),
    frequencyEnabled: z.boolean().optional(),
    frequencySeconds: frequencySecondsSchema.optional().nullable(),
    frequencyMode: z.enum(frequencyModes).optional().nullable(),
    fullscreenMode: z.enum(["off", "prompt"]).optional(),
}).strict().superRefine((updates, context) => {
    if (Object.keys(updates).length === 0) {
        context.addIssue({ code: "custom", message: "At least one rule field must be provided" });
    }

    if (updates.action !== undefined && updates.action === "none") {
        if (updates.destinationUrl !== undefined && updates.destinationUrl !== null) {
            context.addIssue({ code: "custom", path: ["destinationUrl"], message: "Action none cannot have a destination URL" });
        }
    } else if (updates.destinationUrl !== undefined && updates.destinationUrl !== null) {
        const validation = validateDestinationUrl(updates.destinationUrl);
        if (!validation.success) {
            context.addIssue({ code: "custom", path: ["destinationUrl"], message: "Destination URL must use HTTP or HTTPS" });
        }
    }

    if (updates.frequencyEnabled === false && (
        (updates.frequencySeconds !== undefined && updates.frequencySeconds !== null) ||
        (updates.frequencyMode !== undefined && updates.frequencyMode !== null)
    )) {
        context.addIssue({ code: "custom", path: ["frequencyEnabled"], message: "Disabled frequency cannot include frequency settings" });
    }
});

const projectIdSchema = z.string().uuid();
const ruleIdSchema = z.string().uuid();

module.exports = {
    createRuleSchema,
    projectIdSchema,
    ruleConditionSchema,
    ruleIdSchema,
    updateRuleSchema,
};