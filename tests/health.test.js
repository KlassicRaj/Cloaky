import { describe, expect, it, vi } from "vitest";

const express = require("express");
const request = require("supertest");
const { createHealthRouter } = require("../src/routes/health");

function healthApp({ database, redisClient }) {
    const app = express();
    app.use(createHealthRouter({ database, redisClient }));
    return app;
}

describe("dependency health endpoint", () => {
    it("reports PostgreSQL and Redis readiness", async () => {
        const database = { raw: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) };
        const redisClient = { ping: vi.fn().mockResolvedValue("PONG") };

        const response = await request(healthApp({ database, redisClient }))
            .get("/health")
            .expect(200);

        expect(response.body).toEqual({
            status: "ok",
            database: "ok",
            redis: "ok",
        });
        expect(database.raw).toHaveBeenCalledWith("SELECT 1");
        expect(redisClient.ping).toHaveBeenCalledTimes(1);
    });

    it("returns sanitized 503 if either required dependency is unavailable", async () => {
        const database = { raw: vi.fn().mockResolvedValue({}) };
        const redisClient = {
            ping: vi.fn().mockRejectedValue(new Error("private redis URL and password")),
        };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await request(healthApp({ database, redisClient }))
            .get("/health")
            .expect(503);

        expect(response.body).toEqual({
            status: "error",
            database: "ok",
            redis: "unavailable",
        });
        expect(JSON.stringify(response.body)).not.toContain("private");
        expect(consoleError).toHaveBeenCalledWith("Dependency health check failed.");
        consoleError.mockRestore();
    });

    it("reports PostgreSQL unavailable without exposing the connection failure", async () => {
        const database = {
            raw: vi.fn().mockRejectedValue(new Error("private PostgreSQL URL and password")),
        };
        const redisClient = { ping: vi.fn().mockResolvedValue("PONG") };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await request(healthApp({ database, redisClient }))
            .get("/health")
            .expect(503);

        expect(response.body).toEqual({
            status: "error",
            database: "unavailable",
            redis: "ok",
        });
        expect(JSON.stringify(response.body)).not.toContain("private");
        consoleError.mockRestore();
    });
});
