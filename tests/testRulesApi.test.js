import { describe, expect, it, vi } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");
const { createRuleTestingService } = require("../src/services/ruleTestingService");
const { createSessionService, SESSION_COOKIE_NAME } = require("../src/services/sessionService");
const { evaluateRules } = require("../src/services/ruleEngine");

const ownerId = "a3fd3a30-6f04-48ba-b440-700f9f8398fc";
const anotherOwnerId = "b3fd3a30-6f04-48ba-b440-700f9f8398fc";
const projectId = "8e5efb54-49f0-4ce4-b224-90f8365d8e20";
const anotherProjectId = "9e5efb54-49f0-4ce4-b224-90f8365d8e20";
const sessionService = createSessionService({
    secret: "test-rules-api-session-secret-longer-than-32-bytes",
});
const ownerToken = sessionService.createSession(ownerId).token;
const anotherOwnerToken = sessionService.createSession(anotherOwnerId).token;

const rules = [
    {
        id: "10000000-0000-4000-8000-000000000001",
        project_id: projectId,
        name: "Earlier matching rule",
        priority: 2,
        enabled: true,
        conditions: { field: "country", operator: "equals", value: "IN" },
        action: "redirect",
        destination_url: "https://example.com",
        frequency_enabled: false,
        frequency_seconds: null,
        frequency_mode: null,
        fullscreen_mode: "prompt",
    },
    {
        id: "10000000-0000-4000-8000-000000000002",
        project_id: projectId,
        name: "Later matching rule",
        priority: 10,
        enabled: true,
        conditions: { field: "device_type", operator: "equals", value: "mobile" },
        action: "none",
        destination_url: null,
        frequency_enabled: false,
        frequency_seconds: null,
        frequency_mode: null,
        fullscreen_mode: "off",
    },
];

function createHarness({ projectOwned = true, testRules = rules } = {}) {
    const projectService = {
        getById: vi.fn(async (id, userId) => (
            id === projectId && userId === ownerId && projectOwned
                ? { id: projectId, userId: ownerId }
                : null
        )),
    };
    const ruleRepository = {
        listByProjectId: vi.fn(async () => testRules),
    };
    const redis = { set: vi.fn(), eval: vi.fn() };
    const eventLoggingService = { logEvaluationEvent: vi.fn() };
    const visitorIdentityService = { createVisitorId: vi.fn() };
    const eventRepository = { create: vi.fn() };
    const ruleTestingService = createRuleTestingService({
        projectService,
        ruleRepository,
        ruleEngine: { evaluateRules },
        frequencyService: { checkAndRecord: vi.fn() },
        redis,
        eventLoggingService,
        visitorIdentityService,
    });
    const userRepository = {
        findById: vi.fn(async (id) => (
            id === ownerId
                ? { id: ownerId, username: "owner" }
                : id === anotherOwnerId
                    ? { id: anotherOwnerId, username: "another-owner" }
                    : null
        )),
        findByUsername: vi.fn(),
    };
    const app = createApp({
        projectService,
        ruleTestingService,
        ruleService: { listByProjectId: vi.fn().mockResolvedValue(testRules) },
        projectRepository: { findByProjectKey: vi.fn() },
        userRepository,
        sessionService,
        eventRepository,
        evaluationService: { evaluate: vi.fn() },
        loginRateLimitMiddleware: (req, res, next) => next(),
        rateLimitMiddleware: (req, res, next) => next(),
    });

    function testRequest(token = ownerToken, id = projectId, body = { visitor: {} }) {
        const test = request(app).post(`/api/projects/${id}/test-rules`).send(body);
        return token ? test.set("Cookie", `${SESSION_COOKIE_NAME}=${token}`) : test;
    }

    return {
        testRequest,
        projectService,
        ruleRepository,
        redis,
        eventLoggingService,
        visitorIdentityService,
        eventRepository,
    };
}

describe("Test Rules API authentication and ownership", () => {
    it("requires authentication", async () => {
        const { testRequest } = createHarness();

        await testRequest(null).expect(401, { error: "unauthorized" });
    });

    it("returns 404 for a nonexistent project", async () => {
        const { testRequest } = createHarness({ projectOwned: false });

        await testRequest().expect(404, { error: "project_not_found" });
    });

    it("returns 404 for another user's project", async () => {
        const { testRequest } = createHarness();

        await testRequest(anotherOwnerToken, anotherProjectId)
            .expect(404, { error: "project_not_found" });
    });

    it("evaluates current rules for the authenticated project owner", async () => {
        const { testRequest, projectService, ruleRepository } = createHarness();

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "first_visit" },
        }).expect(200);
        expect(response.body).toMatchObject({
            matched: true,
            ruleId: rules[0].id,
            ruleName: "Earlier matching rule",
            priority: 2,
            action: "redirect",
            destinationUrl: "https://example.com",
            fullscreenMode: "prompt",
            triggered: true,
        });
        expect(projectService.getById).toHaveBeenCalledWith(projectId, ownerId);
        expect(ruleRepository.listByProjectId).toHaveBeenCalledWith(projectId);
    });
});

describe("Test Rules API decisions and isolated frequency simulation", () => {
    it.each([
        ["country", { geo: { country: "IN" } }, "Earlier matching rule", 2],
        ["device type", { deviceType: "mobile" }, "Later matching rule", 10],
    ])("matches by %s using RuleEngine", async (_label, visitor, ruleName, priority) => {
        const { testRequest } = createHarness();

        const response = await testRequest(ownerToken, projectId, { visitor }).expect(200);
        expect(response.body).toMatchObject({ matched: true, ruleName, priority });
    });

    it("applies AND and OR semantics through the existing RuleEngine", async () => {
        const logicRules = [
            {
                ...rules[0],
                conditions: {
                    operator: "AND",
                    conditions: [
                        { field: "country", operator: "equals", value: "IN" },
                        { field: "device_type", operator: "equals", value: "mobile" },
                    ],
                },
            },
            {
                ...rules[1],
                conditions: {
                    operator: "OR",
                    conditions: [
                        { field: "country", operator: "equals", value: "US" },
                        { field: "device_type", operator: "equals", value: "tablet" },
                    ],
                },
            },
        ];
        const { testRequest } = createHarness({ testRules: logicRules });

        const andResponse = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" }, deviceType: "mobile" },
        }).expect(200);
        expect(andResponse.body.ruleName).toBe("Earlier matching rule");

        const orResponse = await testRequest(ownerToken, projectId, {
            visitor: { deviceType: "tablet" },
        }).expect(200);
        expect(orResponse.body.ruleName).toBe("Later matching rule");
    });

    it("preserves priority order and first-match behavior", async () => {
        const { testRequest } = createHarness();

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" }, deviceType: "mobile" },
        }).expect(200);
        expect(response.body.ruleId).toBe(rules[0].id);
    });

    it("returns a normalized no-match response and skips disabled rules", async () => {
        const disabledRules = rules.map((rule) => ({ ...rule, enabled: false }));
        const { testRequest } = createHarness({ testRules: disabledRules });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "US" } },
        }).expect(200);
        expect(response.body).toMatchObject({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            triggered: false,
            reason: "no_match",
        });
    });

    it.each([
        ["none", null, false],
        ["redirect", "https://example.com", true],
        ["open_new_tab", "https://example.com/new-tab", true],
    ])("returns the configured %s action", async (action, destinationUrl, triggered) => {
        const actionRule = {
            ...rules[0],
            action,
            destination_url: destinationUrl,
        };
        const { testRequest } = createHarness({ testRules: [actionRule] });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
        }).expect(200);
        expect(response.body).toMatchObject({
            matched: true,
            configuredAction: action,
            action,
            destinationUrl,
            triggered,
        });
    });

    const frequencyRule = {
        ...rules[0],
        frequency_enabled: true,
        frequency_seconds: 600,
        frequency_mode: "cooldown",
    };

    it("simulates cooldown first visit as triggered", async () => {
        const { testRequest } = createHarness({ testRules: [frequencyRule] });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "first_visit" },
        }).expect(200);
        expect(response.body).toMatchObject({
            triggered: true,
            frequencyStatus: "triggered",
            reason: "frequency_triggered",
        });
    });

    it("simulates cooldown within interval as limited", async () => {
        const { testRequest } = createHarness({ testRules: [frequencyRule] });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 30 },
        }).expect(200);
        expect(response.body).toMatchObject({
            matched: true,
            triggered: false,
            configuredAction: "redirect",
            action: "none",
            destinationUrl: null,
            frequencyStatus: "limited",
            reason: "frequency_limited",
        });
    });

    it("simulates cooldown after expiry as triggered", async () => {
        const { testRequest } = createHarness({ testRules: [frequencyRule] });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 700 },
        }).expect(200);
        expect(response.body).toMatchObject({
            triggered: true,
            frequencyStatus: "triggered",
            reason: "frequency_triggered",
        });
    });

    it("simulates return_after first visit as recorded without triggering", async () => {
        const { testRequest } = createHarness({
            testRules: [{ ...frequencyRule, frequency_mode: "return_after" }],
        });

        const response = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "first_visit" },
        }).expect(200);
        expect(response.body).toMatchObject({
            triggered: false,
            action: "none",
            frequencyStatus: "recorded",
            reason: "frequency_recorded",
        });
    });

    it("simulates return_after returning visitors before and after the interval", async () => {
        const { testRequest } = createHarness({
            testRules: [{ ...frequencyRule, frequency_mode: "return_after" }],
        });

        const limited = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 599 },
        }).expect(200);
        expect(limited.body.reason).toBe("frequency_limited");

        const triggered = await testRequest(ownerToken, projectId, {
            visitor: { geo: { country: "IN" } },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 600 },
        }).expect(200);
        expect(triggered.body.reason).toBe("frequency_triggered");
    });

    it.each([
        { visitor: { ip: "not-an-ip" } },
        { visitor: { deviceType: "phone" } },
        { visitor: { browserGeo: { latitude: 45, longitude: -90, accuracy: 5 } } },
        { visitor: { screen: { width: 0 } } },
        { visitor: {}, frequencySimulation: { visit: "first_visit", secondsSincePreviousTrigger: 2 } },
        { visitor: {}, frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: -1 } },
        { visitor: {}, extra: true },
    ])("rejects invalid visitor or simulation input %#", async (body) => {
        const { testRequest } = createHarness();

        await testRequest(ownerToken, projectId, body).expect(400);
    });

    it("does not touch Redis, visitor identity, event logging, or event persistence", async () => {
        const harness = createHarness({ testRules: [frequencyRule] });

        await harness.testRequest(ownerToken, projectId, {
            visitor: { ip: "203.0.113.20", geo: { country: "IN" } },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 30 },
        }).expect(200);

        expect(harness.redis.set).not.toHaveBeenCalled();
        expect(harness.redis.eval).not.toHaveBeenCalled();
        expect(harness.eventLoggingService.logEvaluationEvent).not.toHaveBeenCalled();
        expect(harness.visitorIdentityService.createVisitorId).not.toHaveBeenCalled();
        expect(harness.eventRepository.create).not.toHaveBeenCalled();
    });
});
