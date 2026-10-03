import { describe, expect, it, vi } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");

const projectKey = "redirect-project-key";

function redirectDecision(destinationUrl = "https://example.com/path") {
    return {
        matched: true,
        ruleId: "rule-redirect",
        action: "redirect",
        destinationUrl,
        fullscreenMode: "off",
        reason: "rule_matched",
    };
}

function allowAllRateLimit(req, res, next) {
    return next();
}

function createTestApp(decision = redirectDecision(), evaluate = vi.fn().mockResolvedValue(decision)) {
    const evaluationService = { evaluate };
    const projectRepository = { findByProjectKey: vi.fn() };
    const app = createApp({
        evaluationService,
        projectRepository,
        rateLimitMiddleware: allowAllRateLimit,
    });

    return { app, evaluationService };
}

describe("GET /r/:projectKey", () => {
    it("returns 302 with the validated HTTPS destination", async () => {
        const { app } = createTestApp(redirectDecision("https://example.com/path"));

        const response = await request(app).get(`/r/${projectKey}`).expect(302);

        expect(response.headers.location).toBe("https://example.com/path");
        expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("redirects to a valid HTTP destination", async () => {
        const { app } = createTestApp(redirectDecision("http://example.com/path"));

        await request(app)
            .get(`/r/${projectKey}`)
            .expect(302)
            .expect("Location", "http://example.com/path");
    });

    it.each([
        ["https://example.com", "https://example.com/?_fs=1"],
        ["https://example.com/page?foo=bar", "https://example.com/page?foo=bar&_fs=1"],
        ["https://example.com/page?foo=bar#section", "https://example.com/page?foo=bar&_fs=1#section"],
        ["https://example.com/page?_fs=0", "https://example.com/page?_fs=1"],
    ])("adds _fs=1 to validated prompt redirect destinations: %s", async (destinationUrl, location) => {
        const { app } = createTestApp({
            ...redirectDecision(destinationUrl),
            fullscreenMode: "prompt",
        });

        await request(app)
            .get(`/r/${projectKey}`)
            .expect(302)
            .expect("Location", location);
    });

    it("leaves fullscreen-off redirect locations unchanged", async () => {
        const destinationUrl = "https://example.com/page?foo=bar#section";
        const { app } = createTestApp(redirectDecision(destinationUrl));

        await request(app)
            .get(`/r/${projectKey}`)
            .expect(302)
            .expect("Location", destinationUrl);
    });

    it.each([
        ["no match", { matched: false, action: "none", reason: "no_match" }],
        ["none action", { matched: true, action: "none", reason: "rule_matched" }],
        ["frequency limited", { matched: true, action: "none", reason: "frequency_limited" }],
        ["frequency unavailable", { matched: true, action: "none", reason: "frequency_unavailable" }],
        ["malformed decision", null],
    ])("does not redirect for %s", async (_scenario, partialDecision) => {
        const decision = partialDecision && {
            ruleId: "rule-1",
            destinationUrl: "https://example.com/ignored",
            fullscreenMode: "off",
            ...partialDecision,
        };
        const { app } = createTestApp(decision);

        const response = await request(app).get(`/r/${projectKey}`).expect(204);

        expect(response.headers.location).toBeUndefined();
        expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("returns 404 when the project is not found", async () => {
        const { app } = createTestApp({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "project_not_found",
        });

        await request(app)
            .get(`/r/${projectKey}`)
            .expect(404)
            .expect(({ body }) => expect(body).toEqual({ error: "project_not_found" }));
    });

    it("returns a safe 404 when the project is disabled", async () => {
        const { app } = createTestApp({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "project_disabled",
        });

        await request(app)
            .get(`/r/${projectKey}`)
            .expect(404)
            .expect(({ body }) => expect(body).toEqual({ error: "project_disabled" }));
    });

    it("does not redirect when the destination is missing", async () => {
        const { app } = createTestApp(redirectDecision(null));

        const response = await request(app).get(`/r/${projectKey}`).expect(204);
        expect(response.headers.location).toBeUndefined();
    });

    it.each([
        "javascript:alert(1)",
        "data:text/html,unsafe",
        "vbscript:alert(1)",
        "file:///etc/passwd",
        "blob:https://example.com/identifier",
        "/relative/path",
    ])("never redirects to unsafe destination %s", async (destinationUrl) => {
        const { app } = createTestApp({
            ...redirectDecision(destinationUrl),
            fullscreenMode: "prompt",
        });

        const response = await request(app).get(`/r/${projectKey}`).expect(204);
        expect(response.headers.location).toBeUndefined();
    });

    it("returns a safe internal error response when EvaluationService fails", async () => {
        const evaluationService = {
            evaluate: vi.fn().mockRejectedValue(new Error("database URL and secret details")),
        };
        const { app } = createTestApp(undefined, evaluationService.evaluate);

        const response = await request(app).get(`/r/${projectKey}`).expect(500);

        expect(response.body).toEqual({ error: "internal_error" });
        expect(JSON.stringify(response.body)).not.toContain("database URL");
        expect(response.headers.location).toBeUndefined();
    });

    it("delegates the path project key and request to EvaluationService", async () => {
        const evaluate = vi.fn().mockResolvedValue(redirectDecision("https://example.com/landing"));
        const { app, evaluationService } = createTestApp(undefined, evaluate);

        await request(app)
            .get(`/r/${projectKey}?ip=8.8.8.8&country=US`)
            .set("Accept-Language", "en-GB,en;q=0.9")
            .expect(302);

        const [{ projectKey: receivedProjectKey, request: receivedRequest, clientInfo }] =
            evaluationService.evaluate.mock.calls[0];
        expect(receivedProjectKey).toBe(projectKey);
        expect(receivedRequest.params.projectKey).toBe(projectKey);
        expect(clientInfo).toEqual({ language: "en-GB" });
        expect(clientInfo).not.toHaveProperty("ip");
        expect(clientInfo).not.toHaveProperty("geo");
    });
});