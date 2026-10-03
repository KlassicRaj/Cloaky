import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { randomUUID } = require("node:crypto");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../src/server");
const env = require("../src/config/env");
const db = require("../src/config/db");
const projectRepository = require("../src/repositories/projectRepository");
const ruleRepository = require("../src/repositories/ruleRepository");
const eventRepository = require("../src/repositories/eventRepository");
const userRepository = require("../src/repositories/userRepository");
const { createProjectService } = require("../src/services/projectService");
const { createConfigCacheService } = require("../src/services/configCacheService");

const projectId = "8e5efb54-49f0-4ce4-b224-90f8365d8e20";
const projectDto = {
    id: projectId,
    userId: "owner-1",
    name: "Initial project",
    projectKey: "initial-project",
    allowedOrigins: ["https://example.com"],
    enabled: true,
    createdAt: "2026-10-03T12:00:00.000Z",
    updatedAt: "2026-10-03T12:00:00.000Z",
};

function fakeProjectService(overrides = {}) {
    return {
        list: vi.fn().mockResolvedValue([projectDto]),
        create: vi.fn().mockResolvedValue(projectDto),
        getById: vi.fn().mockResolvedValue(projectDto),
        updateById: vi.fn().mockResolvedValue(projectDto),
        deleteById: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function createTestApp(projectService = fakeProjectService()) {
    return {
        app: createApp({
            projectService,
            evaluationService: { evaluate: vi.fn() },
            projectRepository: { findByProjectKey: vi.fn() },
            requireAuthMiddleware: (req, res, next) => {
                req.userId = "owner-1";
                next();
            },
            rateLimitMiddleware: (req, res, next) => next(),
        }),
        projectService,
    };
}

const validCreateInput = {
    name: "Campaign project",
    projectKey: "campaign-project_2",
    allowedOrigins: ["https://example.com", "http://localhost:5173"],
};

let cascadeUser;
let cascadeProject;

beforeAll(async () => {
    await db.migrate.latest({ directory: path.resolve(process.cwd(), "src/db/migrations") });
    cascadeUser = await userRepository.create({
        username: `project-api-cascade-${randomUUID()}`,
        password_hash: "test-only-hash",
    });
});

afterAll(async () => {
    if (cascadeProject) {
        await projectRepository.deleteById(cascadeProject.id);
    }
    if (cascadeUser) {
        await userRepository.deleteById(cascadeUser.id);
    }
    await db.destroy();
});

describe("Project API", () => {
    it("creates a valid project", async () => {
        const service = fakeProjectService();
        const { app } = createTestApp(service);

        const response = await request(app).post("/api/projects").send(validCreateInput).expect(201);

        expect(response.body).toEqual(projectDto);
        expect(service.create).toHaveBeenCalledWith(validCreateInput, "owner-1");
    });

    it.each([
        ["missing name", { ...validCreateInput, name: " " }],
        ["missing project key", { name: "Name", allowedOrigins: [] }],
        ["missing allowed origins", { name: "Name", projectKey: "key" }],
        ["unsafe key", { ...validCreateInput, projectKey: "bad/key" }],
        ["uppercase key", { ...validCreateInput, projectKey: "BadKey" }],
        ["overlong key", { ...validCreateInput, projectKey: "a".repeat(101) }],
        ["invalid enabled", { ...validCreateInput, enabled: "true" }],
        ["client user ID", { ...validCreateInput, userId: "client-selected-user" }],
    ])("rejects %s during creation", async (_case, body) => {
        const service = fakeProjectService();
        const { app } = createTestApp(service);

        await request(app).post("/api/projects").send(body).expect(400);
        expect(service.create).not.toHaveBeenCalled();
    });

    it.each([
        "*",
        "javascript:alert(1)",
        "data:text/html,unsafe",
        "/relative",
        "https://example.com/path",
        "https://example.com?query=1",
        "https://example.com#fragment",
        "not a URL",
    ])("rejects invalid allowed origin %s", async (origin) => {
        const { app, projectService } = createTestApp();

        await request(app)
            .post("/api/projects")
            .send({ ...validCreateInput, allowedOrigins: [origin] })
            .expect(400);
        expect(projectService.create).not.toHaveBeenCalled();
    });

    it("rejects non-array allowedOrigins", async () => {
        const { app, projectService } = createTestApp();

        await request(app)
            .post("/api/projects")
            .send({ ...validCreateInput, allowedOrigins: "https://example.com" })
            .expect(400);
        expect(projectService.create).not.toHaveBeenCalled();
    });

    it("maps a project key uniqueness violation to 409", async () => {
        const service = fakeProjectService({
            create: vi.fn().mockRejectedValue(Object.assign(new Error("database detail"), { code: "23505" })),
        });
        const { app } = createTestApp(service);

        const response = await request(app).post("/api/projects").send(validCreateInput).expect(409);
        expect(response.body).toEqual({ error: "project_key_already_exists" });
        expect(JSON.stringify(response.body)).not.toContain("database detail");
    });

    it("lists projects from the configured project service", async () => {
        const service = fakeProjectService();
        const { app } = createTestApp(service);

        await request(app).get("/api/projects").expect(200, [projectDto]);
        expect(service.list).toHaveBeenCalledTimes(1);
    });

    it("gets an existing project by UUID", async () => {
        const { app, projectService } = createTestApp();

        await request(app).get(`/api/projects/${projectId}`).expect(200, projectDto);
        expect(projectService.getById).toHaveBeenCalledWith(projectId, "owner-1");
    });

    it("rejects an invalid project UUID", async () => {
        const { app, projectService } = createTestApp();

        await request(app).get("/api/projects/not-a-uuid").expect(400);
        expect(projectService.getById).not.toHaveBeenCalled();
    });

    it("returns 404 for a nonexistent project", async () => {
        const { app } = createTestApp(fakeProjectService({ getById: vi.fn().mockResolvedValue(null) }));

        await request(app)
            .get(`/api/projects/${projectId}`)
            .expect(404)
            .expect(({ body }) => expect(body).toEqual({ error: "project_not_found" }));
    });

    it.each([
        [{ name: "Renamed" }, { name: "Renamed" }],
        [{ allowedOrigins: ["https://new.example"] }, { allowedOrigins: ["https://new.example"] }],
        [{ enabled: false }, { enabled: false }],
    ])("updates allowed project fields", async (body, expected) => {
        const result = { ...projectDto, ...expected };
        const service = fakeProjectService({ updateById: vi.fn().mockResolvedValue(result) });
        const { app } = createTestApp(service);

        await request(app).patch(`/api/projects/${projectId}`).send(body).expect(200, result);
        expect(service.updateById).toHaveBeenCalledWith(projectId, body, "owner-1");
    });

    it.each([
        { name: " " },
        { allowedOrigins: ["*"] },
        { allowedOrigins: ["https://example.com/path"] },
        { enabled: 1 },
        { projectKey: "changed-key" },
        { id: "another-id" },
        { userId: "another-user" },
        { createdAt: "2026-01-01" },
        { updatedAt: "2026-01-01" },
        {},
    ])("rejects invalid or immutable update fields %s", async (body) => {
        const service = fakeProjectService();
        const { app } = createTestApp(service);

        await request(app).patch(`/api/projects/${projectId}`).send(body).expect(400);
        expect(service.updateById).not.toHaveBeenCalled();
    });

    it("returns 404 when updating a nonexistent project", async () => {
        const service = fakeProjectService({ updateById: vi.fn().mockResolvedValue(null) });
        const { app } = createTestApp(service);

        await request(app)
            .patch(`/api/projects/${projectId}`)
            .send({ name: "Updated" })
            .expect(404);
    });

    it("deletes a project and returns normalized success", async () => {
        const service = fakeProjectService();
        const { app } = createTestApp(service);

        await request(app)
            .delete(`/api/projects/${projectId}`)
            .expect(200)
            .expect(({ body }) => expect(body).toEqual({ deleted: true }));
        expect(service.deleteById).toHaveBeenCalledWith(projectId, "owner-1");
    });

    it("returns 404 when deleting a nonexistent project", async () => {
        const service = fakeProjectService({ deleteById: vi.fn().mockResolvedValue(false) });
        const { app } = createTestApp(service);

        await request(app).delete(`/api/projects/${projectId}`).expect(404);
    });

    it("resolves ownership from configured admin username and preserves DB cascades", async () => {
        const configCacheService = createConfigCacheService();
        const projectService = createProjectService({
            projectRepository,
            userRepository,
            configCacheService,
        });
        const app = createApp({
            projectService,
            projectRepository,
            evaluationService: { evaluate: vi.fn() },
            requireAuthMiddleware: (req, res, next) => {
                req.userId = cascadeUser.id;
                next();
            },
            rateLimitMiddleware: (req, res, next) => next(),
        });

        const projectKey = `cascade-${randomUUID()}`;
        configCacheService.set(projectKey, { project: { id: "stale" }, rules: [] });
        const createdProjectResponse = await request(app).post("/api/projects").send({
            name: "Cascade integration project",
            projectKey,
            allowedOrigins: [],
            enabled: true,
        }).expect(201);
        cascadeProject = await projectRepository.findById(createdProjectResponse.body.id);
        expect(cascadeProject.user_id).toBe(cascadeUser.id);
        expect(configCacheService.get(projectKey)).toBeUndefined();

        configCacheService.set(projectKey, { project: cascadeProject, rules: [] });
        await request(app)
            .patch(`/api/projects/${cascadeProject.id}`)
            .send({ name: "Renamed cascade project" })
            .expect(200);
        expect(configCacheService.get(projectKey)).toBeUndefined();

        const rule = await ruleRepository.create({
            project_id: cascadeProject.id,
            name: "Cascade rule",
            priority: 1,
            enabled: true,
            conditions: {},
            action: "none",
            destination_url: null,
            frequency_enabled: false,
            frequency_seconds: null,
            frequency_mode: null,
            fullscreen_mode: "off",
        });
        const event = await eventRepository.create({
            project_id: cascadeProject.id,
            rule_id: rule.id,
            matched: true,
            triggered: false,
            reason: "integration_test",
            action: "none",
        });

        configCacheService.set(projectKey, { project: cascadeProject, rules: [rule] });
        await request(app).delete(`/api/projects/${cascadeProject.id}`).expect(200);

        expect(configCacheService.get(projectKey)).toBeUndefined();
        expect(await ruleRepository.findById(rule.id)).toBeUndefined();
        expect(await eventRepository.listByProjectId(cascadeProject.id)).toEqual([]);
        expect(await projectRepository.findById(cascadeProject.id)).toBeUndefined();
        cascadeProject = null;
        expect(event.id).toBeTruthy();
    });
});