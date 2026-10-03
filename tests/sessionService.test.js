import { describe, expect, it } from "vitest";

const { createSessionService } = require("../src/services/sessionService");

const strongSecret = "test-only-session-secret-with-32-bytes-minimum";

describe("sessionService", () => {
    it("creates and verifies a signed expiring session with minimal claims", () => {
        const service = createSessionService({ secret: strongSecret, ttlSeconds: 3600, now: () => 1700000000000 });
        const session = service.createSession("6a0bcf64-ed58-48f8-9b3f-758725736b5b");

        expect(session.expiresAt).toBe(1700003600);
        expect(service.verifySession(session.token)).toEqual({
            userId: "6a0bcf64-ed58-48f8-9b3f-758725736b5b",
            expiresAt: 1700003600,
        });
        const payload = JSON.parse(Buffer.from(session.token.split(".")[0], "base64url").toString("utf8"));
        expect(Object.keys(payload).sort()).toEqual(["exp", "sub"]);
    });

    it("rejects a tampered signature", () => {
        const service = createSessionService({ secret: strongSecret });
        const token = service.createSession("user-id").token;
        const [payload, signature] = token.split(".");
        const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;

        expect(service.verifySession(tampered)).toBeNull();
    });

    it.each(["", "not-a-token", "a.b.c", "***.***", null, undefined])(
        "rejects malformed session token %s",
        (token) => {
            const service = createSessionService({ secret: strongSecret });
            expect(service.verifySession(token)).toBeNull();
        },
    );

    it("rejects expired sessions", () => {
        let now = 1700000000000;
        const service = createSessionService({ secret: strongSecret, ttlSeconds: 60, now: () => now });
        const token = service.createSession("user-id").token;
        now += 60000;

        expect(service.verifySession(token)).toBeNull();
    });

    it("requires a strong secret to issue a session", () => {
        const service = createSessionService({ secret: "too-short" });

        expect(() => service.createSession("user-id")).toThrow("SESSION_SECRET");
        expect(service.verifySession("payload.signature")).toBeNull();
    });
});
