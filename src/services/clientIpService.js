const { isIP } = require("node:net");
const env = require("../config/env");

function parseIpv4(ip) {
    const octets = ip.split(".");
    if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
        return null;
    }

    let value = 0;
    for (const octet of octets) {
        const number = Number(octet);
        if (number > 255) {
            return null;
        }

        value = value * 256 + number;
    }

    return value >>> 0;
}

function normalizeIp(value) {
    if (typeof value !== "string") {
        return null;
    }

    const ip = value.trim();
    if (!ip || isIP(ip) === 0) {
        return null;
    }

    const dottedMappedIp = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (dottedMappedIp && isIP(dottedMappedIp[1]) === 4) {
        return dottedMappedIp[1];
    }

    const hexMappedIp = ip.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i);
    if (hexMappedIp) {
        const high = Number.parseInt(hexMappedIp[1], 16);
        const low = Number.parseInt(hexMappedIp[2], 16);
        return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
    }

    return ip.toLowerCase();
}

function trustedProxyEntries() {
    if (typeof env.TRUSTED_PROXIES !== "string") {
        return [];
    }

    return env.TRUSTED_PROXIES
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const cidrParts = entry.split("/");
            if (cidrParts.length === 2 && isIP(cidrParts[0]) === 4 && /^\d{1,2}$/.test(cidrParts[1])) {
                const prefixLength = Number(cidrParts[1]);
                if (prefixLength <= 32) {
                    return { type: "cidr", network: parseIpv4(cidrParts[0]), prefixLength };
                }
            }

            if (cidrParts.length === 1) {
                const ip = normalizeIp(entry);
                if (ip) {
                    return { type: "exact", ip };
                }
            }

            return null;
        })
        .filter(Boolean);
}

function isTrustedProxy(ip, entries) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        return false;
    }

    return entries.some((entry) => {
        if (entry.type === "exact") {
            return normalizedIp === entry.ip;
        }

        if (entry.type === "cidr" && isIP(normalizedIp) === 4) {
            const address = parseIpv4(normalizedIp);
            const mask = entry.prefixLength === 0
                ? 0
                : (0xffffffff << (32 - entry.prefixLength)) >>> 0;
            return ((address & mask) >>> 0) === ((entry.network & mask) >>> 0);
        }

        return false;
    });
}

function getHeader(headers, targetName) {
    if (!headers || typeof headers !== "object") {
        return null;
    }

    const headerName = Object.keys(headers).find((name) => name.toLowerCase() === targetName);
    const value = headerName === undefined ? null : headers[headerName];
    return typeof value === "string" ? value : null;
}

function forwardedChainClientIp(headerValue, entries) {
    if (typeof headerValue !== "string") {
        return null;
    }

    const values = headerValue.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length === 0) {
        return null;
    }

    const addresses = values.map(normalizeIp);
    if (addresses.some((address) => address === null)) {
        return null;
    }

    for (let index = addresses.length - 1; index >= 0; index -= 1) {
        if (!isTrustedProxy(addresses[index], entries)) {
            return addresses[index];
        }
    }

    return null;
}

function getClientIp(req) {
    const socketIp = normalizeIp(req?.socket?.remoteAddress);
    if (!socketIp) {
        return null;
    }

    const entries = trustedProxyEntries();
    if (!isTrustedProxy(socketIp, entries)) {
        return socketIp;
    }

    const headers = req.headers;
    const forwardedIp = forwardedChainClientIp(
        getHeader(headers, "x-forwarded-for"),
        entries,
    );
    if (forwardedIp) {
        return forwardedIp;
    }

    // X-Forwarded-For is preferred; Cloudflare's single-hop value precedes X-Real-IP as fallback.
    for (const headerName of ["cf-connecting-ip", "x-real-ip"]) {
        const candidate = normalizeIp(getHeader(headers, headerName));
        if (candidate) {
            return candidate;
        }
    }

    return socketIp;
}

module.exports = { getClientIp };