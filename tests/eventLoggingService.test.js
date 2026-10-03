import { describe, expect, it, vi } from "vitest";

const { createEventLoggingService } = require("../src/services/eventLoggingService");

function createEventRepository(create = vi.fn().mockResolvedValue(undefined)) {
    return { create };
}

function sampleEvent(overrides = {}) {
    return {
        projectId: "project-1",
        ruleId: "rule-1",
        matched: true,
        triggered: true,
        reason: "rule_matched",
        action: "redirect",
        country: "IN",
        region: "DL",
        deviceType: "desktop",
        browser: "Chrome",
        os: "Linux",
        ...overrides,
    };
}

describe("eventLoggingService", () => {
    it("passes only schema-approved event columns to eventRepository", async () => {
        const eventRepository = createEventRepository();
        const service = createEventLoggingService({ eventRepository });

        await service.logEvaluationEvent(sampleEvent());

        expect(eventRepository.create).toHaveBeenCalledWith({
            project_id: "project-1",
            rule_id: "rule-1",
            matched: true,
            triggered: true,
            reason: "rule_matched",
            action: "redirect",
            country: "IN",
            region: "DL",
            device_type: "desktop",
            browser: "Chrome",
            os: "Linux",
        });
    });

    it("does not forward raw IP, visitor IDs, hashes, Redis keys, or request data", async () => {
        const eventRepository = createEventRepository();
        const service = createEventLoggingService({ eventRepository });
        const event = sampleEvent({
            ip: "203.0.113.10",
            visitorId: "visitor-secret-id",
            ipHash: "private-ip-hash",
            redisKey: "rate_limit:private-key",
            cookies: "session-cookie",
            authorization: "Bearer secret",
            secret: "server-secret",
            headers: { authorization: "Bearer secret" },
            request: { headers: { cookie: "session-cookie" } },
            body: { ip: "203.0.113.10" },
            created_at: new Date().toISOString(),
            id: "client-event-id",
        });

        await service.logEvaluationEvent(event);

        const [persisted] = eventRepository.create.mock.calls[0];
        expect(Object.keys(persisted).sort()).toEqual([
            "action",
            "browser",
            "country",
            "device_type",
            "matched",
            "os",
            "project_id",
            "reason",
            "region",
            "rule_id",
            "triggered",
        ]);
        expect(JSON.stringify(persisted)).not.toContain("203.0.113.10");
        expect(JSON.stringify(persisted)).not.toContain("visitor-secret-id");
        expect(JSON.stringify(persisted)).not.toContain("private-ip-hash");
        expect(JSON.stringify(persisted)).not.toContain("rate_limit:");
    });

    it("uses null rule/location fields when no rule or enrichment exists", async () => {
        const eventRepository = createEventRepository();
        const service = createEventLoggingService({ eventRepository });

        await service.logEvaluationEvent(sampleEvent({
            ruleId: null,
            matched: false,
            triggered: false,
            reason: "no_match",
            action: "none",
            country: null,
            region: null,
            deviceType: null,
            browser: null,
            os: null,
        }));

        expect(eventRepository.create).toHaveBeenCalledWith(expect.objectContaining({
            rule_id: null,
            matched: false,
            triggered: false,
            reason: "no_match",
            action: "none",
            country: null,
            region: null,
            device_type: null,
            browser: null,
            os: null,
        }));
    });

    it("catches repository failures and logs no error details", async () => {
        const eventRepository = createEventRepository(
            vi.fn().mockRejectedValue(new Error("database URL contains credentials")),
        );
        const service = createEventLoggingService({ eventRepository });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(service.logEvaluationEvent(sampleEvent())).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalledWith("Evaluation event persistence failed.");
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("database URL contains credentials");
        consoleError.mockRestore();
    });

    it("does not attempt persistence without a project ID", async () => {
        const eventRepository = createEventRepository();
        const service = createEventLoggingService({ eventRepository });

        await service.logEvaluationEvent(sampleEvent({ projectId: null }));

        expect(eventRepository.create).not.toHaveBeenCalled();
    });
});