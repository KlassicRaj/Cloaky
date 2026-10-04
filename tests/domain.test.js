import { describe, expect, it } from "vitest";

const { normalizeVisitor } = require("../src/domain/visitor");
const {
    SUPPORTED_RULE_FIELDS,
    SUPPORTED_RULE_OPERATORS,
    isLogicalCondition,
    isLeafCondition,
    getConditionType,
} = require("../src/domain/rule");
const { createDecision } = require("../src/domain/decision");

describe("normalizeVisitor", () => {
    it("returns null for missing values", () => {
        expect(normalizeVisitor()).toEqual({
            ip: null,
            geo: { country: null, region: null, city: null },
            browserGeo: null,
            browser: null,
            os: null,
            deviceType: null,
            language: null,
            timezone: null,
            screen: { width: null, height: null },
        });
    });

    it("trims strings and preserves numeric values as numbers", () => {
        const normalized = normalizeVisitor({
            ip: " 192.0.2.1 ",
            geo: { country: " US ", region: " CA ", city: " San Francisco " },
            browserGeo: { latitude: 37.77, longitude: " -122.42 ", accuracy: "15" },
            browser: " Firefox ",
            os: " Linux ",
            deviceType: " desktop ",
            language: " en-US ",
            timezone: " America/Los_Angeles ",
            screen: { width: 1920, height: "1080" },
        });

        expect(normalized).toEqual({
            ip: "192.0.2.1",
            geo: { country: "US", region: "CA", city: "San Francisco" },
            browserGeo: { latitude: 37.77, longitude: -122.42, accuracy: 15 },
            browser: "Firefox",
            os: "Linux",
            deviceType: "desktop",
            language: "en-US",
            timezone: "America/Los_Angeles",
            screen: { width: 1920, height: 1080 },
        });
        expect(typeof normalized.browserGeo.latitude).toBe("number");
        expect(typeof normalized.screen.width).toBe("number");
    });

    it("normalizes blank strings and invalid numeric values to null", () => {
        expect(normalizeVisitor({
            ip: "   ",
            geo: { country: " " },
            browserGeo: { latitude: "unknown", longitude: Infinity, accuracy: "" },
            screen: { width: "not a number", height: NaN },
        })).toEqual({
            ip: null,
            geo: { country: null, region: null, city: null },
            browserGeo: { latitude: null, longitude: null, accuracy: null },
            browser: null,
            os: null,
            deviceType: null,
            language: null,
            timezone: null,
            screen: { width: null, height: null },
        });
    });

    it("keeps browserGeo null when the input is absent", () => {
        expect(normalizeVisitor({ browserGeo: null }).browserGeo).toBeNull();
    });
});

describe("rule condition helpers", () => {
    it("exposes the supported fields and operators", () => {
        expect(SUPPORTED_RULE_FIELDS).not.toContain("browser_geo_latitude");
        expect(SUPPORTED_RULE_FIELDS).not.toContain("browser_geo_longitude");
        expect(SUPPORTED_RULE_FIELDS).not.toContain("browser_geo_accuracy");
        expect(SUPPORTED_RULE_FIELDS).toContain("screen_width");
        expect(SUPPORTED_RULE_OPERATORS).toContain("equals");
        expect(SUPPORTED_RULE_OPERATORS).toContain("cidr");
    });

    it("identifies logical and leaf conditions", () => {
        const logicalCondition = { operator: "AND", conditions: [] };
        const leafCondition = { field: "country", operator: "equals", value: "US" };

        expect(isLogicalCondition(logicalCondition)).toBe(true);
        expect(isLeafCondition(logicalCondition)).toBe(false);
        expect(getConditionType(logicalCondition)).toBe("logical");

        expect(isLogicalCondition(leafCondition)).toBe(false);
        expect(isLeafCondition(leafCondition)).toBe(true);
        expect(getConditionType(leafCondition)).toBe("leaf");
        expect(getConditionType({ operator: "XOR", conditions: [] })).toBeNull();
    });
});

describe("createDecision", () => {
    it("returns the safe no-action defaults", () => {
        expect(createDecision()).toEqual({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        });
    });

    it("normalizes supported decision overrides", () => {
        expect(createDecision({
            matched: true,
            ruleId: " rule-123 ",
            action: "open_new_tab",
            destinationUrl: " https://example.com/path ",
            fullscreenMode: "prompt",
            reason: " rule_matched ",
            triggered: true,
        })).toEqual({
            matched: true,
            ruleId: "rule-123",
            action: "open_new_tab",
            destinationUrl: "https://example.com/path",
            fullscreenMode: "prompt",
            reason: "rule_matched",
            triggered: true,
        });
    });

    it("falls back to safe defaults for unsupported override values", () => {
        expect(createDecision({
            matched: "yes",
            action: "javascript",
            fullscreenMode: "automatic",
            reason: "  ",
        })).toEqual({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        });
    });
});