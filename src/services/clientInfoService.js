const BROWSERS = new Map([
    ["chrome", "Chrome"],
    ["google chrome", "Chrome"],
    ["firefox", "Firefox"],
    ["mozilla firefox", "Firefox"],
    ["safari", "Safari"],
    ["edge", "Edge"],
    ["microsoft edge", "Edge"],
    ["opera", "Opera"],
    ["opera gx", "Opera"],
    ["samsung internet", "Samsung Internet"],
    ["samsung internet browser", "Samsung Internet"],
]);

const OPERATING_SYSTEMS = new Map([
    ["windows", "Windows"],
    ["macos", "macOS"],
    ["mac os", "macOS"],
    ["mac os x", "macOS"],
    ["os x", "macOS"],
    ["linux", "Linux"],
    ["android", "Android"],
    ["ios", "iOS"],
    ["iphone os", "iOS"],
    ["ipados", "iOS"],
]);

function asObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function trimmedString(value) {
    if (typeof value !== "string") {
        return null;
    }

    return value.trim() || null;
}

function normalizeNamedValue(value, values) {
    const trimmed = trimmedString(value);
    if (!trimmed) {
        return null;
    }

    return values.get(trimmed.toLowerCase()) || "Other";
}

function normalizeDeviceType(value) {
    const trimmed = trimmedString(value);
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.toLowerCase();
    return ["desktop", "mobile", "tablet"].includes(normalized) ? normalized : "other";
}

function normalizeLanguage(value) {
    const language = trimmedString(value);
    if (!language || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)) {
        return null;
    }

    return language.split("-").map((subtag, index) => {
        if (index === 0) {
            return subtag.toLowerCase();
        }

        if (/^[a-zA-Z]{4}$/.test(subtag)) {
            return `${subtag[0].toUpperCase()}${subtag.slice(1).toLowerCase()}`;
        }

        if (/^(?:[a-zA-Z]{2}|\d{3})$/.test(subtag)) {
            return subtag.toUpperCase();
        }

        return subtag.toLowerCase();
    }).join("-");
}

function normalizeTimezone(value) {
    const timezone = trimmedString(value);
    if (!timezone) {
        return null;
    }

    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
        return timezone;
    } catch {
        return null;
    }
}

function normalizeDimension(value) {
    if (typeof value === "number") {
        return Number.isInteger(value) && value > 0 ? value : null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const dimension = value.trim();
    if (!/^\+?\d+(?:\.0+)?$/.test(dimension)) {
        return null;
    }

    const number = Number(dimension);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeClientInfo(input) {
    const clientInfo = asObject(input);
    const screen = asObject(clientInfo.screen);

    return {
        browser: normalizeNamedValue(clientInfo.browser, BROWSERS),
        os: normalizeNamedValue(clientInfo.os, OPERATING_SYSTEMS),
        deviceType: normalizeDeviceType(clientInfo.deviceType),
        language: normalizeLanguage(clientInfo.language),
        timezone: normalizeTimezone(clientInfo.timezone),
        screen: {
            width: normalizeDimension(screen.width),
            height: normalizeDimension(screen.height),
        },
    };
}

module.exports = { normalizeClientInfo };