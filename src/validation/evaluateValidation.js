const { z } = require("zod");

const optionalClientString = (maximumLength) => z.string().max(maximumLength).optional();

const evaluateRequestSchema = z.object({
    projectKey: z.string().trim().min(1).max(200),
    browser: optionalClientString(100),
    os: optionalClientString(100),
    deviceType: optionalClientString(50),
    language: optionalClientString(100),
    timezone: optionalClientString(100),
    screen: z.object({
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
    }).strict().optional(),
    browserGeo: z.object({
        latitude: z.number().finite().min(-90).max(90).optional(),
        longitude: z.number().finite().min(-180).max(180).optional(),
        accuracy: z.number().finite().positive().optional(),
    }).strict().optional(),
}).strict();

module.exports = { evaluateRequestSchema };