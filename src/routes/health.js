const express = require("express");
const db = require("../config/db");
const redis = require("../config/redis");

function createHealthRouter({
    database = db,
    redisClient = redis,
} = {}) {
    const router = express.Router();

    router.get("/health", async (req, res) => {
        const results = await Promise.allSettled([
            database.raw("SELECT 1"),
            redisClient.ping(),
        ]);
        const databaseHealthy = results[0].status === "fulfilled";
        const redisHealthy = results[1].status === "fulfilled" && results[1].value === "PONG";

        if (!databaseHealthy || !redisHealthy) {
            console.error("Dependency health check failed.");
            return res.status(503).json({
                status: "error",
                database: databaseHealthy ? "ok" : "unavailable",
                redis: redisHealthy ? "ok" : "unavailable",
            });
        }

        return res.json({
            status: "ok",
            database: "ok",
            redis: "ok",
        });
    });

    return router;
}

module.exports = { createHealthRouter };