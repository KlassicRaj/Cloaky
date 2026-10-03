const { SESSION_COOKIE_NAME } = require("../services/sessionService");

function sessionCookieValue(req) {
    const cookieHeader = req.headers?.cookie;
    if (typeof cookieHeader !== "string") return null;

    let value = null;
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
        if (value !== null) return null;

        try {
            value = decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return value;
}

function createRequireAuth({ sessionService, userRepository }) {
    return async function requireAuth(req, res, next) {
        if (req.method === "OPTIONS") return next();

        const claims = sessionService.verifySession(sessionCookieValue(req));
        if (!claims) return res.status(401).json({ error: "unauthorized" });

        try {
            const user = await userRepository.findById(claims.userId);
            if (!user) return res.status(401).json({ error: "unauthorized" });

            req.userId = user.id;
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = { createRequireAuth };