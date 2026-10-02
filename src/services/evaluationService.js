const { createDecision } = require("../domain/decision");
const { normalizeVisitor } = require("../domain/visitor");

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

function createEvaluationService({
    projectRepository,
    ruleRepository,
    clientIpService,
    geoIpService,
    clientInfoService,
    visitorIdentityService,
    frequencyService,
    ruleEngine,
}) {
    async function evaluate({ projectKey, request, clientInfo } = {}) {
        const project = await projectRepository.findByProjectKey(projectKey);
        if (!project) {
            return createDecision({ reason: "project_not_found" });
        }

        if (project.enabled === false) {
            return createDecision({ reason: "project_disabled" });
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

        const decision = await ruleEngine.evaluateRules(visitor, rules);
        if (!decision.matched) {
            return decision;
        }

        if (!decision.ruleId) {
            return noActionForMatch(null, "rule_configuration_unavailable");
        }

        const matchingRule = rules.find((rule) => rule.id === decision.ruleId);
        if (!matchingRule) {
            return noActionForMatch(decision.ruleId, "rule_configuration_unavailable");
        }

        let visitorId = null;
        if (matchingRule.frequency_enabled !== false) {
            if (typeof clientIp !== "string" || clientIp.trim() === "") {
                return noActionForMatch(decision.ruleId, "client_ip_unavailable");
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
            return decision;
        }

        return noActionForMatch(
            decision.ruleId,
            frequencyResult?.reason || "frequency_unavailable",
        );
    }

    return { evaluate };
}

module.exports = { createEvaluationService };