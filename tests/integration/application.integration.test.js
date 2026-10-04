import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { randomBytes, randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const request = require("supertest");
const env = require("../../src/config/env");
const db = require("../../src/config/db");
const redis = require("../../src/config/redis");
const { createApp } = require("../../src/server");
const projectRepository = require("../../src/repositories/projectRepository");
const ruleRepository = require("../../src/repositories/ruleRepository");
const eventRepository = require("../../src/repositories/eventRepository");
const userRepository = require("../../src/repositories/userRepository");
const clientIpService = require("../../src/services/clientIpService");
const clientInfoService = require("../../src/services/clientInfoService");
const visitorIdentityService = require("../../src/services/visitorIdentityService");
const configCacheService = require("../../src/services/configCacheService");
const { createAuthService } = require("../../src/services/authService");
const { createSessionService } = require("../../src/services/sessionService");
const { createEvaluationService } = require("../../src/services/evaluationService");
const { createEventLoggingService } = require("../../src/services/eventLoggingService");
const { createRateLimit } = require("../../src/middleware/rateLimit");
const { FrequencyService } = require("../../src/services/frequencyService");
const { evaluateRules } = require("../../src/services/ruleEngine");

const runId = randomUUID();
const redisNamespace = `integration:${runId}`;
const allowedOrigin = "https://customer.integration.example";
const forwardedIndiaIp = "203.0.113.10";
const forwardedOtherIp = "203.0.113.11";
const clientPayload = {
    browser: "Chrome",
    os: "Linux",
    deviceType: "mobile",
    language: "en-IN",
    timezone: "Asia/Kolkata",
    screen: { width: 390, height: 844 },
};
const sessionService = createSessionService({
    secret: randomBytes(48).toString("base64url"),
});
const authService = createAuthService({ userRepository });
const originalTrustedProxies = env.TRUSTED_PROXIES;
const userIds = [];
let ownerAgent;
let otherAgent;
let app;
let servicesReady = false;
let ownerCredentials;
let otherCredentials;

const integrationGeoIpService = {
    lookup(ip) {
        return ip?.startsWith("203.0.113.")
            ? { country: "IN", region: "DL", city: "New Delhi" }
            : { country: null, region: null, city: null };
    },
};

function createIntegrationEvaluationService({
    frequencyService = new FrequencyService(redis, {
        keyPrefix: `${redisNamespace}:frequency`,
    }),
    eventLoggingService = createEventLoggingService({ eventRepository }),
    geoIpService = integrationGeoIpService,
} = {}) {
    return createEvaluationService({
        projectRepository,
        ruleRepository,
        clientIpService,
        geoIpService,
        clientInfoService,
        visitorIdentityService,
        frequencyService,
        ruleEngine: { evaluateRules },
        eventLoggingService,
        configCacheService,
    });
}

function createIntegrationApp({
    evaluationService = createIntegrationEvaluationService(),
    rateLimit = 1000,
    namespace = "evaluation",
} = {}) {
    return createApp({
        evaluationService,
        sessionService,
        authService,
        cookieSecure: false,
        rateLimitMiddleware: createRateLimit({
            redisClient: redis,
            clientIpService,
            visitorIdentityService,
            limit: rateLimit,
            keyPrefix: `${redisNamespace}:${namespace}`,
        }),
        loginRateLimitMiddleware: createRateLimit({
            redisClient: redis,
            clientIpService,
            visitorIdentityService,
            limit: 1000,
            keyPrefix: `${redisNamespace}:login`,
        }),
    });
}

function testUser(label) {
    const username = `integration-${label}-${runId}`;
    const password = randomBytes(24).toString("base64url");
    return { username, password };
}

async function createUser(credentials) {
    const passwordHash = await bcrypt.hash(credentials.password, 4);
    const [user] = await db("users")
        .insert({ username: credentials.username, password_hash: passwordHash })
        .returning(["id"]);
    userIds.push(user.id);
    return user;
}

async function login(credentials) {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send(credentials).expect(200);
    return agent;
}

async function createProject(agent = ownerAgent, options = {}) {
    const projectKey = `it-${randomUUID()}`;
    const response = await agent
        .post("/api/projects")
        .send({
            name: "Integration Project",
            projectKey,
            allowedOrigins: [allowedOrigin],
            enabled: true,
            ...options,
        })
        .expect(201);
    return response.body;
}

function ruleInput({
    name = "Integration rule",
    priority = 1,
    conditions = { field: "device_type", operator: "equals", value: "mobile" },
    action = "redirect",
    destinationUrl = "https://destination.integration.example/landing",
    frequencyEnabled = false,
    frequencySeconds = null,
    frequencyMode = null,
    fullscreenMode = "off",
    enabled = true,
} = {}) {
    return {
        name,
        priority,
        enabled,
        conditions,
        action,
        destinationUrl: action === "none" ? null : destinationUrl,
        frequencyEnabled,
        frequencySeconds,
        frequencyMode,
        fullscreenMode,
    };
}

async function createRule(projectId, input = ruleInput(), agent = ownerAgent) {
    const response = await agent
        .post(`/api/projects/${projectId}/rules`)
        .send(input)
        .expect(201);
    return response.body;
}

function evaluate(project, {
    payload = clientPayload,
    ip = forwardedIndiaIp,
    origin,
    targetApp = app,
} = {}) {
    let call = request(targetApp)
        .post(`/api/v1/evaluate?projectKey=${encodeURIComponent(project.projectKey)}`)
        .set("X-Forwarded-For", ip);
    if (origin) call = call.set("Origin", origin);
    return call.send(payload);
}

async function findRedisKeys(pattern) {
    let cursor = "0";
    const found = [];
    do {
        const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100,
        );
        cursor = nextCursor;
        found.push(...keys);
    } while (cursor !== "0");
    return found;
}

async function waitForEventCount(projectId, minimumCount, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const countResult = await db("events")
            .where({ project_id: projectId })
            .count({ total: "id" })
            .first();
        if (Number(countResult.total) >= minimumCount) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for evaluation events for test project ${projectId}`);
}

async function scanAndDeleteTestRedisKeys() {
    const keys = await findRedisKeys(`${redisNamespace}:*`);
    if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
    const databaseUrl = new URL(env.DATABASE_URL);
    if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== "visitor_routing_test") {
        throw new Error(
            "Integration setup refused: DATABASE_URL must target visitor_routing_test.",
        );
    }

    try {
        const databaseResult = await db.raw("SELECT current_database()");
        if (databaseResult.rows[0]?.current_database !== "visitor_routing_test") {
            throw new Error("Unexpected PostgreSQL database");
        }

        const requiredTables = ["users", "projects", "rules", "events", "knex_migrations"];
        for (const table of requiredTables) {
            if (!(await db.schema.hasTable(table))) {
                throw new Error("Required test migrations are not applied");
            }
        }

        if (await redis.ping() !== "PONG") {
            throw new Error("Redis did not respond to PING");
        }
        servicesReady = true;
    } catch {
        throw new Error(
            "Integration setup failed: start PostgreSQL and Redis, apply migrations to visitor_routing_test, and verify the .env.test service URLs.",
        );
    }

    env.TRUSTED_PROXIES = "127.0.0.1";
    configCacheService.clear();
    app = createIntegrationApp();

    ownerCredentials = testUser("owner");
    otherCredentials = testUser("other");
    await createUser(ownerCredentials);
    await createUser(otherCredentials);
    ownerAgent = await login(ownerCredentials);
    otherAgent = await login(otherCredentials);
});

afterAll(async () => {
    try {
        if (servicesReady) {
            configCacheService.clear();
            if (userIds.length > 0) {
                await db("users").whereIn("id", userIds).delete();
            }
            await scanAndDeleteTestRedisKeys();
        }
    } finally {
        env.TRUSTED_PROXIES = originalTrustedProxies;
        try {
            await db.destroy();
        } finally {
            if (servicesReady) {
                await redis.quit();
            } else {
                redis.disconnect();
            }
        }
    }
});

describe("real PostgreSQL and Redis application integration", () => {
    it("authenticates, protects management APIs, logs out, and leaves public routes unauthenticated", async () => {
        const project = await createProject();
        const anonymousAgent = request.agent(app);

        await anonymousAgent.get("/api/projects").expect(401);
        await anonymousAgent.get(`/api/projects/${project.id}`).expect(401);
        await anonymousAgent
            .get(`/api/projects/${project.id}/rules`)
            .expect(401);
        await anonymousAgent
            .get(`/api/projects/${project.id}/events`)
            .expect(401);
        await anonymousAgent
            .post(`/api/projects/${project.id}/test-rules`)
            .send({ visitor: {} })
            .expect(401);

        await ownerAgent.get("/api/projects").expect(200);
        await request(app).get("/health").expect(200);
        await request(app).get("/sdk.js").expect(200);
        await evaluate(project).expect(200);

        const logoutAgent = request.agent(app);
        const loginResponse = await logoutAgent
            .post("/api/auth/login")
            .send(ownerCredentials)
            .expect(200);
        expect(loginResponse.body).toEqual({ authenticated: true });
        expect(loginResponse.headers["set-cookie"][0]).toContain("HttpOnly");
        expect(loginResponse.headers["set-cookie"][0]).not.toContain(ownerCredentials.password);
        const logout = await logoutAgent.post("/api/auth/logout").expect(200);
        expect(logout.headers["set-cookie"][0]).toContain(
            "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        );
        expect(logout.headers["set-cookie"][0]).toContain("HttpOnly");
        await logoutAgent.get("/api/projects").expect(401);
    });

    it("rejects login when the production-wired Redis limiter is unavailable", async () => {
        const authServiceSpy = { authenticate: vi.fn().mockResolvedValue(null) };
        const loginApp = createApp({
            authService: authServiceSpy,
            sessionService,
            cookieSecure: false,
        });
        const redisEval = vi.spyOn(redis, "eval")
            .mockRejectedValue(new Error("private Redis connection detail"));
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
            const response = await request(loginApp)
                .post("/api/auth/login")
                .send(ownerCredentials)
                .expect(503);

            expect(response.body).toEqual({ error: "rate_limit_unavailable" });
            expect(JSON.stringify(response.body)).not.toContain("private Redis");
            expect(authServiceSpy.authenticate).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(
                "Rate limiter unavailable; rejecting request.",
            );
        } finally {
            redisEval.mockRestore();
            errorSpy.mockRestore();
        }
    });

    it("persists project CRUD and denies access to another user's projects and rules", async () => {
        const project = await createProject();
        const rule = await createRule(project.id);

        const list = await ownerAgent.get("/api/projects").expect(200);
        expect(list.body.some(({ id }) => id === project.id)).toBe(true);

        const details = await ownerAgent
            .get(`/api/projects/${project.id}`)
            .expect(200);
        expect(details.body).toMatchObject({
            id: project.id,
            name: "Integration Project",
            projectKey: project.projectKey,
            allowedOrigins: [allowedOrigin],
            enabled: true,
        });

        const update = await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({
                name: "Updated Integration Project",
                allowedOrigins: ["https://updated.integration.example"],
                enabled: false,
            })
            .expect(200);
        expect(update.body).toMatchObject({
            name: "Updated Integration Project",
            allowedOrigins: ["https://updated.integration.example"],
            enabled: false,
        });
        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ name: "Rejected Key Change", projectKey: "new-key" })
            .expect(400);
        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: true })
            .expect(200);

        const otherReads = await Promise.all([
            otherAgent.get(`/api/projects/${project.id}`),
            otherAgent.get(`/api/projects/${project.id}/rules`),
            otherAgent.get(`/api/projects/${project.id}/events`),
        ]);
        expect(otherReads.map(({ status }) => status)).toEqual([404, 404, 404]);
        await otherAgent
            .patch(`/api/projects/${project.id}`)
            .send({ name: "Unauthorized" })
            .expect(404);
        await otherAgent
            .delete(`/api/projects/${project.id}`)
            .expect(404);
        await otherAgent
            .patch(`/api/projects/${project.id}/rules/${rule.id}`)
            .send({ name: "Unauthorized" })
            .expect(404);
        await otherAgent
            .delete(`/api/projects/${project.id}/rules/${rule.id}`)
            .expect(404);
    });

    it("runs authenticated rule CRUD in priority order and rejects cross-project rule IDs", async () => {
        const project = await createProject();
        const secondProject = await createProject();
        const ruleA = await createRule(project.id, ruleInput({
            name: "Priority 1",
            priority: 1,
        }));
        const ruleB = await createRule(project.id, ruleInput({
            name: "Priority 2",
            priority: 2,
            action: "none",
        }));
        const ruleC = await createRule(project.id, ruleInput({
            name: "Priority 3",
            priority: 3,
            conditions: { field: "language", operator: "contains", value: "en" },
            action: "open_new_tab",
        }));

        const ordered = await ownerAgent
            .get(`/api/projects/${project.id}/rules`)
            .expect(200);
        expect(ordered.body.map(({ id }) => id)).toEqual([ruleA.id, ruleB.id, ruleC.id]);

        const updated = await ownerAgent
            .patch(`/api/projects/${project.id}/rules/${ruleC.id}`)
            .send({ name: "Updated priority 3", priority: 0 })
            .expect(200);
        expect(updated.body).toMatchObject({ name: "Updated priority 3", priority: 0 });

        await ownerAgent
            .patch(`/api/projects/${secondProject.id}/rules/${ruleA.id}`)
            .send({ name: "Cross-project modification" })
            .expect(404);
        await ownerAgent
            .delete(`/api/projects/${secondProject.id}/rules/${ruleA.id}`)
            .expect(404);
        await ownerAgent
            .delete(`/api/projects/${project.id}/rules/${ruleB.id}`)
            .expect(200);
        const remaining = await ownerAgent
            .get(`/api/projects/${project.id}/rules`)
            .expect(200);
        expect(remaining.body.map(({ id }) => id)).toEqual([ruleC.id, ruleA.id]);
    });

    it("evaluates first-match rules using server-derived IP and persists analytics-only events", async () => {
        const project = await createProject();
        const indiaMobile = await createRule(project.id, ruleInput({
            name: "India mobile",
            priority: 1,
            conditions: {
                operator: "AND",
                conditions: [
                    { field: "country", operator: "equals", value: "IN" },
                    { field: "device_type", operator: "equals", value: "mobile" },
                ],
            },
            frequencyEnabled: true,
            frequencySeconds: 10,
            frequencyMode: "cooldown",
            fullscreenMode: "prompt",
        }));
        const desktop = await createRule(project.id, ruleInput({
            name: "Desktop",
            priority: 2,
            conditions: { field: "device_type", operator: "equals", value: "desktop" },
            action: "none",
        }));
        const english = await createRule(project.id, ruleInput({
            name: "English",
            priority: 3,
            conditions: { field: "language", operator: "contains", value: "en" },
            action: "open_new_tab",
        }));
        const evaluationApp = createIntegrationApp();

        const matchedResponse = await evaluate(project, {
            targetApp: evaluationApp,
            origin: allowedOrigin,
        }).expect(200);
        expect(matchedResponse.body).toMatchObject({
            matched: true,
            ruleId: indiaMobile.id,
            action: "redirect",
            destinationUrl: "https://destination.integration.example/landing",
            fullscreenMode: "prompt",
            reason: "rule_matched",
            triggered: true,
        });
        expect(Object.keys(matchedResponse.body).sort()).toEqual([
            "action",
            "destinationUrl",
            "fullscreenMode",
            "matched",
            "reason",
            "ruleId",
            "triggered",
        ].sort());
        expect(integrationGeoIpService.lookup(forwardedIndiaIp).country).toBe("IN");

        const desktopResponse = await evaluate(project, {
            targetApp: evaluationApp,
            ip: forwardedOtherIp,
            payload: { ...clientPayload, deviceType: "desktop", language: "fr" },
        }).expect(200);
        expect(desktopResponse.body).toMatchObject({
            matched: true,
            ruleId: desktop.id,
            action: "none",
            triggered: false,
        });

        const languageResponse = await evaluate(project, {
            targetApp: evaluationApp,
            ip: forwardedOtherIp,
            payload: { ...clientPayload, deviceType: "tablet", language: "en-GB" },
        }).expect(200);
        expect(languageResponse.body).toMatchObject({
            matched: true,
            ruleId: english.id,
            action: "open_new_tab",
            triggered: true,
        });

        await evaluate(project, {
            targetApp: evaluationApp,
            payload: {
                ...clientPayload,
                ip: forwardedOtherIp,
                country: "US",
                region: "CA",
                city: "San Francisco",
            },
        }).expect(400);

        const noMatch = await evaluate(project, {
            targetApp: evaluationApp,
            ip: forwardedOtherIp,
            payload: { ...clientPayload, deviceType: "tablet", language: "fr" },
        }).expect(200);
        expect(noMatch.body).toMatchObject({
            matched: false,
            action: "none",
            reason: "no_match",
            triggered: false,
        });

        await waitForEventCount(project.id, 4);
        const eventResponse = await ownerAgent
            .get(`/api/projects/${project.id}/events`)
            .expect(200);
        expect(eventResponse.body.pagination).toMatchObject({
            page: 1,
            pageSize: 50,
            total: 4,
            totalPages: 1,
        });
        expect(eventResponse.body.events[0].createdAt >= eventResponse.body.events[1].createdAt).toBe(true);
        const event = eventResponse.body.events.find(({ ruleId }) => ruleId === indiaMobile.id);
        expect(event).toMatchObject({
            projectId: project.id,
            ruleId: indiaMobile.id,
            matched: true,
            triggered: true,
            action: "redirect",
            country: "IN",
            region: "DL",
            deviceType: "mobile",
            browser: "Chrome",
            os: "Linux",
        });
        expect(Object.keys(event).sort()).toEqual([
            "action",
            "browser",
            "country",
            "createdAt",
            "deviceType",
            "id",
            "matched",
            "os",
            "projectId",
            "reason",
            "region",
            "ruleId",
            "triggered",
        ].sort());
        expect(JSON.stringify(eventResponse.body)).not.toMatch(
            /visitorId|ipHash|cookie|authorization|headers|requestBody|secret|203\.0\.113\./i,
        );
    });

    it("uses real Redis cooldown, return-after, and atomic first-trigger behavior", async () => {
        const project = await createProject();
        const cooldownRule = await createRule(project.id, ruleInput({
            name: "Ten second cooldown",
            frequencyEnabled: true,
            frequencySeconds: 10,
            frequencyMode: "cooldown",
        }));

        const first = await evaluate(project).expect(200);
        expect(first.body).toMatchObject({
            matched: true,
            ruleId: cooldownRule.id,
            triggered: true,
        });
        const second = await evaluate(project).expect(200);
        expect(second.body).toMatchObject({
            matched: true,
            ruleId: cooldownRule.id,
            action: "none",
            triggered: false,
            reason: "frequency_limited",
        });

        const frequencyKeys = await findRedisKeys(`${redisNamespace}:frequency:*`);
        expect(frequencyKeys.length).toBeGreaterThan(0);
        expect(frequencyKeys.every((key) => !key.includes(forwardedIndiaIp))).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 10100));
        const afterCooldown = await evaluate(project).expect(200);
        expect(afterCooldown.body).toMatchObject({
            matched: true,
            ruleId: cooldownRule.id,
            triggered: true,
        });
        await waitForEventCount(project.id, 3);
        const cooldownEvents = await ownerAgent
            .get(`/api/projects/${project.id}/events`)
            .expect(200);
        expect(cooldownEvents.body.events.some(({ reason, triggered }) =>
            reason === "frequency_limited" && triggered === false,
        )).toBe(true);

        const returnProject = await createProject();
        const returnRule = await createRule(returnProject.id, ruleInput({
            name: "Return after",
            frequencyEnabled: true,
            frequencySeconds: 1,
            frequencyMode: "return_after",
        }));
        const firstVisit = await evaluate(returnProject).expect(200);
        expect(firstVisit.body).toMatchObject({
            matched: true,
            ruleId: returnRule.id,
            action: "none",
            triggered: false,
            reason: "frequency_recorded",
        });
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const returningVisit = await evaluate(returnProject).expect(200);
        expect(returningVisit.body).toMatchObject({
            matched: true,
            ruleId: returnRule.id,
            action: "redirect",
            triggered: true,
            reason: "rule_matched",
        });

        const concurrentProject = await createProject();
        const concurrentRule = await createRule(concurrentProject.id, ruleInput({
            name: "Concurrent frequency rule",
            frequencyEnabled: true,
            frequencySeconds: 10,
            frequencyMode: "cooldown",
        }));
        const concurrentResponses = await Promise.all(
            Array.from({ length: 8 }, () => evaluate(concurrentProject)),
        );
        expect(concurrentResponses.every(({ status }) => status === 200)).toBe(true);
        expect(concurrentResponses.filter(({ body }) => body.triggered === true)).toHaveLength(1);
        expect(concurrentResponses.filter(({ body }) => body.reason === "frequency_limited")).toHaveLength(7);
        expect(concurrentResponses.every(({ body }) => body.ruleId === concurrentRule.id)).toBe(true);
    }, 20000);

    it("invalidates configuration after rule/project mutations and cascades project deletion", async () => {
        const project = await createProject();
        const rule = await createRule(project.id, ruleInput({
            conditions: { field: "device_type", operator: "equals", value: "mobile" },
        }));

        const first = await evaluate(project).expect(200);
        expect(first.body).toMatchObject({ matched: true, ruleId: rule.id });
        expect(configCacheService.get(project.projectKey)).toBeDefined();

        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({
                name: "Renamed Cached Project",
                allowedOrigins: ["https://cache-update.integration.example"],
            })
            .expect(200);
        expect(configCacheService.get(project.projectKey)).toBeUndefined();
        const afterProjectUpdate = await evaluate(project).expect(200);
        expect(afterProjectUpdate.body).toMatchObject({ matched: true, ruleId: rule.id });

        await ownerAgent
            .patch(`/api/projects/${project.id}/rules/${rule.id}`)
            .send({
                conditions: { field: "device_type", operator: "equals", value: "desktop" },
            })
            .expect(200);
        expect(configCacheService.get(project.projectKey)).toBeUndefined();
        const immediatelyUpdated = await evaluate(project).expect(200);
        expect(immediatelyUpdated.body).toMatchObject({
            matched: false,
            reason: "no_match",
        });

        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: false })
            .expect(200);
        expect(configCacheService.get(project.projectKey)).toBeUndefined();
        const disabled = await evaluate(project).expect(200);
        expect(disabled.body).toMatchObject({
            matched: false,
            reason: "project_disabled",
            triggered: false,
        });
        await waitForEventCount(project.id, 4);
        const disabledEvent = await ownerAgent
            .get(`/api/projects/${project.id}/events`)
            .expect(200);
        expect(disabledEvent.body.events.some(({ reason }) => reason === "project_disabled")).toBe(true);

        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: true })
            .expect(200);
        const reenabled = await evaluate(project).expect(200);
        expect(reenabled.body).toMatchObject({ matched: false, reason: "no_match" });

        await ownerAgent
            .patch(`/api/projects/${project.id}/rules/${rule.id}`)
            .send({
                conditions: { field: "device_type", operator: "equals", value: "mobile" },
            })
            .expect(200);
        const beforeDelete = await evaluate(project).expect(200);
        expect(beforeDelete.body.matched).toBe(true);
        await waitForEventCount(project.id, 5);
        expect(configCacheService.get(project.projectKey)).toBeDefined();

        await ownerAgent
            .delete(`/api/projects/${project.id}/rules/${rule.id}`)
            .expect(200);
        expect(configCacheService.get(project.projectKey)).toBeUndefined();
        const afterRuleDelete = await evaluate(project).expect(200);
        expect(afterRuleDelete.body).toMatchObject({ matched: false, reason: "no_match" });

        await ownerAgent.delete(`/api/projects/${project.id}`).expect(200);
        expect(configCacheService.get(project.projectKey)).toBeUndefined();
        await ownerAgent.get(`/api/projects/${project.id}`).expect(404);
        const listing = await ownerAgent.get("/api/projects").expect(200);
        expect(listing.body.some(({ id }) => id === project.id)).toBe(false);
        expect(await db("rules").where({ project_id: project.id }).count({ total: "id" }).first())
            .toMatchObject({ total: "0" });
        expect(await db("events").where({ project_id: project.id }).count({ total: "id" }).first())
            .toMatchObject({ total: "0" });
        const deletedEvaluation = await evaluate(project).expect(404);
        expect(deletedEvaluation.body).toMatchObject({
            matched: false,
            reason: "project_not_found",
            triggered: false,
        });
    });

    it("enforces project-specific CORS and handles preflight without wildcard headers", async () => {
        const project = await createProject();
        await createRule(project.id);

        const allowed = await evaluate(project, { origin: allowedOrigin }).expect(200);
        expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
        expect(allowed.headers.vary).toMatch(/Origin/i);

        const denied = await evaluate(project, { origin: "https://attacker.example" }).expect(403);
        expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
        expect(denied.headers["access-control-allow-origin"]).not.toBe("*");

        const preflight = await request(app)
            .options(`/api/v1/evaluate?projectKey=${encodeURIComponent(project.projectKey)}`)
            .set("Origin", allowedOrigin)
            .set("Access-Control-Request-Method", "POST")
            .set("Access-Control-Request-Headers", "Content-Type")
            .expect(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe(allowedOrigin);
        expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
        expect(preflight.headers["access-control-allow-headers"]).toContain("Content-Type");
        expect(preflight.headers["access-control-allow-origin"]).not.toBe("*");

        await request(app)
            .post("/api/v1/evaluate?projectKey=nonexistent-integration-key")
            .set("Origin", allowedOrigin)
            .send(clientPayload)
            .expect(404);
    });

    it("rate-limits with real Redis, emits Retry-After, isolates visitors, and hashes Redis keys", async () => {
        const project = await createProject();
        await createRule(project.id, ruleInput({ action: "none" }));
        const limitedApp = createIntegrationApp({
            rateLimit: 2,
            namespace: "limited-evaluation",
        });

        const first = await evaluate(project, {
            targetApp: limitedApp,
            ip: forwardedIndiaIp,
        }).expect(200);
        const second = await evaluate(project, {
            targetApp: limitedApp,
            ip: forwardedIndiaIp,
        }).expect(200);
        expect(first.body.matched).toBe(true);
        expect(second.body.matched).toBe(true);
        const blocked = await evaluate(project, {
            targetApp: limitedApp,
            ip: forwardedIndiaIp,
        }).expect(429);
        expect(blocked.headers["retry-after"]).toMatch(/^[1-9]\d*$/);

        const differentVisitor = await evaluate(project, {
            targetApp: limitedApp,
            ip: forwardedOtherIp,
        }).expect(200);
        expect(differentVisitor.body.matched).toBe(true);

        const keys = await findRedisKeys(`${redisNamespace}:limited-evaluation:*`);
        expect(keys.length).toBeGreaterThan(0);
        expect(keys.every((key) =>
            !key.includes(forwardedIndiaIp) && !key.includes(forwardedOtherIp),
        )).toBe(true);
    });

    it("keeps Test Rules simulations request-local with no production Redis or event writes", async () => {
        const project = await createProject();
        const rule = await createRule(project.id, ruleInput({
            frequencyEnabled: true,
            frequencySeconds: 10,
            frequencyMode: "cooldown",
        }));
        const simulationPayload = {
            visitor: {
                ip: forwardedIndiaIp,
                geo: { country: "IN", region: "DL", city: "New Delhi" },
                browser: "Chrome",
                os: "Linux",
                deviceType: "mobile",
                language: "en-IN",
            },
            frequencySimulation: { visit: "returning", secondsSincePreviousTrigger: 0 },
        };

        const simulation = await ownerAgent
            .post(`/api/projects/${project.id}/test-rules`)
            .send(simulationPayload)
            .expect(200);
        expect(simulation.body).toMatchObject({
            matched: true,
            ruleId: rule.id,
            action: "none",
            triggered: false,
            reason: "frequency_limited",
            frequencyStatus: "limited",
        });
        expect(await findRedisKeys(
            `${redisNamespace}:frequency:${encodeURIComponent(project.id)}:${encodeURIComponent(rule.id)}:*`,
        )).toHaveLength(0);
        const events = await ownerAgent
            .get(`/api/projects/${project.id}/events`)
            .expect(200);
        expect(events.body.events).toHaveLength(0);

        await evaluate(project).expect(200);
        await waitForEventCount(project.id, 1);
        const frequencyKey = `${redisNamespace}:frequency:${encodeURIComponent(project.id)}:${encodeURIComponent(rule.id)}:${encodeURIComponent(visitorIdentityService.createVisitorId(forwardedIndiaIp))}`;
        const stateBeforeSimulation = await redis.get(frequencyKey);
        expect(stateBeforeSimulation).toBe("1");
        const eventCountBefore = await db("events").where({ project_id: project.id }).count({ total: "id" }).first();

        await ownerAgent
            .post(`/api/projects/${project.id}/test-rules`)
            .send(simulationPayload)
            .expect(200);

        expect(await redis.get(frequencyKey)).toBe(stateBeforeSimulation);
        const eventCountAfter = await db("events").where({ project_id: project.id }).count({ total: "id" }).first();
        expect(eventCountAfter.total).toBe(eventCountBefore.total);
    });

    it("redirects only for safe triggered decisions and handles project/frequency failures safely", async () => {
        const project = await createProject();
        const rule = await createRule(project.id, ruleInput({
            conditions: { field: "ip", operator: "equals", value: forwardedIndiaIp },
            frequencyEnabled: true,
            frequencySeconds: 10,
            frequencyMode: "cooldown",
            fullscreenMode: "prompt",
        }));

        const redirected = await request(app)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(302);
        expect(redirected.headers.location)
            .toBe("https://destination.integration.example/landing?_fs=1");
        expect(redirected.headers["cache-control"]).toBe("no-store");
        expect(redirected.headers["access-control-allow-origin"]).toBeUndefined();

        const limited = await request(app)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(204);
        expect(limited.headers.location).toBeUndefined();

        const unavailableEvaluation = createIntegrationEvaluationService({
            frequencyService: {
                checkAndRecord: async () => ({
                    triggered: false,
                    reason: "frequency_unavailable",
                }),
            },
        });
        const unavailableApp = createIntegrationApp({
            evaluationService: unavailableEvaluation,
            namespace: "frequency-unavailable",
        });
        const unavailable = await request(unavailableApp)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(204);
        expect(unavailable.headers.location).toBeUndefined();

        const noMatchProject = await createProject();
        const noMatch = await request(app)
            .get(`/r/${noMatchProject.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(204);
        expect(noMatch.headers.location).toBeUndefined();

        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: false })
            .expect(200);
        await db("rules").where({ id: rule.id }).update({ destination_url: "javascript:alert(1)" });
        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: true })
            .expect(200);
        configCacheService.delete(project.projectKey);
        const unsafeDestination = await request(app)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(204);
        expect(unsafeDestination.headers.location).toBeUndefined();

        await db("rules").where({ id: rule.id }).update({ destination_url: null });
        configCacheService.delete(project.projectKey);
        const missingDestination = await request(app)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(204);
        expect(missingDestination.headers.location).toBeUndefined();

        await ownerAgent
            .patch(`/api/projects/${project.id}`)
            .send({ enabled: false })
            .expect(200);
        const disabled = await request(app)
            .get(`/r/${project.projectKey}`)
            .set("X-Forwarded-For", forwardedIndiaIp)
            .expect(404);
        expect(disabled.headers.location).toBeUndefined();

        await request(app).get("/r/nonexistent-integration-key").expect(404);
    });

    it("rejects unsafe redirect and open-new-tab URLs on create and update", async () => {
        const project = await createProject();
        const unsafeUrls = [
            "javascript:alert(1)",
            "data:text/html,unsafe",
            "vbscript:alert(1)",
            "file:///tmp/unsafe",
            "blob:https://example.com/id",
            "about:blank",
            "//destination.example/path",
            "malformed url",
            "/relative/path",
        ];

        for (const action of ["redirect", "open_new_tab"]) {
            await ownerAgent
                .post(`/api/projects/${project.id}/rules`)
                .send(ruleInput({ action, destinationUrl: null }))
                .expect(400);
            for (const destinationUrl of unsafeUrls) {
                await ownerAgent
                    .post(`/api/projects/${project.id}/rules`)
                    .send(ruleInput({ action, destinationUrl }))
                    .expect(400);
            }
        }

        const rule = await createRule(project.id);
        for (const destinationUrl of unsafeUrls) {
            await ownerAgent
                .patch(`/api/projects/${project.id}/rules/${rule.id}`)
                .send({ destinationUrl })
                .expect(400);
        }
        await ownerAgent
            .patch(`/api/projects/${project.id}/rules/${rule.id}`)
            .send({ destinationUrl: "https://safe.integration.example/path" })
            .expect(200);
    });

    it("keeps evaluation successful when asynchronous event persistence fails", async () => {
        const project = await createProject();
        const eventRepositoryWithFailure = {
            create: vi.fn().mockRejectedValue(new Error("private integration database detail")),
        };
        const eventLoggingService = createEventLoggingService({
            eventRepository: eventRepositoryWithFailure,
        });
        const failingEventEvaluation = createIntegrationEvaluationService({
            eventLoggingService,
        });
        const failureApp = createIntegrationApp({
            evaluationService: failingEventEvaluation,
            namespace: "event-failure",
        });
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const response = await evaluate(project, {
            targetApp: failureApp,
            ip: forwardedOtherIp,
            payload: { ...clientPayload, deviceType: "tablet", language: "fr" },
        }).expect(200);
        expect(response.body).toMatchObject({
            matched: false,
            reason: "no_match",
            triggered: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(eventRepositoryWithFailure.create).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(response.body)).not.toContain("private integration database detail");
        errorSpy.mockRestore();
    });

    it("serves a standalone SDK without private configuration and preserves safe fullscreen behavior", async () => {
        const response = await request(app)
            .get("/sdk.js")
            .expect(200)
            .expect("Content-Type", /javascript/);
        const sdk = response.text;

        expect(response.headers["cache-control"]).toContain("max-age=86400");
        expect(sdk).toContain("/api/v1/evaluate");
        expect(sdk).toContain("new global.URL(");
        expect(sdk).not.toContain("navigator.geolocation");
        expect(sdk).not.toMatch(/DATABASE_URL|SESSION_SECRET|IP_HASH_SECRET|redis:\/\/|postgres(?:ql)?:\/\//i);
        expect(sdk).not.toMatch(/country\s*:|region\s*:|city\s*:|ip\s*:/i);
        expect(sdk).toContain("requestFullscreen");
        expect(sdk).toContain("addEventListener");
    });
});
