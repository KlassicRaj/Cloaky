const SUPPORTED_RULE_FIELDS = Object.freeze([
    "country",
    "region",
    "city",
    "ip",
    "browser",
    "os",
    "device_type",
    "language",
    "timezone",
    "screen_width",
    "screen_height",
]);

const SUPPORTED_RULE_OPERATORS = Object.freeze([
    "equals",
    "not_equals",
    "contains",
    "starts_with",
    "greater_than",
    "less_than",
    "cidr",
]);

function isLogicalCondition(condition) {
    return Boolean(
        condition &&
        typeof condition === "object" &&
        !Array.isArray(condition) &&
        (condition.operator === "AND" || condition.operator === "OR") &&
        Array.isArray(condition.conditions),
    );
}

function isLeafCondition(condition) {
    return Boolean(
        condition &&
        typeof condition === "object" &&
        !Array.isArray(condition) &&
        typeof condition.field === "string" &&
        typeof condition.operator === "string" &&
        Object.prototype.hasOwnProperty.call(condition, "value"),
    );
}

function getConditionType(condition) {
    if (isLogicalCondition(condition)) {
        return "logical";
    }

    if (isLeafCondition(condition)) {
        return "leaf";
    }

    return null;
}

module.exports = {
    SUPPORTED_RULE_FIELDS,
    SUPPORTED_RULE_OPERATORS,
    isLogicalCondition,
    isLeafCondition,
    getConditionType,
};