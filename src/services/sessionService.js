const { createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_COOKIE_NAME = "visitor_routing_session";
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}

function createSessionService({ secret, ttlSeconds = DEFAULT_SESSION_TTL_SECONDS, now = Date.now } = {}) {
    function hasStrongSecret() {
        return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
    }

    function signature(payload) {
        return createHmac("sha256", secret).update(payload).digest("base64url");
    }

    function createSession(userId) {
        if (!hasStrongSecret()) {
            throw new Error("SESSION_SECRET must contain at least 32 bytes");
        }
        if (typeof userId !== "string" || userId.length === 0) {
            throw new TypeError("A user ID is required to create a session");
        }

        const expiresAt = Math.floor(now() / 1000) + ttlSeconds;
        const payload = base64UrlEncode(JSON.stringify({ sub: userId, exp: expiresAt }));
        return { token: `${payload}.${signature(payload)}`, expiresAt };
    }

    function verifySession(token) {
        if (!hasStrongSecret() || typeof token !== "string" || token.length > 4096) {
            return null;
        }

        const parts = token.split(".");
        if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
            return null;
        }

        try {
            const providedSignature = Buffer.from(parts[1], "base64url");
            const expectedSignature = Buffer.from(signature(parts[0]), "base64url");
            if (
                providedSignature.length !== expectedSignature.length ||
                !timingSafeEqual(providedSignature, expectedSignature)
            ) {
                return null;
            }

            const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
            if (
                !payload ||
                typeof payload !== "object" ||
                Object.keys(payload).length !== 2 ||
                typeof payload.sub !== "string" ||
                payload.sub.length === 0 ||
                !Number.isInteger(payload.exp) ||
                payload.exp <= Math.floor(now() / 1000)
            ) {
                return null;
            }

            return { userId: payload.sub, expiresAt: payload.exp };
        } catch {
            return null;
        }
    }

    return { createSession, verifySession, ttlSeconds };
}

module.exports = {
    DEFAULT_SESSION_TTL_SECONDS,
    SESSION_COOKIE_NAME,
    createSessionService,
};