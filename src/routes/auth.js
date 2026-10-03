const express = require("express");
const { createAuthController } = require("../controllers/authController");

function createAuthRouter({ authService, sessionService, cookieSecure, loginRateLimitMiddleware }) {
    const router = express.Router();
    const controller = createAuthController({ authService, sessionService, cookieSecure });

    router.post("/login", loginRateLimitMiddleware, controller.login);
    router.post("/logout", controller.logout);

    return router;
}

module.exports = { createAuthRouter };