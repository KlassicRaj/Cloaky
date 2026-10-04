import { afterEach, describe, expect, it, vi } from "vitest";

const { normalizeClientInfo } = require("../src/services/clientInfoService");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("normalizeClientInfo", () => {
    it.each([
        ["chrome", "Chrome"],
        ["fIrEfOx", "Firefox"],
        ["safari", "Safari"],
        ["unrecognized browser", "Other"],
    ])("normalizes browser %s", (browser, expected) => {
        expect(normalizeClientInfo({ browser }).browser).toBe(expected);
    });

    it.each([
        ["wINDOWS", "Windows"],
        ["MAC OS X", "macOS"],
        ["linux", "Linux"],
        ["ANDROID", "Android"],
        ["iPhone OS", "iOS"],
        ["unrecognized OS", "Other"],
    ])("normalizes operating system %s", (os, expected) => {
        expect(normalizeClientInfo({ os }).os).toBe(expected);
    });

    it.each(["DESKTOP", "Mobile", "tablet"]) (
        "normalizes device type %s",
        (deviceType) => {
            expect(normalizeClientInfo({ deviceType }).deviceType).toBe(deviceType.toLowerCase());
        },
    );

    it("normalizes an unknown device type to other", () => {
        expect(normalizeClientInfo({ deviceType: "wearable" }).deviceType).toBe("other");
    });

    it("trims and normalizes the language tag casing", () => {
        expect(normalizeClientInfo({ language: "  EN-in  " }).language).toBe("en-IN");
        expect(normalizeClientInfo({ language: "zh-hANT-tw" }).language).toBe("zh-Hant-TW");
    });

    it.each(["Asia/Kolkata", "America/New_York", "Europe/London"]) (
        "preserves a recognized timezone %s",
        (timezone) => {
            expect(normalizeClientInfo({ timezone }).timezone).toBe(timezone);
        },
    );

    it("returns null for an invalid timezone", () => {
        expect(normalizeClientInfo({ timezone: "Mars/Olympus_Mons" }).timezone).toBeNull();
    });

    it("normalizes valid positive integer screen dimensions", () => {
        expect(normalizeClientInfo({ screen: { width: 1920, height: 1080 } }).screen).toEqual({
            width: 1920,
            height: 1080,
        });
        expect(normalizeClientInfo({ screen: { width: 1e20 } }).screen.width).toBe(1e20);
    });

    it("converts unambiguous integer numeric strings", () => {
        expect(normalizeClientInfo({ screen: { width: " 00390 ", height: "+844.0" } }).screen)
            .toEqual({ width: 390, height: 844 });
    });

    it("returns null for invalid, zero, negative, or non-finite dimensions", () => {
        expect(normalizeClientInfo({
            screen: {
                width: "1.5",
                height: "not numeric",
            },
        }).screen).toEqual({ width: null, height: null });

        expect(normalizeClientInfo({
            screen: { width: 0, height: -10 },
        }).screen).toEqual({ width: null, height: null });

        expect(normalizeClientInfo({
            screen: { width: NaN, height: Infinity },
        }).screen).toEqual({ width: null, height: null });
    });

    it("returns nulls for missing and invalid values", () => {
        expect(normalizeClientInfo()).toEqual({
            browser: null,
            os: null,
            deviceType: null,
            language: null,
            timezone: null,
            screen: { width: null, height: null },
        });
        expect(normalizeClientInfo({
            browser: 42,
            os: {},
            deviceType: null,
            language: "en_US",
            timezone: "",
            screen: null,
        })).toEqual({
            browser: null,
            os: null,
            deviceType: null,
            language: null,
            timezone: null,
            screen: { width: null, height: null },
        });
    });

    it("does not mutate its input", () => {
        const input = {
            browser: " chrome ",
            os: " linux ",
            deviceType: " MOBILE ",
            language: " EN-us ",
            timezone: " Asia/Kolkata ",
            screen: { width: "390", height: 844 },
        };
        const original = structuredClone(input);

        normalizeClientInfo(input);

        expect(input).toEqual(original);
    });

    it("returns the same result for the same input", () => {
        const input = { browser: "Chrome", language: "en-IN", screen: { width: 390, height: 844 } };

        expect(normalizeClientInfo(input)).toEqual(normalizeClientInfo(input));
    });

    it("does not make network calls", () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        normalizeClientInfo({ browser: "Chrome", timezone: "Asia/Kolkata" });

        expect(fetchSpy).not.toHaveBeenCalled();
    });
});