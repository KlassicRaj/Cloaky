const { loginRequestSchema } = require("../validation/authValidation");
const { SESSION_COOKIE_NAME } = require("../services/sessionService");

function validationResponse(res, issues) {
    return res.status(400).json({
        error: "validation_error",
        details: issues.map(({ code, message, path }) => ({ code, message, path })),
    });
}

function cookieOptions({ secure, maxAge } = {}) {
    return {
        httpOnly: true,
        secure: secure === true,
        sameSite: "strict",
        path: "/api",
        ...(maxAge === undefined ? {} : { maxAge }),
    };
}

function createAuthController({ authService, sessionService, cookieSecure }) {
    return {
        async login(req, res, next) {
            const validation = loginRequestSchema.safeParse(req.body);
            if (!validation.success) return validationResponse(res, validation.error.issues);

            try {
                const user = await authService.authenticate(validation.data.username, validation.data.password);
                if (!user) return res.status(401).json({ error: "invalid_credentials" });

                const session = sessionService.createSession(user.id);
                const maxAge = Math.max(0, session.expiresAt * 1000 - Date.now());
                res.cookie(SESSION_COOKIE_NAME, session.token, cookieOptions({
                    secure: cookieSecure,
                    maxAge,
                }));
                return res.json({ authenticated: true });
            } catch (error) {
                return next(error);
            }
        },

        logout(req, res) {
            res.clearCookie(SESSION_COOKIE_NAME, cookieOptions({ secure: cookieSecure }));
            return res.json({ loggedOut: true });
        },
    };
}

module.exports = { createAuthController };