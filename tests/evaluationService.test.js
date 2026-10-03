import { describe, expect, it, vi } from "vitest";

const { createEvaluationService } = require("../src/services/evaluationService");

function matchedDecision(overrides = {}) {
    return {
        matched: true,
        ruleId: "rule-1",
        action: "redirect",
        destinationUrl: "https://example.com",
        fullscreenMode: "prompt",
        reason: "rule_matched",
        ...overrides,
    };
}

function makeDependencies(overrides = {}) {
    const project = {
        id: "project-1",
        project_key: "public-project-key",
        enabled: true,
    };
    const rule = {
        id: "rule-1",
        project_id: project.id,
        frequency_enabled: true,
        frequency_seconds: 60,
        frequency_mode: "cooldown",
    };
    const dependencies = {
        projectRepository: {
            findByProjectKey: vi.fn().mockResolvedValue(project),
        },
        ruleRepository: {
            listByProjectId: vi.fn().mockResolvedValue([rule]),
        },
        clientIpService: {
            getClientIp: vi.fn().mockReturnValue("203.0.113.10"),
        },
        geoIpService: {
            lookup: vi.fn().mockReturnValue({ country: "IN", region: "DL", city: "New Delhi" }),
        },
        clientInfoService: {
            normalizeClientInfo: vi.fn().mockImplementation((clientInfo = {}) => ({
                browser: clientInfo.browser ?? null,
                os: clientInfo.os ?? null,
                deviceType: clientInfo.deviceType ?? null,
                language: clientInfo.language ?? null,
                timezone: clientInfo.timezone ?? null,
                screen: clientInfo.screen ?? { width: null, height: null },
            })),
        },
        visitorIdentityService: {
            createVisitorId: vi.fn().mockReturnValue("hashed-visitor-id"),
        },
        frequencyService: {
            checkAndRecord: vi.fn().mockResolvedValue({
                triggered: true,
                reason: "frequency_triggered",
            }),
        },
        ruleEngine: {
            evaluateRules: vi.fn().mockReturnValue(matchedDecision()),
        },
        eventLoggingService: {
            logEvaluationEvent: vi.fn().mockResolvedValue(undefined),
        },
        fixtures: { project, rule },
    };

    return { ...dependencies, ...overrides };
}

function createService(dependencies) {
    return createEvaluationService(dependencies);
}

describe("EvaluationService", () => {
    it("returns project_not_found when the project does not exist", async () => {
        const dependencies = makeDependencies();
        dependencies.projectRepository.findByProjectKey.mockResolvedValue(null);

        await expect(createService(dependencies).evaluate({ projectKey: "missing" })).resolves.toMatchObject({
            matched: false,
            action: "none",
            reason: "project_not_found",
        });
        expect(dependencies.ruleRepository.listByProjectId).not.toHaveBeenCalled();
    });

    it("returns project_disabled without evaluating rules", async () => {
        const dependencies = makeDependencies();
        dependencies.fixtures.project.enabled = false;

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toMatchObject({ matched: false, action: "none", reason: "project_disabled" });
        expect(dependencies.eventLoggingService.logEvaluationEvent).toHaveBeenCalledWith(expect.objectContaining({
            projectId: "project-1",
            ruleId: null,
            matched: false,
            triggered: false,
            reason: "project_disabled",
            action: "none",
        }));
        expect(dependencies.ruleRepository.listByProjectId).not.toHaveBeenCalled();
        expect(dependencies.ruleEngine.evaluateRules).not.toHaveBeenCalled();
    });

    it("evaluates an empty rule list and returns no_match", async () => {
        const dependencies = makeDependencies();
        dependencies.ruleRepository.listByProjectId.mockResolvedValue([]);
        dependencies.ruleEngine.evaluateRules.mockReturnValue({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        });

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toMatchObject({ matched: false, reason: "no_match" });
        expect(dependencies.frequencyService.checkAndRecord).not.toHaveBeenCalled();
        expect(dependencies.eventLoggingService.logEvaluationEvent).toHaveBeenCalledWith(expect.objectContaining({
            projectId: "project-1",
            ruleId: null,
            matched: false,
            triggered: false,
            reason: "no_match",
            action: "none",
        }));
    });

    it("continues with null geo when GeoIP lookup throws", async () => {
        const dependencies = makeDependencies();
        dependencies.geoIpService.lookup.mockImplementation(() => { throw new Error("GeoIP unavailable"); });

        await createService(dependencies).evaluate({ projectKey: "public-project-key" });

        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].geo)
            .toEqual({ country: null, region: null, city: null });
    });

    it("uses null browserGeo when it is missing", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: {},
        });

        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].browserGeo).toBeNull();
    });

    it("includes valid browser geolocation", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: { browserGeo: { latitude: "45.5", longitude: -90, accuracy: 12 } },
        });

        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].browserGeo).toEqual({
            latitude: 45.5,
            longitude: -90,
            accuracy: 12,
        });
    });

    it("nulls invalid browser geolocation values", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: { browserGeo: { latitude: 91, longitude: "bad", accuracy: 0 } },
        });

        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].browserGeo).toEqual({
            latitude: null,
            longitude: null,
            accuracy: null,
        });
    });

    it("uses the server-derived IP instead of clientInfo.ip", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            request: { socket: { remoteAddress: "unexamined" } },
            clientInfo: { ip: "8.8.8.8" },
        });

        expect(dependencies.clientIpService.getClientIp).toHaveBeenCalledWith({
            socket: { remoteAddress: "unexamined" },
        });
        expect(dependencies.geoIpService.lookup).toHaveBeenCalledWith("203.0.113.10");
        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].ip).toBe("203.0.113.10");
        expect(dependencies.visitorIdentityService.createVisitorId).toHaveBeenCalledWith("203.0.113.10");
    });

    it("uses server GeoIP instead of client-provided geo fields", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: {
                geo: { country: "US", region: "CA", city: "Los Angeles" },
                country: "US",
            },
        });

        expect(dependencies.ruleEngine.evaluateRules.mock.calls[0][0].geo)
            .toEqual({ country: "IN", region: "DL", city: "New Delhi" });
    });

    it("passes the normalized visitor and retrieved rules to RuleEngine", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: {
                browser: "Chrome",
                os: "Linux",
                deviceType: "desktop",
                language: "en-IN",
                timezone: "Asia/Kolkata",
                screen: { width: 1280, height: 720 },
            },
        });

        const [visitor, rules] = dependencies.ruleEngine.evaluateRules.mock.calls[0];
        expect(visitor).toMatchObject({
            ip: "203.0.113.10",
            geo: { country: "IN", region: "DL", city: "New Delhi" },
            browser: "Chrome",
            os: "Linux",
            deviceType: "desktop",
            language: "en-IN",
            timezone: "Asia/Kolkata",
            screen: { width: 1280, height: 720 },
        });
        expect(rules).toEqual([dependencies.fixtures.rule]);
    });

    it("does not call FrequencyService when RuleEngine returns no match", async () => {
        const dependencies = makeDependencies();
        const noMatchDecision = {
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        };
        dependencies.ruleEngine.evaluateRules.mockReturnValue(noMatchDecision);

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toEqual(noMatchDecision);
        expect(dependencies.frequencyService.checkAndRecord).not.toHaveBeenCalled();
    });

    it("passes the matched rule frequency configuration to FrequencyService", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({ projectKey: "public-project-key" });

        expect(dependencies.frequencyService.checkAndRecord).toHaveBeenCalledWith({
            projectId: "project-1",
            ruleId: "rule-1",
            visitorId: "hashed-visitor-id",
            frequencyEnabled: true,
            frequencySeconds: 60,
            frequencyMode: "cooldown",
        });
    });

    it("logs a successful matched and triggered evaluation without IP identifiers", async () => {
        const dependencies = makeDependencies();

        await createService(dependencies).evaluate({ projectKey: "public-project-key" });

        expect(dependencies.eventLoggingService.logEvaluationEvent).toHaveBeenCalledWith({
            projectId: "project-1",
            ruleId: "rule-1",
            matched: true,
            triggered: true,
            reason: "rule_matched",
            action: "redirect",
            country: "IN",
            region: "DL",
            deviceType: null,
            browser: null,
            os: null,
        });
        const event = dependencies.eventLoggingService.logEvaluationEvent.mock.calls[0][0];
        expect(event).not.toHaveProperty("ip");
        expect(event).not.toHaveProperty("visitorId");
    });

    it("preserves the rule decision when frequency is disabled", async () => {
        const dependencies = makeDependencies();
        dependencies.fixtures.rule.frequency_enabled = false;
        dependencies.frequencyService.checkAndRecord.mockResolvedValue({
            triggered: true,
            reason: "frequency_disabled",
        });

        const result = await createService(dependencies).evaluate({ projectKey: "public-project-key" });

        expect(dependencies.visitorIdentityService.createVisitorId).not.toHaveBeenCalled();
        expect(dependencies.frequencyService.checkAndRecord).toHaveBeenCalledWith(expect.objectContaining({
            frequencyEnabled: false,
            visitorId: null,
        }));
        expect(result).toMatchObject({ matched: true, action: "redirect", reason: "rule_matched" });
    });

    it("returns a normalized safe Rule Engine decision when frequency allows triggering", async () => {
        const dependencies = makeDependencies();
        const decision = matchedDecision();
        dependencies.ruleEngine.evaluateRules.mockReturnValue(decision);

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toMatchObject({
                ...decision,
                destinationUrl: "https://example.com/",
            });
    });

    it("suppresses an unsafe destination from a persisted rule", async () => {
        const dependencies = makeDependencies();
        dependencies.ruleEngine.evaluateRules.mockReturnValue(matchedDecision({
            destinationUrl: "JaVaScRiPt:alert(1)",
        }));

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toEqual({
                matched: true,
                ruleId: "rule-1",
                action: "none",
                destinationUrl: null,
                fullscreenMode: "off",
                reason: "invalid_destination_url",
            });
        expect(dependencies.frequencyService.checkAndRecord).not.toHaveBeenCalled();
    });

    it("removes a destination from a matched none-action decision", async () => {
        const dependencies = makeDependencies();
        dependencies.ruleEngine.evaluateRules.mockReturnValue(matchedDecision({
            action: "none",
            destinationUrl: "https://example.com",
        }));

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toMatchObject({ matched: true, action: "none", destinationUrl: null });
    });

    it.each(["frequency_limited", "frequency_unavailable"])(
        "returns a safe no-action decision when frequency reports %s",
        async (reason) => {
            const dependencies = makeDependencies();
            dependencies.frequencyService.checkAndRecord.mockResolvedValue({ triggered: false, reason });

            await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
                .resolves.toEqual({
                    matched: true,
                    ruleId: "rule-1",
                    action: "none",
                    destinationUrl: null,
                    fullscreenMode: "off",
                    reason,
                });
            expect(dependencies.eventLoggingService.logEvaluationEvent).toHaveBeenCalledWith(expect.objectContaining({
                projectId: "project-1",
                ruleId: "rule-1",
                matched: true,
                triggered: false,
                reason,
                action: "none",
            }));
        },
    );

    it("does not wait for a delayed event persistence promise", async () => {
        const dependencies = makeDependencies();
        let finishPersistence;
        const pendingPersistence = new Promise((resolve) => {
            finishPersistence = resolve;
        });
        dependencies.eventLoggingService.logEvaluationEvent.mockReturnValue(pendingPersistence);

        const result = await createService(dependencies).evaluate({ projectKey: "public-project-key" });

        expect(result).toMatchObject({ matched: true, action: "redirect" });
        expect(dependencies.eventLoggingService.logEvaluationEvent).toHaveBeenCalledTimes(1);
        finishPersistence();
    });

    it("keeps evaluation successful when event logging rejects", async () => {
        const dependencies = makeDependencies();
        dependencies.eventLoggingService.logEvaluationEvent.mockRejectedValue(new Error("event DB failed"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .resolves.toMatchObject({ matched: true, action: "redirect" });
        await Promise.resolve();

        expect(consoleError).toHaveBeenCalledWith("Evaluation event logging failed.");
        consoleError.mockRestore();
    });

    it("does not create an identity from client data if the server IP is missing", async () => {
        const dependencies = makeDependencies();
        dependencies.clientIpService.getClientIp.mockReturnValue(null);

        await expect(createService(dependencies).evaluate({
            projectKey: "public-project-key",
            clientInfo: { ip: "8.8.8.8" },
        })).resolves.toMatchObject({
            matched: true,
            ruleId: "rule-1",
            action: "none",
            reason: "client_ip_unavailable",
        });
        expect(dependencies.visitorIdentityService.createVisitorId).not.toHaveBeenCalled();
        expect(dependencies.frequencyService.checkAndRecord).not.toHaveBeenCalled();
    });

    it("propagates project repository failures", async () => {
        const dependencies = makeDependencies();
        dependencies.projectRepository.findByProjectKey.mockRejectedValue(new Error("repository failed"));

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .rejects.toThrow("repository failed");
    });

    it("propagates Rule Engine failures", async () => {
        const dependencies = makeDependencies();
        dependencies.ruleEngine.evaluateRules.mockImplementation(() => { throw new Error("engine failed"); });

        await expect(createService(dependencies).evaluate({ projectKey: "public-project-key" }))
            .rejects.toThrow("engine failed");
    });

    it("does not mutate client info, project, or rules", async () => {
        const dependencies = makeDependencies();
        const project = structuredClone(dependencies.fixtures.project);
        const rule = structuredClone(dependencies.fixtures.rule);
        const clientInfo = {
            browser: " Chrome ",
            ip: "8.8.8.8",
            geo: { country: "US", region: "CA", city: "Los Angeles" },
            browserGeo: { latitude: "12.5", longitude: "77.5", accuracy: 10 },
            screen: { width: "390", height: 844 },
        };
        const originalClientInfo = structuredClone(clientInfo);

        await createService(dependencies).evaluate({ projectKey: "public-project-key", clientInfo });

        expect(clientInfo).toEqual(originalClientInfo);
        expect(dependencies.fixtures.project).toEqual(project);
        expect(dependencies.fixtures.rule).toEqual(rule);
    });
});