function toEventResponse(event) {
    return {
        id: event.id,
        projectId: event.project_id,
        ruleId: event.rule_id,
        createdAt: event.created_at,
        matched: event.matched,
        triggered: event.triggered,
        reason: event.reason,
        action: event.action,
        country: event.country,
        region: event.region,
        deviceType: event.device_type,
        browser: event.browser,
        os: event.os,
    };
}

function createEventService({ projectService, eventRepository }) {
    return {
        async listByProjectId(projectId, authenticatedUserId, { page, pageSize }) {
            const project = await projectService.getById(projectId, authenticatedUserId);
            if (!project) return null;

            const offset = (page - 1) * pageSize;
            const [events, total] = await Promise.all([
                eventRepository.listByProjectId(projectId, { limit: pageSize, offset }),
                eventRepository.countByProjectId(projectId),
            ]);

            return {
                events: events.map(toEventResponse),
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize),
                },
            };
        },
    };
}

module.exports = { createEventService };
