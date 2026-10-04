const ACTIONS = new Set(["redirect", "open_new_tab", "none"]);
const FULLSCREEN_MODES = new Set(["off", "prompt"]);

function normalizeString(value, fallback = null) {
    if (typeof value !== "string") {
        return fallback;
    }

    return value.trim() || fallback;
}

function createDecision(input = {}) {
    const decision = input && typeof input === "object" && !Array.isArray(input) ? input : {};

    const normalized = {
        matched: typeof decision.matched === "boolean" ? decision.matched : false,
        ruleId: normalizeString(decision.ruleId),
        action: ACTIONS.has(decision.action) ? decision.action : "none",
        destinationUrl: normalizeString(decision.destinationUrl),
        fullscreenMode: FULLSCREEN_MODES.has(decision.fullscreenMode)
            ? decision.fullscreenMode
            : "off",
        reason: normalizeString(decision.reason, "no_match"),
    };

    if (typeof decision.triggered === "boolean") {
        normalized.triggered = decision.triggered;
    }

    return normalized;
}

module.exports = { createDecision };