import { describe, expect, it } from "vitest";

const {
    ruleDestinationSchema,
    validateDestinationUrl,
} = require("../src/validation/urlValidation");

describe("validateDestinationUrl", () => {
    it.each([
        ["https://example.com", "https://example.com/"],
        ["http://example.com", "http://example.com/"],
        ["https://example.com/path", "https://example.com/path"],
        ["https://example.com/path?a=1", "https://example.com/path?a=1"],
        ["https://example.com/#section", "https://example.com/#section"],
    ])("accepts and normalizes %s", (value, normalized) => {
        expect(validateDestinationUrl(value)).toMatchObject({ success: true, data: normalized });
    });

    it.each([
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:alert(1)",
        "file:///etc/passwd",
        "about:blank",
        "blob:https://example.com/resource-id",
        "filesystem:https://example.com/temporary/file",
        "intent://example.com/#Intent;scheme=https;end",
        "//example.com",
        "/relative/path",
        "example.com",
        "",
        "   ",
        "http://[",
    ])("rejects unsafe or invalid URL %s", (value) => {
        expect(validateDestinationUrl(value).success).toBe(false);
    });

    it("rejects non-string inputs", () => {
        expect(validateDestinationUrl(null).success).toBe(false);
        expect(validateDestinationUrl({ toString: () => "https://example.com" }).success).toBe(false);
    });
});

describe("ruleDestinationSchema", () => {
    it.each(["https://example.com", "http://example.com/path"])(
        "accepts a valid destination for redirect actions: %s",
        (destination_url) => {
            expect(ruleDestinationSchema.safeParse({ action: "redirect", destination_url }).success)
                .toBe(true);
        },
    );

    it("accepts a valid destination for open_new_tab", () => {
        expect(ruleDestinationSchema.safeParse({
            action: "open_new_tab",
            destination_url: "https://example.com",
        }).success).toBe(true);
    });

    it("rejects unsafe destinations for actions that require a URL", () => {
        expect(ruleDestinationSchema.safeParse({
            action: "redirect",
            destination_url: "javascript:alert(1)",
        }).success).toBe(false);
    });

    it.each([{}, { destination_url: null }])("rejects a missing destination for redirect", (fields) => {
        expect(ruleDestinationSchema.safeParse({ action: "redirect", ...fields }).success).toBe(false);
    });

    it("allows none without a destination and normalizes it to null", () => {
        expect(ruleDestinationSchema.parse({ action: "none" })).toEqual({
            action: "none",
            destination_url: null,
        });
        expect(ruleDestinationSchema.parse({ action: "none", destination_url: null })).toEqual({
            action: "none",
            destination_url: null,
        });
    });

    it("rejects a destination supplied with action none", () => {
        expect(ruleDestinationSchema.safeParse({
            action: "none",
            destination_url: "https://example.com",
        }).success).toBe(false);
    });
});