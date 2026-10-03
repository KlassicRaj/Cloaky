const { z } = require("zod");

const loginRequestSchema = z.object({
    username: z.string().trim().min(1).max(150),
    password: z.string().min(1).max(1024),
}).strict();

module.exports = { loginRequestSchema };