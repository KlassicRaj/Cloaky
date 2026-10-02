const express = require("express");
const db = require("../config/db");

const router = express.Router();

router.get("/health", async (req, res) => {
    try {
        await db.raw("SELECT 1");

        res.json({
            status: "ok",
            database: "ok",
        });
    } catch (error) {
        console.error("Database health check failed:", error);

        res.status(503).json({
            status: "error",
            database: "unavailable",
        });
    }
});

module.exports = router;