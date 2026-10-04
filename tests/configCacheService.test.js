import { describe, expect, it } from "vitest";

const { createConfigCacheService } = require("../src/services/configCacheService");

describe("configCacheService", () => {
    it("stores and retrieves a configuration by project key", () => {
        const cache = createConfigCacheService();
        const configuration = { project: { id: "project-1" }, rules: [] };

        cache.set("public-key", configuration);

        expect(cache.get("public-key")).toBe(configuration);
    });

    it("returns undefined for a missing key", () => {
        const cache = createConfigCacheService();

        expect(cache.get("missing")).toBeUndefined();
    });

    it("deletes one project configuration", () => {
        const cache = createConfigCacheService();
        cache.set("public-key", { project: {}, rules: [] });

        cache.delete("public-key");

        expect(cache.get("public-key")).toBeUndefined();
    });

    it("clears all configurations", () => {
        const cache = createConfigCacheService();
        cache.set("one", { project: {}, rules: [] });
        cache.set("two", { project: {}, rules: [] });

        cache.clear();

        expect(cache.get("one")).toBeUndefined();
        expect(cache.get("two")).toBeUndefined();
    });

    it("overwrites a configuration for the same project key", () => {
        const cache = createConfigCacheService();
        const replacement = { project: { id: "new" }, rules: [] };
        cache.set("public-key", { project: { id: "old" }, rules: [] });

        cache.set("public-key", replacement);

        expect(cache.get("public-key")).toBe(replacement);
    });

    it("uses a project-key namespace", () => {
        const cache = createConfigCacheService();
        cache.set("public-key", { project: {}, rules: [] });

        expect(cache.get("another-key")).toBeUndefined();
    });
});
