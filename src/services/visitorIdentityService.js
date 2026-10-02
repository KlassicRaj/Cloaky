const { createHmac } = require("node:crypto");
const env = require("../config/env");

function createVisitorId(ip) {
    if (typeof ip !== "string" || ip.trim() === "") {
        throw new TypeError("ip must be a non-empty string");
    }

    const secret = env.IP_HASH_SECRET;
    if (typeof secret !== "string" || secret.trim() === "") {
        throw new Error("IP_HASH_SECRET must be configured to create a visitor ID");
    }

    return createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}

module.exports = { createVisitorId };