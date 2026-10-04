const { createDecision } = require("../domain/decision");
const { normalizeVisitor } = require("../domain/visitor");
const { validateDestinationUrl } = require("../validation/urlValidation");

function emptyGeo() {
    return { country: null, region: null, city: null };
}

function noActionForMatch(ruleId, reason) {
    return createDecision({
        matched: true,
        ruleId,
        action: "none",
        destinationUrl: null,
        fullscreenMode: "off",
        reason,
        triggered: false,
    });
}

function scheduleEvaluationEvent(eventLoggingService, projectId, decision, visitor, triggered) {
    if (!eventLoggingService || typeof eventLoggingService.logEvaluationEvent !== "function") {
        return;
    }

    const event = {
        projectId,
        ruleId: decision.ruleId,
        matched: decision.matched,
        triggered,
        reason: decision.reason,
        action: decision.action,
        country: visitor?.geo?.country ?? null,
        region: visitor?.geo?.region ?? null,
        deviceType: visitor?.deviceType ?? null,
        browser: visitor?.browser ?? null,
        os: visitor?.os ?? null,
    };

    try {
        Promise.resolve(eventLoggingService.logEvaluationEvent(event)).catch(() => {
            console.error("Evaluation event logging failed.");
        });
    } catch {
        console.error("Evaluation event logging failed.");
    }
}

function sanitizeDecision(decision) {
    const normalizedDecision = createDecision(decision);

    if (!normalizedDecision.matched) {
        return createDecision({
            ...normalizedDecision,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
        });
    }

    if (normalizedDecision.action === "none") {
        return createDecision({ ...normalizedDecision, destinationUrl: null });
    }

    const destination = validateDestinationUrl(normalizedDecision.destinationUrl);
    if (!destination.success) {
        return noActionForMatch(normalizedDecision.ruleId, "invalid_destination_url");
    }

    return createDecision({ ...normalizedDecision, destinationUrl: destination.data });
}

function createEvaluationService({
    projectRepository,
    ruleRepository,
    clientIpService,
    geoIpService,
    clientInfoService,
    visitorIdentityService,
    frequencyService,
    ruleEngine,
    eventLoggingService,
    configCacheService,
}) {
    async function evaluate({ projectKey, request, clientInfo } = {}) {
        let configuration;
        if (configCacheService && typeof configCacheService.get === "function") {
            try {
                configuration = configCacheService.get(projectKey);
            } catch {
                configuration = undefined;
            }
        }

        if (!configuration || !configuration.project || !Array.isArray(configuration.rules)) {
            const project = await projectRepository.findByProjectKey(projectKey);
            if (!project) {
                return createDecision({ reason: "project_not_found", triggered: false });
            }

            const rules = project.enabled === false
                ? []
                : await ruleRepository.listByProjectId(project.id);
            configuration = {
                project: {
                    id: project.id,
                    project_key: project.project_key,
                    enabled: project.enabled,
                    allowed_origins: project.allowed_origins,
                },
                rules: rules.map((rule) => ({
                    id: rule.id,
                    project_id: rule.project_id,
                    name: rule.name,
                    priority: rule.priority,
                    enabled: rule.enabled,
                    conditions: rule.conditions,
                    action: rule.action,
                    destination_url: rule.destination_url,
                    frequency_enabled: rule.frequency_enabled,
                    frequency_seconds: rule.frequency_seconds,
                    frequency_mode: rule.frequency_mode,
                    fullscreen_mode: rule.fullscreen_mode,
                })),
            };

            if (configCacheService && typeof configCacheService.set === "function") {
                try {
                    configCacheService.set(projectKey, configuration);
                } catch {
                    // The cache is an optimization; continue with the database result.
                }
            }
        }

        const { project, rules } = configuration;
        if (!project) {
            return createDecision({ reason: "project_not_found", triggered: false });
        }

        if (project.enabled === false) {
            const decision = createDecision({ reason: "project_disabled", triggered: false });
            scheduleEvaluationEvent(eventLoggingService, project.id, decision, null, false);
            return decision;
        }

        const clientIp = await clientIpService.getClientIp(request);

        let geo = emptyGeo();
        try {
            const lookup = await geoIpService.lookup(clientIp);
            if (lookup && typeof lookup === "object") {
                geo = {
                    country: lookup.country ?? null,
                    region: lookup.region ?? null,
                    city: lookup.city ?? null,
                };
            }
        } catch {
            geo = emptyGeo();
        }

        const normalizedClientInfo = await clientInfoService.normalizeClientInfo(clientInfo);
        const visitor = normalizeVisitor({
            ...normalizedClientInfo,
            ip: clientIp,
            geo,
        });

        const decision = sanitizeDecision(await ruleEngine.evaluateRules(visitor, rules));
        if (!decision.matched) {
            const result = createDecision({ ...decision, triggered: false });
            scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
            return result;
        }

        if (decision.reason === "invalid_destination_url") {
            const result = createDecision({ ...decision, triggered: false });
            scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
            return result;
        }

        if (!decision.ruleId) {
            const result = noActionForMatch(null, "rule_configuration_unavailable");
            scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
            return result;
        }

        const matchingRule = rules.find((rule) => rule.id === decision.ruleId);
        if (!matchingRule) {
            const result = noActionForMatch(null, "rule_configuration_unavailable");
            scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
            return result;
        }

        let visitorId = null;
        if (matchingRule.frequency_enabled !== false) {
            if (typeof clientIp !== "string" || clientIp.trim() === "") {
                const result = noActionForMatch(decision.ruleId, "client_ip_unavailable");
                scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
                return result;
            }

            visitorId = await visitorIdentityService.createVisitorId(clientIp);
        }

        const frequencyResult = await frequencyService.checkAndRecord({
            projectId: project.id,
            ruleId: decision.ruleId,
            visitorId,
            frequencyEnabled: matchingRule.frequency_enabled,
            frequencySeconds: matchingRule.frequency_seconds,
            frequencyMode: matchingRule.frequency_mode,
        });

        if (frequencyResult?.triggered === true) {
            const result = createDecision({
                ...decision,
                triggered: decision.action !== "none",
            });
            scheduleEvaluationEvent(
                eventLoggingService,
                project.id,
                result,
                visitor,
                result.triggered,
            );
            return result;
        }

        const result = noActionForMatch(
            decision.ruleId,
            frequencyResult?.reason || "frequency_unavailable",
        );
        scheduleEvaluationEvent(eventLoggingService, project.id, result, visitor, false);
        return result;
    }

    return { evaluate };
}

module.exports = { createEvaluationService };