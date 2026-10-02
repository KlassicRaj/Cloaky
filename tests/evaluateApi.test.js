import { describe, expect, it, vi } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");

const validBody = {
    projectKey: "public-project-key",
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

function createTestApp(result = decision) {
    const evaluationService = {
        evaluate: vi.fn().mockResolvedValue(result),
    };

    return {
        app: createApp({ evaluationService }),
        evaluationService,
    };
}

describe("POST /api/v1/evaluate", () => {
    it("exists and returns 400 for an invalid body", async () => {
        const { app } = createTestApp();

        await request(app)
            .post("/api/v1/evaluate")
            .send({})
            .expect(400)
            .expect(({ body }) => expect(body.error).toBe("validation_error"));
    });

    it("returns 200 with the EvaluationService decision", async () => {
        const { app, evaluationService } = createTestApp();

        const response = await request(app).post("/api/v1/evaluate").send(validBody).expect(200);

        expect(response.body).toEqual(decision);
        expect(evaluationService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
            projectKey: "public-project-key",
            clientInfo: expect.objectContaining({ browser: "Chrome", screen: validBody.screen }),
        }));
        expect(evaluationService.evaluate.mock.calls[0][0].request).toBeDefined();
    });

    it("requires projectKey", async () => {
        const { app, evaluationService } = createTestApp();

        await request(app).post("/api/v1/evaluate").send({ browser: "Chrome" }).expect(400);
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

        await request(app).post("/api/v1/evaluate").send({ ...validBody, ...values }).expect(400);
    });

    it.each(["ip", "country", "region", "city"])(
        "rejects unexpected server-derived field %s",
        async (field) => {
            const { app } = createTestApp();

            await request(app)
                .post("/api/v1/evaluate")
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

        const response = await request(app).post("/api/v1/evaluate").send(validBody).expect(200);

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
            .send(validBody)
            .expect(404)
            .expect(({ body }) => expect(body.reason).toBe("project_not_found"));
    });

    it("maps unexpected service errors to internal_error", async () => {
        const { app } = createTestApp();
        const evaluationService = {
            evaluate: vi.fn().mockRejectedValue(new Error("sensitive internal failure")),
        };
        const testApp = createApp({ evaluationService });

        const response = await request(testApp).post("/api/v1/evaluate").send(validBody).expect(500);

        expect(response.body).toEqual({ error: "internal_error" });
        expect(JSON.stringify(response.body)).not.toContain("sensitive internal failure");
    });

    it("keeps the existing health endpoint available", async () => {
        const { app } = createTestApp();

        await request(app).get("/health").expect(200).expect(({ body }) => {
            expect(body).toMatchObject({ status: "ok", database: "ok" });
        });
    });
});