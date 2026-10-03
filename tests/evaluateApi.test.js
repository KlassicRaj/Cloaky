import { describe, expect, it, vi } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");
const { createEvaluationService } = require("../src/services/evaluationService");

const projectKey = "public-project-key";
const allowedOrigin = "https://allowed.example";

const validBody = {
    browser: "Chrome",
    os: "Linux",
    deviceType: "desktop",
    language: "en-IN",
    timezone: "Asia/Kolkata",
    screen: { width: 1280, height: 720 },
};

const decision = {
    matched: true,
    ruleId: "rule-123",
    action: "redirect",
    destinationUrl: "https://example.com",
    fullscreenMode: "prompt",
    reason: "rule_matched",
};

function allowAllRateLimit(req, res, next) {
    return next();
}

function createTestApp(result = decision, { allowedOrigins = [allowedOrigin], project = {} } = {}) {
    const evaluationService = {
        evaluate: vi.fn().mockResolvedValue(result),
    };
    const projectRepository = {
        findByProjectKey: vi.fn().mockResolvedValue({
            id: "project-1",
            project_key: projectKey,
            allowed_origins: allowedOrigins,
            enabled: true,
            ...project,
        }),
    };

    return {
        app: createApp({ evaluationService, projectRepository, rateLimitMiddleware: allowAllRateLimit }),
        evaluationService,
        projectRepository,
    };
}

describe("POST /api/v1/evaluate", () => {
    it("exists and returns 400 for an invalid body", async () => {
        const { app } = createTestApp();

        await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send({ screen: { width: 0 } })
            .expect(400)
            .expect(({ body }) => expect(body.error).toBe("validation_error"));
    });

    it("returns 200 with the EvaluationService decision", async () => {
        const { app, evaluationService } = createTestApp();

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send(validBody)
            .expect(200);

        expect(response.body).toEqual(decision);
        expect(evaluationService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
            projectKey,
            clientInfo: expect.objectContaining({ browser: "Chrome", screen: validBody.screen }),
        }));
        expect(evaluationService.evaluate.mock.calls[0][0].request).toBeDefined();
    });

    it("does not return HTTP 500 when asynchronous event logging fails", async () => {
        const project = { id: "project-1", enabled: true };
        const projectRepository = {
            findByProjectKey: vi.fn().mockResolvedValue(project),
        };
        const eventLoggingService = {
            logEvaluationEvent: vi.fn().mockRejectedValue(new Error("private event database failure")),
        };
        const evaluationService = createEvaluationService({
            projectRepository,
            ruleRepository: { listByProjectId: vi.fn().mockResolvedValue([]) },
            clientIpService: { getClientIp: vi.fn().mockReturnValue("203.0.113.10") },
            geoIpService: { lookup: vi.fn().mockReturnValue({ country: null, region: null, city: null }) },
            clientInfoService: {
                normalizeClientInfo: vi.fn().mockReturnValue({
                    browser: null,
                    os: null,
                    deviceType: null,
                    language: null,
                    timezone: null,
                    screen: { width: null, height: null },
                }),
            },
            visitorIdentityService: { createVisitorId: vi.fn() },
            frequencyService: { checkAndRecord: vi.fn() },
            ruleEngine: {
                evaluateRules: vi.fn().mockReturnValue({
                    matched: false,
                    ruleId: null,
                    action: "none",
                    destinationUrl: null,
                    fullscreenMode: "off",
                    reason: "no_match",
                }),
            },
            eventLoggingService,
        });
        const testApp = createApp({
            evaluationService,
            projectRepository,
            rateLimitMiddleware: allowAllRateLimit,
        });

        const response = await request(testApp)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send(validBody)
            .expect(200);

        expect(response.body).toMatchObject({ matched: false, reason: "no_match" });
        expect(eventLoggingService.logEvaluationEvent).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(response.body)).not.toContain("private event database failure");
    });

    it("requires projectKey", async () => {
        const { app, evaluationService } = createTestApp();

        await request(app).post("/api/v1/evaluate").send(validBody).expect(400);
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });

    it.each([
        ["screen width", { screen: { width: 0 } }],
        ["screen height", { screen: { height: -1 } }],
        ["latitude", { browserGeo: { latitude: 90.1 } }],
        ["longitude", { browserGeo: { longitude: -180.1 } }],
        ["accuracy", { browserGeo: { accuracy: 0 } }],
    ])("rejects invalid %s", async (_field, values) => {
        const { app } = createTestApp();

        await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send({ ...validBody, ...values })
            .expect(400);
    });

    it.each(["ip", "country", "region", "city"])(
        "rejects unexpected server-derived field %s",
        async (field) => {
            const { app } = createTestApp();

            await request(app)
                .post("/api/v1/evaluate")
                .query({ projectKey })
                .send({ ...validBody, [field]: "client-controlled" })
                .expect(400);
        },
    );

    it("does not expose IP or visitorId fields from a service result", async () => {
        const internalResult = {
            ...decision,
            ip: "203.0.113.10",
            visitorId: "private-visitor-id",
        };
        const { app } = createTestApp(internalResult);

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send(validBody)
            .expect(200);

        expect(response.body).toEqual(decision);
        expect(JSON.stringify(response.body)).not.toContain("203.0.113.10");
        expect(JSON.stringify(response.body)).not.toContain("private-visitor-id");
    });

    it("maps project_not_found to 404", async () => {
        const { app } = createTestApp({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "project_not_found",
        });

        await request(app)
            .post("/api/v1/evaluate")
            .query({ projectKey })
            .send(validBody)
            .expect(404)
            .expect(({ body }) => expect(body.reason).toBe("project_not_found"));
    });

    it("maps unexpected service errors to internal_error", async () => {
        const { app } = createTestApp();
        const evaluationService = {
            evaluate: vi.fn().mockRejectedValue(new Error("sensitive internal failure")),
        };
        const testApp = createApp({
            evaluationService,
            projectRepository: {
                findByProjectKey: vi.fn().mockResolvedValue({
                    id: "project-1",
                    allowed_origins: [allowedOrigin],
                }),
            },
            rateLimitMiddleware: allowAllRateLimit,
        });

        const response = await request(testApp)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send(validBody)
            .expect(500);

        expect(response.body).toEqual({ error: "internal_error" });
        expect(JSON.stringify(response.body)).not.toContain("sensitive internal failure");
    });

    it("keeps the existing health endpoint available", async () => {
        const { app } = createTestApp();

        await request(app).get("/health").expect(200).expect(({ body }) => {
            expect(body).toMatchObject({ status: "ok", database: "ok" });
        });
    });

    it("returns exact-origin CORS headers for an allowed origin", async () => {
        const { app } = createTestApp();

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", allowedOrigin)
            .send(validBody)
            .expect(200);

        expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
        expect(response.headers.vary).toContain("Origin");
        expect(response.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
        expect(response.headers["access-control-allow-headers"]).toBe("Content-Type");
    });

    it("rejects a disallowed origin without reflecting it", async () => {
        const { app, evaluationService } = createTestApp();
        const arbitraryOrigin = "https://attacker.example";

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", arbitraryOrigin)
            .send(validBody)
            .expect(403);

        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
        expect(response.headers["access-control-allow-origin"]).not.toBe(arbitraryOrigin);
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });

    it("continues requests without an Origin and adds no CORS headers", async () => {
        const { app } = createTestApp();

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send(validBody)
            .expect(200);

        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("handles allowed OPTIONS preflight without invoking EvaluationService", async () => {
        const { app, evaluationService } = createTestApp();

        const response = await request(app)
            .options(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", allowedOrigin)
            .set("Access-Control-Request-Method", "POST")
            .expect(204);

        expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
        expect(response.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
        expect(response.headers["access-control-allow-headers"]).toBe("Content-Type");
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });

    it("rejects disallowed OPTIONS preflight", async () => {
        const { app, evaluationService } = createTestApp();

        const response = await request(app)
            .options(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", "https://attacker.example")
            .expect(403);

        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });

    it("returns 404 when an origin references a nonexistent project", async () => {
        const { app, projectRepository, evaluationService } = createTestApp();
        projectRepository.findByProjectKey.mockResolvedValue(null);

        await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", allowedOrigin)
            .send(validBody)
            .expect(404);
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });

    it("does not treat wildcard allowed_origins as allowing arbitrary origins", async () => {
        const { app } = createTestApp(decision, { allowedOrigins: ["*"] });

        const response = await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .set("Origin", "https://arbitrary.example")
            .send(validBody)
            .expect(403);

        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("rejects projectKey in the JSON body even when it is also in the query", async () => {
        const { app, evaluationService } = createTestApp();

        await request(app)
            .post(`/api/v1/evaluate?projectKey=${projectKey}`)
            .send({ ...validBody, projectKey })
            .expect(400);
        expect(evaluationService.evaluate).not.toHaveBeenCalled();
    });
});