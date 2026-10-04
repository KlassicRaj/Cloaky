import { describe, expect, it } from "vitest";

const { spawnSync } = require("node:child_process");

function checkProductionEnvironment(
    overrides = {},
    script = "require('./src/config/env')",
) {
    const env = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgresql://user:password@postgres:5432/visitor_routing",
        REDIS_URL: "redis://redis:6379",
        ADMIN_USERNAME: "production-admin",
        SESSION_SECRET: "distinct-session-secret-with-at-least-32-bytes",
        IP_HASH_SECRET: "different-ip-hash-secret-with-more-than-32-bytes",
        BASE_URL: "https://routing.example.com",
        COOKIE_SECURE: "true",
        ...overrides,
    };

    return spawnSync(process.execPath, ["-e", script], {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
    });
}

describe("production environment validation", () => {
    it("rejects production with insecure cookies", () => {
        const result = checkProductionEnvironment({ COOKIE_SECURE: "false" });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("COOKIE_SECURE");
        expect(result.stderr).not.toContain("distinct-session-secret");
    });

    it("rejects a weak production IP hash secret", () => {
        const result = checkProductionEnvironment({ IP_HASH_SECRET: "short" });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("IP_HASH_SECRET");
        expect(result.stderr).not.toContain("short");
    });

    it("rejects reuse of the session secret for IP hashing", () => {
        const secret = "one-secret-must-not-serve-both-security-purposes";
        const result = checkProductionEnvironment({
            SESSION_SECRET: secret,
            IP_HASH_SECRET: secret,
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Must be distinct from SESSION_SECRET");
        expect(result.stderr).not.toContain(secret);
    });

    it("rejects an HTTP public base URL in production", () => {
        const result = checkProductionEnvironment({
            BASE_URL: "http://routing.example.com",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("BASE_URL");
        expect(result.stderr).not.toContain("routing.example.com");
    });

    it("reads the externally supplied production port and permits an optional GeoIP path", () => {
        const result = checkProductionEnvironment(
            { PORT: "43127", GEOIP_DATABASE_PATH: "" },
            "process.stdout.write(String(require('./src/config/env').PORT))",
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toBe("43127");
    });
});
