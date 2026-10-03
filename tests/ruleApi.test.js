import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { randomUUID } = require("node:crypto");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../src/server");
const db = require("../src/config/db");
const projectRepository = require("../src/repositories/projectRepository");
const ruleRepository = require("../src/repositories/ruleRepository");
const userRepository = require("../src/repositories/userRepository");
const { createRuleService } = require("../src/services/ruleService");
const { createConfigCacheService } = require("../src/services/configCacheService");
const { evaluateRules } = require("../src/services/ruleEngine");

const projectId = "c82ca587-56ad-4e17-8cb4-f9db6ebd7ac2";
const ruleId = "5eb505a6-9a36-4e35-9bd8-79e1b53163f2";

function makeRule(overrides = {}) {
    return {
        id: ruleId,
        projectId,
        name: "Example rule",
        priority: 0,
        enabled: true,
        conditions: { operator: "AND", conditions: [{ field: "country", operator: "equals", value: "IN" }] },
        action: "none",
        destinationUrl: null,
        frequencyEnabled: false,
        frequencySeconds: null,
        frequencyMode: null,
        fullscreenMode: "off",
        createdAt: "2026-10-03T12:00:00.000Z",
        updatedAt: "2026-10-03T12:00:00.000Z",
        ...overrides,
    };
}

function makeRuleService(overrides = {}) {
    return {
        listByProjectId: vi.fn().mockResolvedValue([makeRule()]),
        create: vi.fn().mockResolvedValue(makeRule()),
        updateById: vi.fn().mockResolvedValue(makeRule()),
        deleteById: vi.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function createTestApp(ruleService = makeRuleService()) {
    return {
        app: createApp({
            ruleService,
            projectService: { list: vi.fn(), create: vi.fn(), getById: vi.fn(), updateById: vi.fn(), deleteById: vi.fn() },
            projectRepository: { findById: vi.fn(), findByProjectKey: vi.fn() },
            evaluationService: { evaluate: vi.fn() },
            requireAuthMiddleware: (req, res, next) => {
                req.userId = "test-owner";
                next();
            },
            rateLimitMiddleware: (req, res, next) => next(),
        }),
        ruleService,
    };
}

const validCondition = {
    operator: "AND",
    conditions: [
        { field: "country", operator: "equals", value: "IN" },
        { field: "device_type", operator: "equals", value: "mobile" },
    ],
};

const validRule = {
    name: "Mobile visitors in India",
    priority: 2,
    enabled: true,
    conditions: validCondition,
    action: "none",
    frequencyEnabled: false,
    fullscreenMode: "off",
};

let testUser;
let testProject;

beforeAll(async () => {
    await db.migrate.latest({ directory: path.resolve(process.cwd(), "src/db/migrations") });
    testUser = await userRepository.create({
        username: `rule-api-${randomUUID()}`,
        password_hash: "test-only-hash",
    });
    testProject = await projectRepository.create({
        user_id: testUser.id,
        name: "Rule API integration project",
        project_key: `rule-api-${randomUUID()}`,
        allowed_origins: [],
        enabled: true,
    });
});

afterAll(async () => {
    if (testProject) await projectRepository.deleteById(testProject.id);
    if (testUser) await userRepository.deleteById(testUser.id);
    await db.destroy();
});

describe("Rule API", () => {
    it.each([
        ["none", { action: "none" }],
        ["redirect", { action: "redirect", destinationUrl: "https://example.com" }],
        ["open_new_tab", { action: "open_new_tab", destinationUrl: "http://example.com/path" }],
    ])("creates a valid %s rule", async (_action, fields) => {
        const expected = makeRule({ ...fields, name: validRule.name, priority: validRule.priority, conditions: validRule.conditions });
        const service = makeRuleService({ create: vi.fn().mockResolvedValue(expected) });
        const { app } = createTestApp(service);

        const response = await request(app)
            .post(`/api/projects/${projectId}/rules`)
            .send({ ...validRule, ...fields })
            .expect(201);

        expect(response.body).toEqual(expected);
        expect(service.create).toHaveBeenCalledWith(projectId, expect.objectContaining({
            name: validRule.name,
            priority: validRule.priority,
            enabled: true,
            conditions: validRule.conditions,
            action: fields.action,
            destinationUrl: fields.action === "none"
                ? null
                : fields.destinationUrl === "https://example.com"
                    ? "https://example.com/"
                    : fields.destinationUrl,
            frequencyEnabled: false,
            frequencySeconds: null,
            frequencyMode: null,
            fullscreenMode: "off",
        }), "test-owner");
    });

    it.each([
        ["missing name", { ...validRule, name: " " }],
        ["invalid priority", { ...validRule, priority: -1 }],
        ["fractional priority", { ...validRule, priority: 1.5 }],
        ["unknown action", { ...validRule, action: "popup" }],
        ["unknown fullscreen mode", { ...validRule, fullscreenMode: "automatic" }],
        ["redirect without destination", { ...validRule, action: "redirect" }],
        ["open_new_tab without destination", { ...validRule, action: "open_new_tab" }],
        ["none with destination", { ...validRule, destinationUrl: "https://example.com" }],
        ["unsafe destination", { ...validRule, action: "redirect", destinationUrl: "javascript:alert(1)" }],
        ["client project ID", { ...validRule, projectId }],
        ["client rule ID", { ...validRule, id: ruleId }],
        ["unknown field", { ...validRule, visitorId: "fake" }],
    ])("rejects %s during creation", async (_case, body) => {
        const service = makeRuleService();
        const { app } = createTestApp(service);

        await request(app).post(`/api/projects/${projectId}/rules`).send(body).expect(400);
        expect(service.create).not.toHaveBeenCalled();
    });

    it.each([
        ["zero interval", { frequencyEnabled: true, frequencySeconds: 0, frequencyMode: "cooldown" }],
        ["negative interval", { frequencyEnabled: true, frequencySeconds: -1, frequencyMode: "cooldown" }],
        ["fractional interval", { frequencyEnabled: true, frequencySeconds: 1.5, frequencyMode: "cooldown" }],
        ["missing frequency mode", { frequencyEnabled: true, frequencySeconds: 30 }],
        ["unknown frequency mode", { frequencyEnabled: true, frequencySeconds: 30, frequencyMode: "forever" }],
        ["frequency fields while disabled", { frequencyEnabled: false, frequencySeconds: 30, frequencyMode: "cooldown" }],
    ])("rejects invalid frequency configuration: %s", async (_case, frequency) => {
        const { app, ruleService } = createTestApp();

        await request(app)
            .post(`/api/projects/${projectId}/rules`)
            .send({ ...validRule, ...frequency })
            .expect(400);
        expect(ruleService.create).not.toHaveBeenCalled();
    });

    it.each([
        { frequencyEnabled: true, frequencySeconds: 30, frequencyMode: "cooldown" },
        { frequencyEnabled: true, frequencySeconds: 300, frequencyMode: "return_after" },
    ])("accepts valid frequency configuration %s", async (frequency) => {
        const { app, ruleService } = createTestApp();

        await request(app)
            .post(`/api/projects/${projectId}/rules`)
            .send({ ...validRule, ...frequency })
            .expect(201);
        expect(ruleService.create).toHaveBeenCalled();
    });

    it.each([
        { operator: "AND", conditions: [] },
        { operator: "XOR", conditions: [{ field: "country", operator: "equals", value: "IN" }] },
        { operator: "AND", conditions: [{ field: "postal_code", operator: "equals", value: "10001" }] },
        { operator: "AND", conditions: [{ field: "country", operator: "matches", value: "IN" }] },
        { operator: "AND", conditions: [{ field: "country", operator: "equals" }] },
        { operator: "AND", conditions: [{ field: "screen_width", operator: "greater_than", value: "300" }] },
        { operator: "AND", conditions: [{ field: "ip", operator: "cidr", value: "192.168.1.1/99" }] },
        { operator: "AND", conditions: [{ field: "browser_geo_latitude", operator: "equals", value: 45 }] },
        { operator: "AND", conditions: [{ field: "browser_geo_longitude", operator: "equals", value: -90 }] },
        { operator: "AND", conditions: [{ field: "browser_geo_accuracy", operator: "equals", value: 10 }] },
    ])("rejects malformed condition structure %s", async (conditions) => {
        const { app, ruleService } = createTestApp();

        await request(app).post(`/api/projects/${projectId}/rules`).send({ ...validRule, conditions }).expect(400);
        expect(ruleService.create).not.toHaveBeenCalled();
    });

    it("returns 404 when creating a rule for a nonexistent project", async () => {
        const { app } = createTestApp(makeRuleService({ create: vi.fn().mockResolvedValue(null) }));

        await request(app)
            .post(`/api/projects/${projectId}/rules`)
            .send(validRule)
            .expect(404)
            .expect(({ body }) => expect(body.error).toBe("project_not_found"));
    });

    it("lists rules for the requested project using repository order", async () => {
        const rules = [makeRule({ id: "low-priority-id", priority: 1 }), makeRule({ id: "later-id", priority: 5 })];
        const service = makeRuleService({ listByProjectId: vi.fn().mockResolvedValue(rules) });
        const { app } = createTestApp(service);

        await request(app).get(`/api/projects/${projectId}/rules`).expect(200, rules);
        expect(service.listByProjectId).toHaveBeenCalledWith(projectId, "test-owner");
    });

    it("returns 404 for a nonexistent project when listing", async () => {
        const { app } = createTestApp(makeRuleService({ listByProjectId: vi.fn().mockResolvedValue(null) }));

        await request(app)
            .get(`/api/projects/${projectId}/rules`)
            .expect(404)
            .expect(({ body }) => expect(body.error).toBe("project_not_found"));
    });

    it("rejects malformed project or rule UUIDs", async () => {
        const { app, ruleService } = createTestApp();

        await request(app).get("/api/projects/not-a-uuid/rules").expect(400);
        await request(app).patch(`/api/projects/${projectId}/rules/not-a-uuid`).send({ name: "x" }).expect(400);
        await request(app).delete(`/api/projects/${projectId}/rules/not-a-uuid`).expect(400);
        expect(ruleService.updateById).not.toHaveBeenCalled();
        expect(ruleService.deleteById).not.toHaveBeenCalled();
    });

    it.each([
        [{ name: "Renamed" }, { name: "Renamed" }],
        [{ priority: 4 }, { priority: 4 }],
        [{ conditions: { field: "country", operator: "equals", value: "US" } }, { conditions: { field: "country", operator: "equals", value: "US" } }],
        [{ action: "redirect", destinationUrl: "https://example.org" }, { action: "redirect", destinationUrl: "https://example.org" }],
        [{ frequencyEnabled: true, frequencySeconds: 60, frequencyMode: "cooldown" }, { frequencyEnabled: true, frequencySeconds: 60, frequencyMode: "cooldown" }],
        [{ enabled: false }, { enabled: false }],
        [{ fullscreenMode: "prompt" }, { fullscreenMode: "prompt" }],
    ])("updates rule fields %s", async (body, expectedFields) => {
        const updatedRule = makeRule(expectedFields);
        const service = makeRuleService({ updateById: vi.fn().mockResolvedValue(updatedRule) });
        const { app } = createTestApp(service);

        await request(app)
            .patch(`/api/projects/${projectId}/rules/${ruleId}`)
            .send(body)
            .expect(200, updatedRule);
        expect(service.updateById).toHaveBeenCalledWith(projectId, ruleId, body, "test-owner");
    });

    it.each([
        { name: " " },
        { priority: -5 },
        { action: "bad-action" },
        { destinationUrl: "javascript:alert(1)" },
        { frequencyEnabled: false, frequencySeconds: 20 },
        { enabled: "false" },
        { fullscreenMode: "fullscreen" },
        { projectId },
        { id: ruleId },
        { createdAt: "today" },
        { updatedAt: "today" },
        {},
    ])("rejects invalid rule updates %s", async (body) => {
        const { app, ruleService } = createTestApp();

        await request(app).patch(`/api/projects/${projectId}/rules/${ruleId}`).send(body).expect(400);
        expect(ruleService.updateById).not.toHaveBeenCalled();
    });

    it("returns 404 for missing projects and rules during update/delete", async () => {
        const service = makeRuleService({
            updateById: vi.fn().mockResolvedValue(null),
            deleteById: vi.fn().mockResolvedValue(false),
        });
        const { app } = createTestApp(service);

        await request(app).patch(`/api/projects/${projectId}/rules/${ruleId}`).send({ name: "x" }).expect(404);
        await request(app).delete(`/api/projects/${projectId}/rules/${ruleId}`).expect(404);
        expect(service.updateById).toHaveBeenCalledWith(projectId, ruleId, { name: "x" }, "test-owner");
        expect(service.deleteById).toHaveBeenCalledWith(projectId, ruleId, "test-owner");
    });

    it("returns 404 when the requested rule belongs to another project", async () => {
        const owner = { id: "admin-owner" };
        const ruleRepo = {
            findById: vi.fn().mockResolvedValue({ id: ruleId, project_id: "another-project" }),
            updateById: vi.fn(),
            deleteById: vi.fn(),
        };
        const ruleService = createRuleService({
            projectRepository: {
                findById: vi.fn().mockResolvedValue({ id: projectId, user_id: owner.id }),
            },
            ruleRepository: ruleRepo,
            userRepository: {
                findById: vi.fn().mockResolvedValue(owner),
            },
        });
        const app = createApp({
            ruleService,
            projectRepository: { findById: vi.fn(), findByProjectKey: vi.fn() },
            evaluationService: { evaluate: vi.fn() },
            requireAuthMiddleware: (req, res, next) => {
                req.userId = owner.id;
                next();
            },
            rateLimitMiddleware: (req, res, next) => next(),
        });

        await request(app)
            .patch(`/api/projects/${projectId}/rules/${ruleId}`)
            .send({ name: "Cannot access" })
            .expect(404);
        await request(app).delete(`/api/projects/${projectId}/rules/${ruleId}`).expect(404);

        expect(ruleRepo.updateById).not.toHaveBeenCalled();
        expect(ruleRepo.deleteById).not.toHaveBeenCalled();
    });

    it("deletes a rule with a normalized response", async () => {
        const { app, ruleService } = createTestApp();

        await request(app)
            .delete(`/api/projects/${projectId}/rules/${ruleId}`)
            .expect(200)
            .expect(({ body }) => expect(body).toEqual({ deleted: true }));
        expect(ruleService.deleteById).toHaveBeenCalledWith(projectId, ruleId, "test-owner");
    });

    it("creates a rule configuration accepted by the existing RuleEngine", async () => {
        const user = testUser;
        const project = testProject;
        const configCacheService = createConfigCacheService();
        const ruleService = createRuleService({
            projectRepository,
            ruleRepository,
            userRepository,
            configCacheService,
        });
        const app = createApp({
            ruleService,
            projectRepository,
            evaluationService: { evaluate: vi.fn() },
            requireAuthMiddleware: (req, res, next) => {
                req.userId = user.id;
                next();
            },
            rateLimitMiddleware: (req, res, next) => next(),
        });
        const body = {
            ...validRule,
            name: "RuleEngine integration condition",
            action: "none",
            priority: 1,
        };

        configCacheService.set(project.project_key, { project, rules: [] });
        const response = await request(app)
            .post(`/api/projects/${project.id}/rules`)
            .send(body)
            .expect(201);
        expect(configCacheService.get(project.project_key)).toBeUndefined();
        const persistedRule = await ruleRepository.findById(response.body.id);

        expect(persistedRule.project_id).toBe(project.id);
        expect(evaluateRules({
            ip: "203.0.113.10",
            geo: { country: "IN", region: null, city: null },
            browserGeo: null,
            browser: null,
            os: null,
            deviceType: "mobile",
            language: null,
            timezone: null,
            screen: { width: 390, height: 844 },
        }, [persistedRule])).toMatchObject({ matched: true, ruleId: persistedRule.id, action: "none" });

        configCacheService.set(project.project_key, { project, rules: [persistedRule] });
        await request(app)
            .patch(`/api/projects/${project.id}/rules/${persistedRule.id}`)
            .send({ name: "Updated RuleEngine integration condition" })
            .expect(200);
        expect(configCacheService.get(project.project_key)).toBeUndefined();

        const updatedRule = await ruleRepository.findById(persistedRule.id);
        configCacheService.set(project.project_key, { project, rules: [updatedRule] });
        await request(app)
            .delete(`/api/projects/${project.id}/rules/${persistedRule.id}`)
            .expect(200);
        expect(configCacheService.get(project.project_key)).toBeUndefined();
    });
});