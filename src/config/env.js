const { z } = require("zod");
const path = require("node:path");
const isTestEnvironment = process.env.NODE_ENV === "test";

require("dotenv").config({
    path: path.resolve(process.cwd(), isTestEnvironment ? ".env.test" : ".env"),
    override: isTestEnvironment,
});

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1),

    REDIS_URL: z.string().min(1),

    ADMIN_USERNAME: z.string().min(1),

    ADMIN_PASSWORD_HASH: z.string().optional().default(""),

    SESSION_SECRET: z.string().optional().default(""),

    IP_HASH_SECRET: z.string().optional().default(""),

    GEOIP_DATABASE_PATH: z.string().optional().default(""),

    BASE_URL: z.string().url(),

    COOKIE_SECURE: z
        .string()
        .transform((value) => value.toLowerCase() === "true")
        .default("false"),

    TRUSTED_PROXIES: z.string().optional().default(""),

    EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

if (
    parsed.data.NODE_ENV !== "test" &&
    Buffer.byteLength(parsed.data.SESSION_SECRET, "utf8") < 32
) {
    console.error("Invalid environment configuration:");
    console.error({ SESSION_SECRET: ["Must contain at least 32 bytes outside test mode"] });
    process.exit(1);
}

module.exports = parsed.data;