const { createRuleSchema } = require("../validation/ruleValidation");

function ruleConfigurationError(issues) {
    const error = new Error("Invalid rule configuration");
    error.code = "RULE_CONFIGURATION_INVALID";
    error.issues = issues;
    return error;
}

function authenticatedUserUnavailableError() {
    const error = new Error("Authenticated user is unavailable");
    error.code = "AUTH_USER_UNAVAILABLE";
    return error;
}

function toRuleResponse(rule) {
    return {
        id: rule.id,
        projectId: rule.project_id,
        name: rule.name,
        priority: rule.priority,
        enabled: rule.enabled,
        conditions: rule.conditions,
        action: rule.action,
        destinationUrl: rule.destination_url,
        frequencyEnabled: rule.frequency_enabled,
        frequencySeconds: rule.frequency_seconds,
        frequencyMode: rule.frequency_mode,
        fullscreenMode: rule.fullscreen_mode,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
    };
}

function ruleToConfiguration(rule) {
    return {
        name: rule.name,
        priority: rule.priority,
        enabled: rule.enabled,
        conditions: rule.conditions,
        action: rule.action,
        destinationUrl: rule.destination_url,
        frequencyEnabled: rule.frequency_enabled,
        frequencySeconds: rule.frequency_seconds,
        frequencyMode: rule.frequency_mode,
        fullscreenMode: rule.fullscreen_mode,
    };
}

function toDatabaseRule(projectId, rule) {
    return {
        project_id: projectId,
        name: rule.name,
        priority: rule.priority,
        enabled: rule.enabled,
        conditions: rule.conditions,
        action: rule.action,
        destination_url: rule.destinationUrl,
        frequency_enabled: rule.frequencyEnabled,
        frequency_seconds: rule.frequencySeconds,
        frequency_mode: rule.frequencyMode,
        fullscreen_mode: rule.fullscreenMode,
    };
}

function invalidateProjectCache(configCacheService, projectKey) {
    if (!configCacheService || typeof configCacheService.delete !== "function" || !projectKey) return;
    try {
        configCacheService.delete(projectKey);
    } catch {
        // Cache invalidation must not fail a committed rule mutation.
    }
}

function createRuleService({ projectRepository, ruleRepository, userRepository, configCacheService }) {
    async function findOwnedProject(projectId, authenticatedUserId) {
        if (typeof authenticatedUserId !== "string" || authenticatedUserId.length === 0) {
            throw authenticatedUserUnavailableError();
        }

        const user = await userRepository.findById(authenticatedUserId);
        if (!user) {
            throw authenticatedUserUnavailableError();
        }

        const project = await projectRepository.findById(projectId);
        return project && project.user_id === user.id ? project : null;
    }

    async function findOwnedRule(projectId, ruleId) {
        const rule = await ruleRepository.findById(ruleId);
        return rule && rule.project_id === projectId ? rule : null;
    }

    return {
        async listByProjectId(projectId, authenticatedUserId) {
            const project = await findOwnedProject(projectId, authenticatedUserId);
            if (!project) return null;

            const rules = await ruleRepository.listByProjectId(projectId);
            return rules.map(toRuleResponse);
        },

        async create(projectId, input, authenticatedUserId) {
            const project = await findOwnedProject(projectId, authenticatedUserId);
            if (!project) return null;

            const validation = createRuleSchema.safeParse(input);
            if (!validation.success) {
                throw ruleConfigurationError(validation.error.issues);
            }

            const createdRule = await ruleRepository.create(toDatabaseRule(projectId, validation.data));
            invalidateProjectCache(configCacheService, project.project_key);
            return toRuleResponse(createdRule);
        },

        async updateById(projectId, ruleId, updates, authenticatedUserId) {
            const project = await findOwnedProject(projectId, authenticatedUserId);
            if (!project) return null;

            const existingRule = await findOwnedRule(projectId, ruleId);
            if (!existingRule) return null;

            const current = ruleToConfiguration(existingRule);
            const merged = { ...current, ...updates };
            if (updates.action === "none" && updates.destinationUrl === undefined) {
                merged.destinationUrl = null;
            }
            if (updates.frequencyEnabled === false) {
                merged.frequencySeconds = null;
                merged.frequencyMode = null;
            }

            const validation = createRuleSchema.safeParse(merged);
            if (!validation.success) {
                throw ruleConfigurationError(validation.error.issues);
            }

            const updatedRule = await ruleRepository.updateById(
                ruleId,
                toDatabaseRule(projectId, validation.data),
            );
            if (updatedRule) invalidateProjectCache(configCacheService, project.project_key);
            return updatedRule ? toRuleResponse(updatedRule) : null;
        },

        async deleteById(projectId, ruleId, authenticatedUserId) {
            const project = await findOwnedProject(projectId, authenticatedUserId);
            if (!project) return false;

            const rule = await findOwnedRule(projectId, ruleId);
            if (!rule) return false;

            const deleted = (await ruleRepository.deleteById(ruleId)) > 0;
            if (deleted) invalidateProjectCache(configCacheService, project.project_key);
            return deleted;
        },
    };
}

module.exports = { createRuleService };