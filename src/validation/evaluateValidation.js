const { z } = require("zod");

const optionalClientString = (maximumLength) => z.string().max(maximumLength).optional();

const evaluateProjectKeySchema = z.string().trim().min(1).max(200);

const evaluateRequestSchema = z.object({
    browser: optionalClientString(100),
    os: optionalClientString(100),
    deviceType: optionalClientString(50),
    language: optionalClientString(100),
    timezone: optionalClientString(100),
    screen: z.object({
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
    }).strict().optional(),
}).strict();

module.exports = { evaluateProjectKeySchema, evaluateRequestSchema };