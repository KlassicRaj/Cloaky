function nullableString(value) {
    return typeof value === "string" ? value : null;
}

function createEventLoggingService({ eventRepository }) {
    async function logEvaluationEvent(event) {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
            return;
        }

        if (typeof event.projectId !== "string" || event.projectId.trim() === "") {
            return;
        }

        const record = {
            project_id: event.projectId,
            rule_id: nullableString(event.ruleId),
            matched: event.matched === true,
            triggered: event.triggered === true,
            reason: typeof event.reason === "string" && event.reason ? event.reason : "evaluation_unavailable",
            action: typeof event.action === "string" && event.action ? event.action : "none",
            country: nullableString(event.country),
            region: nullableString(event.region),
            device_type: nullableString(event.deviceType),
            browser: nullableString(event.browser),
            os: nullableString(event.os),
        };

        try {
            await eventRepository.create(record);
        } catch {
            console.error("Evaluation event persistence failed.");
        }
    }

    return { logEvaluationEvent };
}

module.exports = { createEventLoggingService };