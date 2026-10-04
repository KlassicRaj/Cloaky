function asObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
    if (typeof value !== "string") {
        return null;
    }

    return value.trim() || null;
}

function normalizeNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }

    if (typeof value === "string" && value.trim() === "") {
        return null;
    }

    const number = typeof value === "number" ? value : Number(value.trim());
    return Number.isFinite(number) ? number : null;
}

function normalizeVisitor(input) {
    const visitor = asObject(input);
    const geo = asObject(visitor.geo);
    const screen = asObject(visitor.screen);
    const browserGeo = visitor.browserGeo == null ? null : asObject(visitor.browserGeo);

    return {
        ip: normalizeString(visitor.ip),
        geo: {
            country: normalizeString(geo.country),
            region: normalizeString(geo.region),
            city: normalizeString(geo.city),
        },
        browserGeo: browserGeo
            ? {
                latitude: normalizeNumber(browserGeo.latitude),
                longitude: normalizeNumber(browserGeo.longitude),
                accuracy: normalizeNumber(browserGeo.accuracy),
            }
            : null,
        browser: normalizeString(visitor.browser),
        os: normalizeString(visitor.os),
        deviceType: normalizeString(visitor.deviceType),
        language: normalizeString(visitor.language),
        timezone: normalizeString(visitor.timezone),
        screen: {
            width: normalizeNumber(screen.width),
            height: normalizeNumber(screen.height),
        },
    };
}

module.exports = { normalizeVisitor };