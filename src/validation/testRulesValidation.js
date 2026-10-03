const { isIP } = require("node:net");
const { z } = require("zod");

const optionalText = (maxLength) => z.string().trim().min(1).max(maxLength).optional();
const optionalCoordinate = (minimum, maximum) => z.number().finite().min(minimum).max(maximum).optional();
const positiveNumber = z.number().finite().positive().optional();

const testVisitorSchema = z.object({
    ip: z.string().refine((value) => isIP(value) !== 0, "IP address must be valid").optional(),
    geo: z.object({
        country: optionalText(100),
        region: optionalText(100),
        city: optionalText(150),
    }).strict().optional(),
    browser: optionalText(100),
    os: optionalText(100),
    deviceType: z.enum(["mobile", "desktop", "tablet"]).optional(),
    language: optionalText(100),
    timezone: optionalText(100),
    screen: z.object({
        width: positiveNumber,
        height: positiveNumber,
    }).strict().optional(),
}).strict();

const frequencySimulationSchema = z.object({
    visit: z.enum(["first_visit", "returning"]),
    secondsSincePreviousTrigger: z.number().int().min(0).max(1073741823).optional(),
}).strict().superRefine((simulation, context) => {
    if (
        simulation.visit === "first_visit" &&
        simulation.secondsSincePreviousTrigger !== undefined
    ) {
        context.addIssue({
            code: "custom",
            path: ["secondsSincePreviousTrigger"],
            message: "Previous trigger time is only valid for returning visitors",
        });
    }
});

const testRulesRequestSchema = z.object({
    visitor: testVisitorSchema,
    frequencySimulation: frequencySimulationSchema.default({ visit: "first_visit" }),
}).strict();

module.exports = {
    frequencySimulationSchema,
    testRulesRequestSchema,
    testVisitorSchema,
};
