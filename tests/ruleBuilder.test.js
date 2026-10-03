import { describe, expect, it } from "vitest";

const {
    buildRulePayload,
    cloneCondition,
    operatorsForField,
    serializeConditions,
    toEditorConditionState,
} = require("../public/js/rule-builder.js");

const baseInput = {
    name: "Mobile visitors",
    priority: "0",
    enabled: true,
    conditions: {
        operator: "AND",
        conditions: [{ field: "country", operator: "equals", value: "IN" }],
    },
    action: "none",
    destinationUrl: "",
    frequencyEnabled: false,
    frequencySeconds: "",
    frequencyMode: "cooldown",
    fullscreenMode: "off",
};

describe("rule builder condition serialization", () => {
    it("serializes an AND root with multiple conditions in their existing order", () => {
        const conditions = {
            operator: "AND",
            conditions: [
                { field: "country", operator: "equals", value: "IN" },
                { field: "device_type", operator: "equals", value: "mobile" },
            ],
        };

        expect(serializeConditions(conditions)).toEqual(conditions);
    });

    it("serializes OR and nested groups without flattening or reordering them", () => {
        const conditions = {
            operator: "OR",
            conditions: [
                { field: "country", operator: "equals", value: "IN" },
                {
                    operator: "AND",
                    conditions: [
                        { field: "browser", operator: "contains", value: "Chrome" },
                        { field: "screen_width", operator: "greater_than", value: "500" },
                    ],
                },
            ],
        };

        expect(serializeConditions(conditions)).toEqual({
            ...conditions,
            conditions: [
                conditions.conditions[0],
                {
                    operator: "AND",
                    conditions: [
                        conditions.conditions[1].conditions[0],
                        { field: "screen_width", operator: "greater_than", value: 500 },
                    ],
                },
            ],
        });
    });

    it("provides only compatible operators for selected fields", () => {
        expect(operatorsForField("ip")).toContain("cidr");
        expect(operatorsForField("country")).not.toContain("cidr");
        expect(operatorsForField("screen_width")).toContain("greater_than");
        expect(operatorsForField("screen_width")).not.toContain("contains");
        expect(() => serializeConditions({
            operator: "AND",
            conditions: [{ field: "country", operator: "greater_than", value: 5 }],
        })).toThrow(/operator/i);
    });

    it("serializes supported numeric values as JSON numbers", () => {
        expect(serializeConditions({
            operator: "AND",
            conditions: [{ field: "screen_width", operator: "equals", value: "375" }],
        })).toEqual({
            operator: "AND",
            conditions: [{ field: "screen_width", operator: "equals", value: 375 }],
        });
    });

    it.each(["browser_geo_latitude", "browser_geo_longitude", "browser_geo_accuracy"])(
        "does not support browser geolocation condition field %s",
        (field) => {
            expect(() => serializeConditions({
                operator: "AND",
                conditions: [{ field, operator: "equals", value: 1 }],
            })).toThrow(/supported condition field/i);
        },
    );

    it("accepts valid IPv4 CIDR values and rejects malformed CIDR values", () => {
        expect(serializeConditions({
            operator: "AND",
            conditions: [{ field: "ip", operator: "cidr", value: "192.168.1.0/24" }],
        })).toEqual({
            operator: "AND",
            conditions: [{ field: "ip", operator: "cidr", value: "192.168.1.0/24" }],
        });
        expect(() => serializeConditions({
            operator: "AND",
            conditions: [{ field: "ip", operator: "cidr", value: "192.168.1.0/99" }],
        })).toThrow(/CIDR/i);
    });

    it("rejects blank leaves and empty logical groups", () => {
        expect(() => serializeConditions({
            operator: "AND",
            conditions: [{ field: "country", operator: "equals", value: " " }],
        })).toThrow(/requires a value/i);
        expect(() => serializeConditions({ operator: "AND", conditions: [] }))
            .toThrow(/between 1 and 50/i);
    });
});

describe("rule builder payload", () => {
    it("omits destination for none and includes disabled frequency as null settings", () => {
        const payload = buildRulePayload(baseInput);

        expect(payload).toEqual({
            name: "Mobile visitors",
            priority: 0,
            enabled: true,
            conditions: baseInput.conditions,
            action: "none",
            frequencyEnabled: false,
            frequencySeconds: null,
            frequencyMode: null,
            fullscreenMode: "off",
        });
        expect(payload).not.toHaveProperty("destinationUrl");
    });

    it.each(["redirect", "open_new_tab"])("includes the destination for %s", (action) => {
        const payload = buildRulePayload({
            ...baseInput,
            action,
            destinationUrl: "https://example.com/path",
        });

        expect(payload).toMatchObject({
            action,
            destinationUrl: "https://example.com/path",
        });
    });

    it("requires and validates a destination when the action needs one", () => {
        expect(() => buildRulePayload({ ...baseInput, action: "redirect" }))
            .toThrow(/destination URL/i);
        expect(() => buildRulePayload({
            ...baseInput,
            action: "redirect",
            destinationUrl: "javascript:alert(1)",
        })).toThrow(/HTTP or HTTPS/i);
    });

    it.each([
        ["cooldown", 600],
        ["return_after", 3600],
    ])("serializes enabled frequency settings for mode %s", (frequencyMode, frequencySeconds) => {
        expect(buildRulePayload({
            ...baseInput,
            frequencyEnabled: true,
            frequencySeconds: String(frequencySeconds),
            frequencyMode,
        })).toMatchObject({
            frequencyEnabled: true,
            frequencySeconds,
            frequencyMode,
        });
    });

    it("rejects invalid frequency configuration and serializes fullscreen mode", () => {
        expect(() => buildRulePayload({
            ...baseInput,
            frequencyEnabled: true,
            frequencySeconds: "0",
        })).toThrow(/frequency seconds/i);
        expect(buildRulePayload({ ...baseInput, fullscreenMode: "prompt" }).fullscreenMode)
            .toBe("prompt");
    });

    it("rebuilds a fetched rule without losing its nested conditions or settings", () => {
        const existing = {
            id: "rule-id",
            projectId: "project-id",
            name: "Nested rule",
            priority: 12,
            enabled: false,
            conditions: {
                operator: "OR",
                conditions: [
                    { field: "ip", operator: "cidr", value: "10.1.0.0/16" },
                    {
                        operator: "AND",
                        conditions: [
                            { field: "browser", operator: "starts_with", value: "Fire" },
                            { field: "screen_height", operator: "less_than", value: 900 },
                        ],
                    },
                ],
            },
            action: "open_new_tab",
            destinationUrl: "https://example.com",
            frequencyEnabled: true,
            frequencySeconds: 60,
            frequencyMode: "return_after",
            fullscreenMode: "prompt",
        };
        const payload = buildRulePayload({
            name: existing.name,
            priority: existing.priority,
            enabled: existing.enabled,
            conditions: cloneCondition(existing.conditions),
            action: existing.action,
            destinationUrl: existing.destinationUrl,
            frequencyEnabled: existing.frequencyEnabled,
            frequencySeconds: existing.frequencySeconds,
            frequencyMode: existing.frequencyMode,
            fullscreenMode: existing.fullscreenMode,
        });

        expect(payload).toEqual({
            name: existing.name,
            priority: existing.priority,
            enabled: existing.enabled,
            conditions: existing.conditions,
            action: existing.action,
            destinationUrl: existing.destinationUrl,
            frequencyEnabled: existing.frequencyEnabled,
            frequencySeconds: existing.frequencySeconds,
            frequencyMode: existing.frequencyMode,
            fullscreenMode: existing.fullscreenMode,
        });
    });

    it("preserves the meaning of an existing leaf-root condition for editing", () => {
        const existingCondition = { field: "country", operator: "equals", value: "IN" };

        expect(serializeConditions(toEditorConditionState(existingCondition))).toEqual({
            operator: "AND",
            conditions: [existingCondition],
        });
    });
});
