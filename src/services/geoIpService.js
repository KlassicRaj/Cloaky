const { isIP } = require("node:net");
const maxmind = require("maxmind");
const env = require("../config/env");

function emptyLocation() {
    return { country: null, region: null, city: null };
}

function normalizeString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cityName(record) {
    const names = record?.city?.names;
    if (!names || typeof names !== "object") {
        return null;
    }

    const englishName = normalizeString(names.en);
    if (englishName) {
        return englishName;
    }

    return Object.values(names).map(normalizeString).find(Boolean) || null;
}

function createGeoIpService({ openDatabase = (databasePath) => maxmind.open(databasePath) } = {}) {
    let reader = null;
    let initializationPromise = null;

    async function loadDatabase() {
        const databasePath = env.GEOIP_DATABASE_PATH;
        if (typeof databasePath !== "string" || databasePath.trim() === "") {
            console.error("GeoIP database path is not configured; GeoIP lookups are disabled.");
            return false;
        }

        try {
            const loadedReader = await openDatabase(databasePath);
            if (!loadedReader || typeof loadedReader.get !== "function") {
                throw new Error("MaxMind did not return a usable database reader");
            }

            reader = loadedReader;
            return true;
        } catch (error) {
            reader = null;
            console.error("GeoIP database initialization failed:", error.message);
            return false;
        }
    }

    function initialize() {
        if (!initializationPromise) {
            initializationPromise = loadDatabase();
        }

        return initializationPromise;
    }

    function lookup(ip) {
        if (!reader || typeof ip !== "string" || isIP(ip) === 0) {
            return emptyLocation();
        }

        try {
            const result = reader.get(ip);
            if (!result) {
                return emptyLocation();
            }

            return {
                country: normalizeString(result.country?.iso_code),
                region: normalizeString(result.subdivisions?.[0]?.iso_code),
                city: cityName(result),
            };
        } catch {
            return emptyLocation();
        }
    }

    return { initialize, lookup };
}

module.exports = { ...createGeoIpService(), createGeoIpService };