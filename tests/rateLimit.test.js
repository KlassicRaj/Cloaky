import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { randomUUID } = require("node:crypto");
const express = require("express");
const request = require("supertest");
const env = require("../src/config/env");
const redis = require("../src/config/redis");
const visitorIdentityService = require("../src/services/visitorIdentityService");
const { createRateLimit } = require("../src/middleware/rateLimit");

const namespace = `rate_limit:test:${randomUUID()}`;
const originalSecret = env.IP_HASH_SECRET;

function createTestApp({
    limit = 100,
    windowSeconds = 60,
    clientIp = "203.0.113.10",
    keyPrefix = `${namespace}:${randomUUID()}`,
    redisClient = redis,
} = {}) {
    const clientIpService = {
        getClientIp: vi.fn().mockImplementation((req) => req.headers["x-test-client-ip"] || clientIp),
    };
    const limiter = createRateLimit({
        redisClient,
        clientIpService,
        visitorIdentityService,
        limit,
        windowSeconds,
        keyPrefix,
    });
    const app = express();
    app.post("/api/v1/evaluate", limiter, (req, res) => res.status(200).json({ allowed: true }));

    return { app, clientIpService, keyPrefix };
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deleteTestKeys() {
    let cursor = "0";
    const keysToDelete = [];

    do {
        const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            `${namespace}:*`,
            "COUNT",
            100,
        );
        cursor = nextCursor;
        keysToDelete.push(...keys);
    } while (cursor !== "0");

    if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete);
    }
}

async function findTestKeys(pattern) {
    let cursor = "0";
    const matchingKeys = [];

    do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 10);
        cursor = nextCursor;
        matchingKeys.push(...keys);
    } while (cursor !== "0");

    return matchingKeys;
}

beforeAll(async () => {
    env.IP_HASH_SECRET = "rate-limit-test-only-secret";
    await redis.ping();
});

afterAll(async () => {
    try {
        await deleteTestKeys();
    } finally {
        env.IP_HASH_SECRET = originalSecret;
        await redis.quit();
    }
});

describe("evaluation rate limit", () => {
    it("allows requests below the configured limit", async () => {
        const { app } = createTestApp({ limit: 3 });

        await request(app).post("/api/v1/evaluate").expect(200);
        await request(app).post("/api/v1/evaluate").expect(200);
    });

    it("allows the request that reaches the configured limit", async () => {
        const { app } = createTestApp({ limit: 2 });

        await request(app).post("/api/v1/evaluate").expect(200);
        await request(app).post("/api/v1/evaluate").expect(200);
    });

    it("returns 429 with a normalized response and Retry-After above the limit", async () => {
        const { app } = createTestApp({ limit: 1 });

        await request(app).post("/api/v1/evaluate").expect(200);
        const response = await request(app).post("/api/v1/evaluate").expect(429);

        expect(response.body).toEqual({ error: "rate_limit_exceeded" });
        expect(response.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
    });

    it("allows requests again after the one-minute window expires", async () => {
        const { app } = createTestApp({ limit: 1, windowSeconds: 1 });

        await request(app).post("/api/v1/evaluate").expect(200);
        await request(app).post("/api/v1/evaluate").expect(429);
        await wait(1150);
        await request(app).post("/api/v1/evaluate").expect(200);
    });

    it("does not allow concurrent requests to bypass the limit", async () => {
        const { app } = createTestApp({ limit: 4 });
        const responses = await Promise.all(
            Array.from({ length: 20 }, () => request(app).post("/api/v1/evaluate")),
        );

        expect(responses.filter(({ status }) => status === 200)).toHaveLength(4);
        expect(responses.filter(({ status }) => status === 429)).toHaveLength(16);
    });

    it("fails open when Redis is unavailable", async () => {
        const redisClient = { eval: vi.fn().mockRejectedValue(new Error("connection failed")) };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { app } = createTestApp({ limit: 1, redisClient });

        await request(app).post("/api/v1/evaluate").expect(200);
        expect(consoleError).toHaveBeenCalledWith(
            "Rate limiter unavailable; allowing evaluation request.",
        );
        consoleError.mockRestore();
    });

    it("stores the HMAC identity in Redis keys and never the raw IP", async () => {
        const clientIp = "203.0.113.77";
        const { app, keyPrefix } = createTestApp({ limit: 2, clientIp });

        await request(app).post("/api/v1/evaluate").expect(200);

        const keys = await findTestKeys(`${keyPrefix}:*`);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe(`${keyPrefix}:${visitorIdentityService.createVisitorId(clientIp)}`);
        expect(keys[0]).not.toContain(clientIp);
    });

    it("keeps limits independent for different server-derived IPs", async () => {
        const { app } = createTestApp({ limit: 1 });

        await request(app).post("/api/v1/evaluate").set("X-Test-Client-IP", "203.0.113.21").expect(200);
        await request(app).post("/api/v1/evaluate").set("X-Test-Client-IP", "203.0.113.22").expect(200);
        await request(app).post("/api/v1/evaluate").set("X-Test-Client-IP", "203.0.113.21").expect(429);
    });

    it("does not put rate limiting on the health path", async () => {
        const { app } = createTestApp({ limit: 1 });
        app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

        await request(app).get("/health").expect(200);
        await request(app).get("/health").expect(200);
    });
});