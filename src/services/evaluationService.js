const { createDecision } = require("../domain/decision");
const { normalizeVisitor } = require("../domain/visitor");
const { validateDestinationUrl } = require("../validation/urlValidation");

function emptyGeo() {
    return { country: null, region: null, city: null };
}

function normalizeBrowserGeo(browserGeo) {
    if (!browserGeo || typeof browserGeo !== "object" || Array.isArray(browserGeo)) {
        return null;
    }

    const normalized = normalizeVisitor({ browserGeo }).browserGeo;
    if (!normalized) {
        return null;
    }

    return {
        latitude: normalized.latitude !== null && normalized.latitude >= -90 && normalized.latitude <= 90
            ? normalized.latitude
            : null,
        longitude: normalized.longitude !== null && normalized.longitude >= -180 && normalized.longitude <= 180
            ? normalized.longitude
            : null,
        accuracy: normalized.accuracy !== null && normalized.accuracy > 0
            ? normalized.accuracy
            : null,
    };
}

function noActionForMatch(ruleId, reason) {
    return createDecision({
        matched: true,
        ruleId,
        action: "none",
        destinationUrl: null,
        fullscreenMode: "off",
        reason,
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
}) {
    async function evaluate({ projectKey, request, clientInfo } = {}) {
        const project = await projectRepository.findByProjectKey(projectKey);
        if (!project) {
            return createDecision({ reason: "project_not_found" });
        }

        if (project.enabled === false) {
            const decision = createDecision({ reason: "project_disabled" });
            scheduleEvaluationEvent(eventLoggingService, project.id, decision, null, false);
            return decision;
        }

        const rules = await ruleRepository.listByProjectId(project.id);
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
            browserGeo: normalizeBrowserGeo(clientInfo?.browserGeo),
        });

        const decision = sanitizeDecision(await ruleEngine.evaluateRules(visitor, rules));
        if (!decision.matched) {
            scheduleEvaluationEvent(eventLoggingService, project.id, decision, visitor, false);
            return decision;
        }

        if (decision.reason === "invalid_destination_url") {
            scheduleEvaluationEvent(eventLoggingService, project.id, decision, visitor, false);
            return decision;
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
            scheduleEvaluationEvent(
                eventLoggingService,
                project.id,
                decision,
                visitor,
                decision.action !== "none",
            );
            return decision;
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