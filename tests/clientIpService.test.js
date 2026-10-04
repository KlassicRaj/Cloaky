import { afterAll, beforeEach, describe, expect, it } from "vitest";

const env = require("../src/config/env");
const { getClientIp } = require("../src/services/clientIpService");

const originalTrustedProxies = env.TRUSTED_PROXIES;

function request(socketIp, headers = {}) {
    return { socket: { remoteAddress: socketIp }, headers };
}

beforeEach(() => {
    env.TRUSTED_PROXIES = "";
});

afterAll(() => {
    env.TRUSTED_PROXIES = originalTrustedProxies;
});

describe("getClientIp", () => {
    it("returns the socket address for a direct request", () => {
        expect(getClientIp(request("192.0.2.10"))).toBe("192.0.2.10");
    });

    it.each([
        ["X-Forwarded-For", "x-forwarded-for"],
        ["X-Real-IP", "x-real-ip"],
        ["CF-Connecting-IP", "cf-connecting-ip"],
    ])("ignores untrusted %s", (_label, headerName) => {
        expect(getClientIp(request("10.0.0.5", { [headerName]: "8.8.8.8" }))).toBe("10.0.0.5");
    });

    it("uses X-Forwarded-For for a trusted proxy", () => {
        env.TRUSTED_PROXIES = "10.0.0.5";

        expect(getClientIp(request("10.0.0.5", { "x-forwarded-for": "8.8.8.8" })))
            .toBe("8.8.8.8");
    });

    it("uses X-Real-IP when a trusted proxy has no valid X-Forwarded-For value", () => {
        env.TRUSTED_PROXIES = "10.0.0.5";

        expect(getClientIp(request("10.0.0.5", { "x-real-ip": "8.8.4.4" }))).toBe("8.8.4.4");
    });

    it("uses CF-Connecting-IP before X-Real-IP as a trusted-proxy fallback", () => {
        env.TRUSTED_PROXIES = "10.0.0.5";

        expect(getClientIp(request("10.0.0.5", {
            "cf-connecting-ip": "8.8.8.8",
            "x-real-ip": "1.1.1.1",
        }))).toBe("8.8.8.8");
    });

    it("walks X-Forwarded-For from the trusted proxy end of the chain", () => {
        env.TRUSTED_PROXIES = "10.0.0.5,10.0.0.8,10.0.0.9";

        expect(getClientIp(request("10.0.0.5", {
            "x-forwarded-for": "8.8.8.8, 10.0.0.8, 10.0.0.9",
        }))).toBe("8.8.8.8");
    });

    it("trims forwarded addresses and ignores empty entries", () => {
        env.TRUSTED_PROXIES = "10.0.0.5,10.0.0.8";

        expect(getClientIp(request("10.0.0.5", {
            "x-forwarded-for": " 8.8.8.8 , , 10.0.0.8 ",
        }))).toBe("8.8.8.8");
    });

    it("ignores an invalid X-Forwarded-For chain and safely falls back", () => {
        env.TRUSTED_PROXIES = "10.0.0.5";

        expect(getClientIp(request("10.0.0.5", {
            "x-forwarded-for": "8.8.8.8, invalid",
        }))).toBe("10.0.0.5");
    });

    it("returns null when the socket address is missing", () => {
        expect(getClientIp({ headers: { "x-forwarded-for": "8.8.8.8" } })).toBeNull();
        expect(getClientIp(null)).toBeNull();
    });

    it("normalizes an IPv4-mapped IPv6 socket address", () => {
        expect(getClientIp(request("::ffff:127.0.0.1"))).toBe("127.0.0.1");
    });

    it("returns a direct IPv6 client address", () => {
        expect(getClientIp(request("2001:db8::8"))).toBe("2001:db8::8");
    });

    it("matches an exact trusted proxy address", () => {
        env.TRUSTED_PROXIES = "192.0.2.20";

        expect(getClientIp(request("192.0.2.20", {
            "x-forwarded-for": "8.8.8.8",
        }))).toBe("8.8.8.8");
    });

    it("supports IPv4 CIDR trusted proxy entries", () => {
        env.TRUSTED_PROXIES = "10.0.0.0/8";

        expect(getClientIp(request("10.4.5.6", {
            "x-forwarded-for": "8.8.8.8",
        }))).toBe("8.8.8.8");
    });

    it("ignores all forwarding headers when trusted proxy configuration is empty", () => {
        env.TRUSTED_PROXIES = "";

        expect(getClientIp(request("10.0.0.5", {
            "x-forwarded-for": "8.8.8.8",
            "x-real-ip": "8.8.4.4",
            "cf-connecting-ip": "1.1.1.1",
        }))).toBe("10.0.0.5");
    });

    it("reads header names case-insensitively", () => {
        env.TRUSTED_PROXIES = "10.0.0.5";

        expect(getClientIp(request("10.0.0.5", {
            "X-FoRwArDeD-FoR": "8.8.8.8",
        }))).toBe("8.8.8.8");
    });
});