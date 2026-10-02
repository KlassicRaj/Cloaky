const { createDecision } = require("../domain/decision");
const { isLeafCondition, isLogicalCondition } = require("../domain/rule");

const FIELD_GETTERS = Object.freeze({
    country: (visitor) => visitor?.geo?.country,
    region: (visitor) => visitor?.geo?.region,
    city: (visitor) => visitor?.geo?.city,
    ip: (visitor) => visitor?.ip,
    browser: (visitor) => visitor?.browser,
    os: (visitor) => visitor?.os,
    device_type: (visitor) => visitor?.deviceType,
    language: (visitor) => visitor?.language,
    timezone: (visitor) => visitor?.timezone,
    screen_width: (visitor) => visitor?.screen?.width,
    screen_height: (visitor) => visitor?.screen?.height,
    browser_geo_latitude: (visitor) => visitor?.browserGeo?.latitude,
    browser_geo_longitude: (visitor) => visitor?.browserGeo?.longitude,
    browser_geo_accuracy: (visitor) => visitor?.browserGeo?.accuracy,
});

function valuesEqual(left, right) {
    if (left === null || left === undefined || right === null || right === undefined) {
        return false;
    }

    if (typeof left === "string" && typeof right === "string") {
        return left.toLowerCase() === right.toLowerCase();
    }

    return left === right;
}

function toFiniteNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }

    if (typeof value === "string" && value.trim() === "") {
        return null;
    }

    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

function parseIpv4(address) {
    if (typeof address !== "string") {
        return null;
    }

    const octets = address.split(".");
    if (octets.length !== 4) {
        return null;
    }

    let value = 0;
    for (const octet of octets) {
        if (!/^\d{1,3}$/.test(octet)) {
            return null;
        }

        const number = Number(octet);
        if (number > 255) {
            return null;
        }

        value = value * 256 + number;
    }

    return value >>> 0;
}

function matchesIpv4Cidr(address, cidr) {
    if (typeof cidr !== "string") {
        return false;
    }

    const parts = cidr.split("/");
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) {
        return false;
    }

    const prefixLength = Number(parts[1]);
    const addressValue = parseIpv4(address);
    const networkValue = parseIpv4(parts[0]);

    if (addressValue === null || networkValue === null || prefixLength > 32) {
        return false;
    }

    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return ((addressValue & mask) >>> 0) === ((networkValue & mask) >>> 0);
}

function evaluateLeaf(visitor, condition) {
    if (!isLeafCondition(condition)) {
        return false;
    }

    const getFieldValue = FIELD_GETTERS[condition.field];
    if (!getFieldValue) {
        return false;
    }

    const actualValue = getFieldValue(visitor);
    const expectedValue = condition.value;

    switch (condition.operator) {
        case "equals":
            return valuesEqual(actualValue, expectedValue);
        case "not_equals":
            return !valuesEqual(actualValue, expectedValue);
        case "contains":
            return typeof actualValue === "string" &&
                typeof expectedValue === "string" &&
                actualValue.toLowerCase().includes(expectedValue.toLowerCase());
        case "starts_with":
            return typeof actualValue === "string" &&
                typeof expectedValue === "string" &&
                actualValue.toLowerCase().startsWith(expectedValue.toLowerCase());
        case "greater_than": {
            const actualNumber = toFiniteNumber(actualValue);
            const expectedNumber = toFiniteNumber(expectedValue);
            return actualNumber !== null && expectedNumber !== null && actualNumber > expectedNumber;
        }
        case "less_than": {
            const actualNumber = toFiniteNumber(actualValue);
            const expectedNumber = toFiniteNumber(expectedValue);
            return actualNumber !== null && expectedNumber !== null && actualNumber < expectedNumber;
        }
        case "cidr":
            return matchesIpv4Cidr(actualValue, expectedValue);
        default:
            return false;
    }
}

function evaluateCondition(visitor, condition) {
    if (isLogicalCondition(condition)) {
        if (condition.conditions.length === 0) {
            return false;
        }

        if (condition.operator === "AND") {
            return condition.conditions.every((child) => evaluateCondition(visitor, child));
        }

        return condition.conditions.some((child) => evaluateCondition(visitor, child));
    }

    return evaluateLeaf(visitor, condition);
}

function evaluateRules(visitor, rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return createDecision();
    }

    const sortedRules = rules
        .map((rule, index) => ({
            rule,
            index,
            priority: typeof rule?.priority === "number" && Number.isFinite(rule.priority)
                ? rule.priority
                : Number.POSITIVE_INFINITY,
        }))
        .sort((left, right) => left.priority - right.priority || left.index - right.index);

    for (const { rule } of sortedRules) {
        if (!rule || rule.enabled !== true || !evaluateCondition(visitor, rule.conditions)) {
            continue;
        }

        return createDecision({
            matched: true,
            ruleId: rule.id,
            action: rule.action,
            destinationUrl: rule.destination_url,
            fullscreenMode: rule.fullscreen_mode,
            reason: "rule_matched",
        });
    }

    return createDecision();
}

module.exports = { evaluateRules };