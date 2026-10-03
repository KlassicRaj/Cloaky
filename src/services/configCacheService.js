function createConfigCacheService() {
    const configurations = new Map();

    function cacheKey(projectKey) {
        return typeof projectKey === "string" && projectKey.length > 0
            ? `project:${projectKey}`
            : null;
    }

    return {
        get(projectKey) {
            const key = cacheKey(projectKey);
            return key ? configurations.get(key) : undefined;
        },

        set(projectKey, configuration) {
            const key = cacheKey(projectKey);
            if (!key) return;
            configurations.set(key, configuration);
        },

        delete(projectKey) {
            const key = cacheKey(projectKey);
            if (key) configurations.delete(key);
        },

        clear() {
            configurations.clear();
        },
    };
}

const defaultCache = createConfigCacheService();

module.exports = { ...defaultCache, createConfigCacheService };