import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let env;
let createGeoIpService;
let openDatabase;
let geoIpService;
let consoleError;

function unavailableLocation() {
    return { country: null, region: null, city: null };
}

beforeEach(() => {
    vi.resetModules();
    env = require("../src/config/env");
    env.GEOIP_DATABASE_PATH = "test-fixtures/geoip.mmdb";
    ({ createGeoIpService } = require("../src/services/geoIpService"));
    openDatabase = vi.fn();
    geoIpService = createGeoIpService({ openDatabase });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("geoIpService", () => {
    it("stays unavailable when the database path is missing", async () => {
        env.GEOIP_DATABASE_PATH = " ";

        await expect(geoIpService.initialize()).resolves.toBe(false);
        expect(geoIpService.lookup("203.0.113.42")).toEqual(unavailableLocation());
        expect(openDatabase).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
            "GeoIP database path is not configured; GeoIP lookups are disabled.",
        );
    });

    it.each([undefined, null, "", "not-an-ip"]) (
        "returns null fields for invalid IP input: %s",
        async (ip) => {
            const reader = { get: vi.fn() };
            openDatabase.mockResolvedValue(reader);
            geoIpService = createGeoIpService({ openDatabase });
            await geoIpService.initialize();

            expect(geoIpService.lookup(ip)).toEqual(unavailableLocation());
            expect(reader.get).not.toHaveBeenCalled();
        },
    );

    it("returns null fields and does not retry after initialization fails", async () => {
        openDatabase.mockRejectedValue(new Error("database unavailable"));

        await expect(geoIpService.initialize()).resolves.toBe(false);
        expect(geoIpService.lookup("203.0.113.42")).toEqual(unavailableLocation());
        await expect(geoIpService.initialize()).resolves.toBe(false);

        expect(openDatabase).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledWith(
            "GeoIP database initialization failed:",
            "database unavailable",
        );
    });

    it("maps country, subdivision, and the preferred English city name", async () => {
        const reader = {
            get: vi.fn().mockReturnValue({
                country: { iso_code: "IN" },
                subdivisions: [{ iso_code: "DL" }],
                city: { names: { fr: "New Delhi en français", en: "New Delhi" } },
            }),
        };
        openDatabase.mockResolvedValue(reader);

        await expect(geoIpService.initialize()).resolves.toBe(true);
        expect(geoIpService.lookup("203.0.113.42")).toEqual({
            country: "IN",
            region: "DL",
            city: "New Delhi",
        });
        expect(reader.get).toHaveBeenCalledWith("203.0.113.42");
    });

    it("returns null for unavailable fields and falls back to another city name", async () => {
        const reader = {
            get: vi.fn().mockReturnValue({ city: { names: { fr: "Paris" } } }),
        };
        openDatabase.mockResolvedValue(reader);

        await geoIpService.initialize();

        expect(geoIpService.lookup("2001:db8::1")).toEqual({
            country: null,
            region: null,
            city: "Paris",
        });
        expect(reader.get).toHaveBeenCalledWith("2001:db8::1");
    });

    it("opens the database once and reuses the reader for lookups", async () => {
        const reader = { get: vi.fn().mockReturnValue(null) };
        openDatabase.mockResolvedValue(reader);

        await Promise.all([
            geoIpService.initialize(),
            geoIpService.initialize(),
            geoIpService.initialize(),
        ]);
        geoIpService.lookup("203.0.113.42");
        geoIpService.lookup("2001:db8::1");

        expect(openDatabase).toHaveBeenCalledTimes(1);
        expect(openDatabase).toHaveBeenCalledWith("test-fixtures/geoip.mmdb");
        expect(reader.get).toHaveBeenCalledTimes(2);
    });

    it("returns null fields when the reader cannot look up an address", async () => {
        const reader = { get: vi.fn().mockImplementation(() => { throw new Error("lookup failed"); }) };
        openDatabase.mockResolvedValue(reader);
        geoIpService = createGeoIpService({ openDatabase });
        await geoIpService.initialize();

        expect(geoIpService.lookup("203.0.113.42")).toEqual(unavailableLocation());
    });
});