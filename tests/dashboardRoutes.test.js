import { describe, expect, it } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");

describe("dashboard frontend routes", () => {
    const app = createApp({
        projectRepository: { findByProjectKey: async () => null },
        evaluationService: { evaluate: async () => ({ matched: false }) },
        requireAuthMiddleware: (req, res, next) => res.status(401).json({ error: "unauthorized" }),
        loginRateLimitMiddleware: (req, res, next) => next(),
        rateLimitMiddleware: (req, res, next) => next(),
    });

    it("serves the login and dashboard pages", async () => {
        const login = await request(app).get("/login").expect(200);
        expect(login.type).toBe("text/html");
        expect(login.text).toContain('id="login-form"');
        expect(login.text).toContain('id="password"');

        const dashboard = await request(app).get("/dashboard").expect(200);
        expect(dashboard.type).toBe("text/html");
        expect(dashboard.text).toContain('id="projects-list"');
        expect(dashboard.text).toContain('id="create-project-form"');
    });

    it("serves the project details shell without embedding management data", async () => {
        const response = await request(app)
            .get("/dashboard/project.html?id=8e5efb54-49f0-4ce4-b224-90f8365d8e20")
            .expect(200);

        expect(response.type).toBe("text/html");
        expect(response.text).toContain('id="project-name"');
        expect(response.text).toContain('id="test-rules-section"');
        expect(response.text).toContain('href="#test-rules-section"');
        expect(response.text).toContain('id="test-rules-form"');
        expect(response.text).toContain('id="condition-tree"');
        expect(response.text).toContain('id="create-rule-button"');
        expect(response.text).not.toContain("Browser geolocation simulation");
        expect(response.text).not.toContain('id="test-latitude"');
        expect(response.text).toContain("Project evaluation events will be available here.");
        expect(response.text).not.toContain("DATABASE_URL");
        expect(response.text).not.toContain("SESSION_SECRET");
    });

    it("serves only frontend assets through the public asset path", async () => {
        const script = await request(app).get("/assets/js/api.js").expect(200);
        expect(script.type).toContain("javascript");
        expect(script.text).toContain('credentials: "same-origin"');
        const ruleBuilder = await request(app).get("/assets/js/rule-builder.js").expect(200);
        expect(ruleBuilder.text).toContain("serializeConditions");
        const testRules = await request(app).get("/assets/js/test-rules.js").expect(200);
        expect(testRules.text).toContain("/test-rules");

        await request(app).get("/assets/src/server.js").expect(404);
        await request(app).get("/src/server.js").expect(404);
    });

    it("keeps management project APIs authenticated independently of public page routes", async () => {
        await request(app).get("/login").expect(200);
        await request(app).get("/dashboard").expect(200);
        await request(app).get("/api/projects").expect(401, { error: "unauthorized" });
        await request(app)
            .get("/api/projects/8e5efb54-49f0-4ce4-b224-90f8365d8e20/events")
            .expect(401, { error: "unauthorized" });
    });
});
