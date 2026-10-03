function createAuthenticatedUserUnavailableError() {
    const error = new Error("Authenticated user is unavailable");
    error.code = "AUTH_USER_UNAVAILABLE";
    return error;
}

function toProjectResponse(project) {
    return {
        id: project.id,
        userId: project.user_id,
        name: project.name,
        projectKey: project.project_key,
        allowedOrigins: project.allowed_origins,
        enabled: project.enabled,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
    };
}

function invalidateProjectCache(configCacheService, ...projectKeys) {
    if (!configCacheService || typeof configCacheService.delete !== "function") return;

    for (const projectKey of new Set(projectKeys)) {
        if (typeof projectKey !== "string" || projectKey === "") continue;
        try {
            configCacheService.delete(projectKey);
        } catch {
            // Cache invalidation must not fail a committed project mutation.
        }
    }
}

function createProjectService({ projectRepository, userRepository, configCacheService }) {
    async function getAuthenticatedUser(authenticatedUserId) {
        if (typeof authenticatedUserId !== "string" || authenticatedUserId.length === 0) {
            throw createAuthenticatedUserUnavailableError();
        }

        const user = await userRepository.findById(authenticatedUserId);
        if (!user) {
            throw createAuthenticatedUserUnavailableError();
        }
        return user;
    }

    async function findOwnedProject(projectId, userId) {
        const project = await projectRepository.findById(projectId);
        return project && project.user_id === userId ? project : null;
    }

    return {
        async list(authenticatedUserId) {
            const user = await getAuthenticatedUser(authenticatedUserId);
            const projects = await projectRepository.listByUserId(user.id);
            return projects.map(toProjectResponse);
        },

        async create(input, authenticatedUserId) {
            const user = await getAuthenticatedUser(authenticatedUserId);
            const project = await projectRepository.create({
                user_id: user.id,
                name: input.name,
                project_key: input.projectKey,
                allowed_origins: input.allowedOrigins,
                ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            });
            invalidateProjectCache(configCacheService, project.project_key);
            return toProjectResponse(project);
        },

        async getById(projectId, authenticatedUserId) {
            const user = await getAuthenticatedUser(authenticatedUserId);
            const project = await findOwnedProject(projectId, user.id);
            return project ? toProjectResponse(project) : null;
        },

        async updateById(projectId, input, authenticatedUserId) {
            const user = await getAuthenticatedUser(authenticatedUserId);
            const project = await findOwnedProject(projectId, user.id);
            if (!project) {
                return null;
            }

            const updates = {};
            if (input.name !== undefined) updates.name = input.name;
            if (input.allowedOrigins !== undefined) updates.allowed_origins = input.allowedOrigins;
            if (input.enabled !== undefined) updates.enabled = input.enabled;

            const updatedProject = await projectRepository.updateById(projectId, updates);
            if (updatedProject) {
                invalidateProjectCache(
                    configCacheService,
                    project.project_key,
                    updatedProject.project_key,
                );
            }
            return updatedProject ? toProjectResponse(updatedProject) : null;
        },

        async deleteById(projectId, authenticatedUserId) {
            const user = await getAuthenticatedUser(authenticatedUserId);
            const project = await findOwnedProject(projectId, user.id);
            if (!project) {
                return false;
            }

            const deleted = (await projectRepository.deleteById(projectId)) > 0;
            if (deleted) invalidateProjectCache(configCacheService, project.project_key);
            return deleted;
        },
    };
}

module.exports = { createProjectService };