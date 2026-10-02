import { describe, expect, it } from "vitest";

const { evaluateRules } = require("../src/services/ruleEngine");

const defaultVisitor = {
    ip: "192.168.1.25",
    geo: { country: "IN", region: "KA", city: "Bengaluru" },
    browserGeo: { latitude: 12.97, longitude: 77.59, accuracy: 10 },
    browser: "Firefox",
    os: "Linux",
    deviceType: "mobile",
    language: "en-IN",
    timezone: "Asia/Kolkata",
    screen: { width: 390, height: 844 },
};

function makeRule(condition, overrides = {}) {
    return {
        id: "rule-1",
        priority: 1,
        enabled: true,
        conditions: condition,
        action: "redirect",
        destination_url: "https://example.com",
        fullscreen_mode: "off",
        ...overrides,
    };
}

function leaf(field, operator, value) {
    return { field, operator, value };
}

describe("evaluateRules", () => {
    it("returns no_match when there are no rules", () => {
        expect(evaluateRules(defaultVisitor, [])).toEqual({
            matched: false,
            ruleId: null,
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "no_match",
        });
    });

    it("skips disabled rules", () => {
        const rules = [makeRule(leaf("country", "equals", "IN"), { enabled: false })];

        expect(evaluateRules(defaultVisitor, rules).reason).toBe("no_match");
    });

    it("matches a country rule", () => {
        const decision = evaluateRules(defaultVisitor, [makeRule(leaf("country", "equals", "in"))]);

        expect(decision).toMatchObject({ matched: true, ruleId: "rule-1", reason: "rule_matched" });
    });

    it("returns no_match when a country does not match", () => {
        const decision = evaluateRules(defaultVisitor, [makeRule(leaf("country", "equals", "US"))]);

        expect(decision.reason).toBe("no_match");
    });

    it("evaluates priority 1 before priority 10", () => {
        const rules = [
            makeRule(leaf("country", "equals", "IN"), { id: "priority-10", priority: 10 }),
            makeRule(leaf("country", "equals", "IN"), { id: "priority-1", priority: 1 }),
        ];

        expect(evaluateRules(defaultVisitor, rules).ruleId).toBe("priority-1");
    });

    it("returns the first matching rule and stops there", () => {
        const rules = [
            makeRule(leaf("country", "equals", "IN"), {
                id: "first-match",
                priority: 1,
                destination_url: "https://first.example",
            }),
            makeRule(leaf("country", "equals", "IN"), {
                id: "later-match",
                priority: 2,
                destination_url: "https://later.example",
            }),
        ];

        expect(evaluateRules(defaultVisitor, rules)).toMatchObject({
            ruleId: "first-match",
            destinationUrl: "https://first.example",
        });
    });

    it("matches an AND condition when every child matches", () => {
        const condition = {
            operator: "AND",
            conditions: [leaf("country", "equals", "IN"), leaf("device_type", "equals", "mobile")],
        };

        expect(evaluateRules(defaultVisitor, [makeRule(condition)]).matched).toBe(true);
    });

    it("does not match an AND condition when one child fails", () => {
        const condition = {
            operator: "AND",
            conditions: [leaf("country", "equals", "IN"), leaf("device_type", "equals", "desktop")],
        };

        expect(evaluateRules(defaultVisitor, [makeRule(condition)]).matched).toBe(false);
    });

    it("matches an OR condition when at least one child matches", () => {
        const condition = {
            operator: "OR",
            conditions: [leaf("country", "equals", "US"), leaf("country", "equals", "IN")],
        };

        expect(evaluateRules(defaultVisitor, [makeRule(condition)]).matched).toBe(true);
    });

    it("evaluates nested AND and OR conditions", () => {
        const condition = {
            operator: "AND",
            conditions: [
                leaf("device_type", "equals", "mobile"),
                {
                    operator: "OR",
                    conditions: [leaf("country", "equals", "US"), leaf("region", "equals", "KA")],
                },
            ],
        };

        expect(evaluateRules(defaultVisitor, [makeRule(condition)]).matched).toBe(true);
    });

    it("matches equals case-insensitively for strings", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("browser", "equals", "firefox"))]).matched)
            .toBe(true);
    });

    it("matches not_equals for present unequal values", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("country", "not_equals", "US"))]).matched)
            .toBe(true);
    });

    it("treats a missing value as not equal without treating it as equal", () => {
        const visitor = { geo: { country: null } };

        expect(evaluateRules(visitor, [makeRule(leaf("country", "equals", "IN"))]).matched).toBe(false);
        expect(evaluateRules(visitor, [makeRule(leaf("country", "not_equals", "IN"))]).matched).toBe(true);
    });

    it("matches case-insensitive contains", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("city", "contains", "uru"))]).matched)
            .toBe(true);
    });

    it("matches case-insensitive starts_with", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("timezone", "starts_with", "asia/"))]).matched)
            .toBe(true);
    });

    it("matches greater_than with numeric values", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("screen_width", "greater_than", "300"))]).matched)
            .toBe(true);
    });

    it("matches less_than with numeric values", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("screen_height", "less_than", 900))]).matched)
            .toBe(true);
    });

    it("matches an IPv4 address within a CIDR range", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("ip", "cidr", "192.168.1.0/24"))]).matched)
            .toBe(true);
    });

    it("does not match an IPv4 address outside the CIDR range", () => {
        expect(evaluateRules(defaultVisitor, [makeRule(leaf("ip", "cidr", "192.168.2.0/24"))]).matched)
            .toBe(false);
    });

    it("treats invalid IP and CIDR input as a non-match", () => {
        expect(() => evaluateRules(
            { ...defaultVisitor, ip: "999.1.1.1" },
            [makeRule(leaf("ip", "cidr", "192.168.1.0/99"))],
        )).not.toThrow();
        expect(evaluateRules(
            { ...defaultVisitor, ip: "999.1.1.1" },
            [makeRule(leaf("ip", "cidr", "192.168.1.0/99"))],
        ).matched).toBe(false);
    });

    it("does not match a missing visitor value and does not throw", () => {
        const visitor = { geo: { country: null } };

        expect(() => evaluateRules(visitor, [makeRule(leaf("country", "equals", "IN"))])).not.toThrow();
        expect(evaluateRules(visitor, [makeRule(leaf("country", "equals", "IN"))]).matched).toBe(false);
    });

    it("returns a redirect decision", () => {
        const decision = evaluateRules(defaultVisitor, [makeRule(leaf("country", "equals", "IN"))]);

        expect(decision).toMatchObject({
            matched: true,
            action: "redirect",
            destinationUrl: "https://example.com",
            reason: "rule_matched",
        });
    });

    it("returns an open_new_tab decision", () => {
        const decision = evaluateRules(defaultVisitor, [
            makeRule(leaf("country", "equals", "IN"), { action: "open_new_tab" }),
        ]);

        expect(decision.action).toBe("open_new_tab");
    });

    it("returns a none action for a matching rule", () => {
        const decision = evaluateRules(defaultVisitor, [
            makeRule(leaf("country", "equals", "IN"), { action: "none" }),
        ]);

        expect(decision).toMatchObject({ matched: true, action: "none", ruleId: "rule-1" });
    });

    it("preserves the fullscreen prompt mode", () => {
        const decision = evaluateRules(defaultVisitor, [
            makeRule(leaf("country", "equals", "IN"), { fullscreen_mode: "prompt" }),
        ]);

        expect(decision.fullscreenMode).toBe("prompt");
    });

    it("does not mutate visitor or rules", () => {
        const visitor = structuredClone(defaultVisitor);
        const rules = [
            makeRule(leaf("country", "equals", "IN"), { priority: 10 }),
            makeRule(leaf("screen_width", "greater_than", 300), { id: "second", priority: 1 }),
        ];
        const originalVisitor = structuredClone(visitor);
        const originalRules = structuredClone(rules);

        evaluateRules(visitor, rules);

        expect(visitor).toEqual(originalVisitor);
        expect(rules).toEqual(originalRules);
    });
});