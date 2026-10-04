const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const router = express.Router();
const sdkSource = fs.readFileSync(path.resolve(__dirname, "../sdk/sdk.js"), "utf8");

router.get("/sdk.js", (req, res) => {
    res
        .type("application/javascript")
        .set("Cache-Control", "public, max-age=86400")
        .send(sdkSource);
});

module.exports = router;