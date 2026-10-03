import { describe, expect, it, vi } from "vitest";

const request = require("supertest");
const { createApp } = require("../src/server");
const { createSessionService, SESSION_COOKIE_NAME } = require("../src/services/sessionService");

const ownerId = "a3fd3a30-6f04-48ba-b440-700f9f8398fc";
const otherUserId = "b3fd3a30-6f04-48ba-b440-700f9f8398fc";
const projectId = "8e5efb54-49f0-4ce4-b224-90f8365d8e20";
const otherProjectId = "9e5efb54-49f0-4ce4-b224-90f8365d8e20";
const sessionSecret = "event-api-tests-session-secret-longer-than-32-bytes";

const eventRecords = [
    {
        id: "10000000-0000-4000-8000-000000000001",
        project_id: projectId,
        rule_id: "20000000-0000-4000-8000-000000000001",
        created_at: "2026-10-03T12:00:00.000Z",
        matched: true,
        triggered: true,
        reason: "rule_matched",
        action: "redirect",
        country: "IN",
        region: "DL",
        device_type: "desktop",
        browser: "Chrome",
        os: "Linux",
        ip: "203.0.113.10",
        visitor_id: "private-visitor-id",
        cookies: "session-cookie",
        authorization: "secret-token",
        headers: { authorization: "secret-token" },
        body: { secret: "private-request-data" },
    },
    {
        id: "10000000-0000-4000-8000-000000000002",
        project_id: projectId,
        rule_id: null,
        created_at: "2026-10-03T11:00:00.000Z",
        matched: false,
        triggered: false,
        reason: "no_match",
        action: "none",
        country: null,
        region: null,
        device_type: null,
        browser: "Firefox",
        os: "Windows",
    },
    {
        id: "10000000-0000-4000-8000-000000000003",
        project_id: projectId,
        rule_id: null,
        created_at: "2026-10-03T10:00:00.000Z",
        matched: false,
        triggered: false,
        reason: "no_match",
        action: "none",
        country: null,
        region: null,
        device_type: null,
        browser: null,
        os: null,
    },
];

function createTestApp(events = eventRecords) {
    const sessionService = createSessionService({ secret: sessionSecret });
    const projectOwners = new Map([
        [projectId, ownerId],
        [otherProjectId, otherUserId],
    ]);
    const userRepository = {
        findById: vi.fn(async (id) => id === ownerId ? { id: ownerId, username: "owner" } : null),
        findByUsername: vi.fn(),
    };
    const projectService = {
        getById: vi.fn(async (id, authenticatedUserId) => (
            projectOwners.get(id) === authenticatedUserId
                ? { id, userId: authenticatedUserId }
                : null
        )),
    };
    const eventRepository = {
        listByProjectId: vi.fn(async (_id, { limit, offset }) => (
            [...events]
                .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
                .slice(offset, offset + limit)
        )),
        countByProjectId: vi.fn(async () => events.length),
    };
    const app = createApp({
        userRepository,
        projectService,
        eventRepository,
        sessionService,
        projectRepository: { findByProjectKey: vi.fn() },
        evaluationService: { evaluate: vi.fn() },
        loginRateLimitMiddleware: (req, res, next) => next(),
        rateLimitMiddleware: (req, res, next) => next(),
    });
    const token = sessionService.createSession(ownerId).token;

    return {
        app,
        projectService,
        eventRepository,
        authenticatedRequest(requestedProjectId = projectId) {
            return request(app)
                .get(`/api/projects/${requestedProjectId}/events`)
                .set("Cookie", `${SESSION_COOKIE_NAME}=${token}`);
        },
    };
}

describe("authenticated Events API", () => {
    it("returns 401 without an authenticated session", async () => {
        const { app } = createTestApp();

        await request(app).get(`/api/projects/${projectId}/events`).expect(401, {
            error: "unauthorized",
        });
    });

    it("returns 404 for a nonexistent project", async () => {
        const { authenticatedRequest, projectService } = createTestApp();

        await authenticatedRequest(otherProjectId)
            .expect(404, { error: "project_not_found" });
        expect(projectService.getById).toHaveBeenCalledWith(otherProjectId, ownerId);
    });

    it("returns 404 for another user's project without trusting a user ID header", async () => {
        const { authenticatedRequest, projectService } = createTestApp();

        await authenticatedRequest(otherProjectId)
            .set("X-User-Id", otherUserId)
            .expect(404, { error: "project_not_found" });
        expect(projectService.getById).toHaveBeenCalledWith(otherProjectId, ownerId);
    });

    it("returns events to the authenticated project owner with default pagination", async () => {
        const { authenticatedRequest, eventRepository } = createTestApp();
        const response = await authenticatedRequest().expect(200);

        expect(response.body.pagination).toEqual({
            page: 1,
            pageSize: 50,
            total: 3,
            totalPages: 1,
        });
        expect(response.body.events.map(({ id }) => id)).toEqual([
            eventRecords[0].id,
            eventRecords[1].id,
            eventRecords[2].id,
        ]);
        expect(eventRepository.listByProjectId).toHaveBeenCalledWith(projectId, {
            limit: 50,
            offset: 0,
        });
        expect(eventRepository.countByProjectId).toHaveBeenCalledWith(projectId);
    });

    it("uses validated custom page and pageSize values", async () => {
        const { authenticatedRequest, eventRepository } = createTestApp();
        const response = await authenticatedRequest().query({ page: 2, pageSize: 2 }).expect(200);

        expect(response.body.pagination).toEqual({
            page: 2,
            pageSize: 2,
            total: 3,
            totalPages: 2,
        });
        expect(response.body.events.map(({ id }) => id)).toEqual([eventRecords[2].id]);
        expect(eventRepository.listByProjectId).toHaveBeenCalledWith(projectId, {
            limit: 2,
            offset: 2,
        });
    });

    it("allows pageSize up to the maximum of 100", async () => {
        const { authenticatedRequest, eventRepository } = createTestApp();

        await authenticatedRequest().query({ pageSize: 100 }).expect(200);
        expect(eventRepository.listByProjectId).toHaveBeenCalledWith(projectId, {
            limit: 100,
            offset: 0,
        });
    });

    it.each(["0", "-1", "1.5", "invalid", "9007199254740992"])(
        "rejects invalid page value %s",
        async (page) => {
            const { authenticatedRequest, eventRepository } = createTestApp();

            await authenticatedRequest().query({ page }).expect(400);
            expect(eventRepository.listByProjectId).not.toHaveBeenCalled();
        },
    );

    it.each(["0", "101", "1.5", "1; DROP TABLE events"])(
        "rejects invalid pageSize value %s",
        async (pageSize) => {
            const { authenticatedRequest, eventRepository } = createTestApp();

            await authenticatedRequest().query({ pageSize }).expect(400);
            expect(eventRepository.listByProjectId).not.toHaveBeenCalled();
        },
    );

    it.each(["sort", "userId"])("rejects unrecognized query parameter %s", async (parameter) => {
        const { authenticatedRequest, eventRepository } = createTestApp();

        await authenticatedRequest().query({ [parameter]: "client-supplied-value" }).expect(400);
        expect(eventRepository.listByProjectId).not.toHaveBeenCalled();
    });

    it("returns an empty result with zero pagination pages for an empty project", async () => {
        const { authenticatedRequest, eventRepository } = createTestApp([]);

        await authenticatedRequest()
            .expect(200, {
                events: [],
                pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
            });
        expect(eventRepository.listByProjectId).toHaveBeenCalledWith(projectId, {
            limit: 50,
            offset: 0,
        });
        expect(eventRepository.countByProjectId).toHaveBeenCalledWith(projectId);
    });

    it("returns analytics fields only and excludes sensitive event data", async () => {
        const { authenticatedRequest } = createTestApp();
        const response = await authenticatedRequest().expect(200);

        expect(response.body.events[0]).toEqual({
            id: eventRecords[0].id,
            projectId,
            ruleId: eventRecords[0].rule_id,
            createdAt: eventRecords[0].created_at,
            matched: true,
            triggered: true,
            reason: "rule_matched",
            action: "redirect",
            country: "IN",
            region: "DL",
            deviceType: "desktop",
            browser: "Chrome",
            os: "Linux",
        });
        expect(Object.keys(response.body.events[0]).sort()).toEqual([
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
        ]);
        expect(JSON.stringify(response.body)).not.toMatch(
            /203\.0\.113\.10|private-visitor-id|session-cookie|secret-token|private-request-data/,
        );
    });
});
