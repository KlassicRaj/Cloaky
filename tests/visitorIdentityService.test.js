import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { createHmac } = require("node:crypto");
const env = require("../src/config/env");
const { createVisitorId } = require("../src/services/visitorIdentityService");

const originalSecret = env.IP_HASH_SECRET;
const testSecret = "visitor-identity-unit-test-secret";
const testIp = "203.0.113.42";

beforeEach(() => {
    env.IP_HASH_SECRET = testSecret;
});

afterEach(() => {
    env.IP_HASH_SECRET = testSecret;
});

afterAll(() => {
    env.IP_HASH_SECRET = originalSecret;
});

describe("createVisitorId", () => {
    it("returns a hexadecimal HMAC-SHA256 digest", () => {
        const visitorId = createVisitorId(testIp);

        expect(visitorId).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic for the same IP and secret", () => {
        expect(createVisitorId(testIp)).toBe(createVisitorId(testIp));
    });

    it("returns different identifiers for different IPs", () => {
        expect(createVisitorId(testIp)).not.toBe(createVisitorId("203.0.113.43"));
    });

    it("returns a different identifier when the configured secret changes", () => {
        const originalVisitorId = createVisitorId(testIp);
        env.IP_HASH_SECRET = "a-different-unit-test-secret";

        expect(createVisitorId(testIp)).not.toBe(originalVisitorId);
    });

    it.each([undefined, null, "", "   ", 123, {}, []])(
        "rejects invalid IP input: %s",
        (ip) => {
            expect(() => createVisitorId(ip)).toThrow(TypeError);
        },
    );

    it("fails safely when the configured secret is empty", () => {
        env.IP_HASH_SECRET = " ";

        expect(() => createVisitorId(testIp)).toThrow("IP_HASH_SECRET must be configured");
    });

    it("does not include the secret or raw IP in the returned identifier", () => {
        const visitorId = createVisitorId(testIp);

        expect(visitorId).not.toContain(testSecret);
        expect(visitorId).not.toContain(testIp);
    });

    it("matches Node crypto HMAC-SHA256 for the known test value", () => {
        const expected = createHmac("sha256", testSecret).update(testIp, "utf8").digest("hex");

        expect(createVisitorId(testIp)).toBe(expected);
    });
});