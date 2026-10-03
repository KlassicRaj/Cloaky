const express = require("express");
const { createRedirectController } = require("../controllers/redirectController");

function createRedirectRouter({ evaluationService }) {
    const router = express.Router();
    router.get("/r/:projectKey", createRedirectController({ evaluationService }));
    return router;
}

module.exports = { createRedirectRouter };