(function exposeRuleBuilder(root, factory) {
    const ruleBuilder = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = ruleBuilder;
    } else {
        root.ruleBuilder = ruleBuilder;
    }
})(typeof globalThis === "object" ? globalThis : this, function createRuleBuilder() {
    const numericFields = new Set([
        "screen_width",
        "screen_height",
    ]);
    const supportedFields = [
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
    ];
    const stringOperators = ["equals", "not_equals", "contains", "starts_with"];
    const numericOperators = ["equals", "not_equals", "greater_than", "less_than"];
    const operatorLabels = {
        equals: "equals",
        not_equals: "does not equal",
        contains: "contains",
        starts_with: "starts with",
        greater_than: "greater than",
        less_than: "less than",
        cidr: "matches CIDR",
    };
    const fieldLabels = {
        country: "Country",
        region: "Region",
        city: "City",
        ip: "IP address",
        browser: "Browser",
        os: "Operating system",
        device_type: "Device type",
        language: "Language",
        timezone: "Timezone",
        screen_width: "Screen width",
        screen_height: "Screen height",
    };

    function operatorsForField(field) {
        if (numericFields.has(field)) return [...numericOperators];
        if (field === "ip") return [...stringOperators, "cidr"];
        return [...stringOperators];
    }

    function createLeafCondition() {
        return { field: "country", operator: "equals", value: "" };
    }

    function createConditionsState() {
        return { operator: "AND", conditions: [createLeafCondition()] };
    }

    function cloneCondition(condition) {
        if (Array.isArray(condition)) return condition.map(cloneCondition);
        if (!condition || typeof condition !== "object") return condition;
        return Object.fromEntries(
            Object.entries(condition).map(([key, value]) => [key, cloneCondition(value)]),
        );
    }

    function toEditorConditionState(condition) {
        const copy = cloneCondition(condition);
        if (copy && typeof copy === "object" && Array.isArray(copy.conditions)) {
            return copy;
        }
        return { operator: "AND", conditions: [copy] };
    }

    function isLogicalCondition(condition) {
        return Boolean(
            condition &&
            typeof condition === "object" &&
            !Array.isArray(condition) &&
            (condition.operator === "AND" || condition.operator === "OR") &&
            Array.isArray(condition.conditions),
        );
    }

    function validateLeaf(leaf) {
        if (!leaf || !supportedFields.includes(leaf.field)) {
            throw new Error("Choose a supported condition field.");
        }
        if (!operatorsForField(leaf.field).includes(leaf.operator)) {
            throw new Error("That operator is not supported for the selected field.");
        }
        if (numericFields.has(leaf.field)) {
            const value = typeof leaf.value === "number" ? leaf.value : Number(leaf.value);
            if (typeof leaf.value === "string" && leaf.value.trim() === "") {
                throw new Error(`${fieldLabels[leaf.field]} requires a numeric value.`);
            }
            if (!Number.isFinite(value)) {
                throw new Error(`${fieldLabels[leaf.field]} requires a numeric value.`);
            }
            if (["screen_width", "screen_height"].includes(leaf.field) && value <= 0) {
                throw new Error(`${fieldLabels[leaf.field]} must be greater than zero.`);
            }
            return { field: leaf.field, operator: leaf.operator, value };
        }

        if (typeof leaf.value !== "string" || leaf.value.trim() === "") {
            throw new Error(`${fieldLabels[leaf.field]} requires a value.`);
        }
        if (leaf.field === "ip" && leaf.operator === "cidr") {
            const [address, prefix, extra] = leaf.value.split("/");
            const octets = address.split(".");
            const validAddress = octets.length === 4 && octets.every((octet) => (
                /^\d{1,3}$/.test(octet) && Number(octet) <= 255
            ));
            if (
                !validAddress ||
                extra !== undefined ||
                !/^\d{1,2}$/.test(prefix || "") ||
                Number(prefix) > 32
            ) {
                throw new Error("Enter a valid IPv4 CIDR value, such as 192.168.1.0/24.");
            }
        }
        return { field: leaf.field, operator: leaf.operator, value: leaf.value };
    }

    function serializeCondition(condition) {
        if (isLogicalCondition(condition)) {
            if (condition.conditions.length < 1 || condition.conditions.length > 50) {
                throw new Error("Each condition group must contain between 1 and 50 conditions.");
            }
            return {
                operator: condition.operator,
                conditions: condition.conditions.map(serializeCondition),
            };
        }
        return validateLeaf(condition);
    }

    function serializeConditions(conditions) {
        const serialized = serializeCondition(conditions);
        if (!isLogicalCondition(serialized)) {
            throw new Error("Conditions must have an AND or OR logical root.");
        }
        return serialized;
    }

    function buildRulePayload(input) {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 150) {
            throw new Error("Enter a rule name (up to 150 characters).");
        }
        const priority = typeof input.priority === "number" ? input.priority : Number(input.priority);
        if (!Number.isInteger(priority) || priority < 0 || priority > 1000000) {
            throw new Error("Priority must be a whole number from 0 to 1,000,000.");
        }
        if (typeof input.enabled !== "boolean") {
            throw new Error("Choose whether this rule is enabled.");
        }
        if (!["none", "redirect", "open_new_tab"].includes(input.action)) {
            throw new Error("Choose a supported action.");
        }
        if (!["off", "prompt"].includes(input.fullscreenMode)) {
            throw new Error("Choose a supported fullscreen mode.");
        }

        const payload = {
            name,
            priority,
            enabled: input.enabled,
            conditions: serializeConditions(input.conditions),
            action: input.action,
            frequencyEnabled: input.frequencyEnabled,
            frequencySeconds: null,
            frequencyMode: null,
            fullscreenMode: input.fullscreenMode,
        };

        if (input.action !== "none") {
            const destinationUrl = typeof input.destinationUrl === "string"
                ? input.destinationUrl.trim()
                : "";
            let parsedDestination;
            try {
                parsedDestination = new URL(destinationUrl);
            } catch {
                throw new Error("Enter a valid HTTP or HTTPS destination URL.");
            }
            if (!["http:", "https:"].includes(parsedDestination.protocol)) {
                throw new Error("Destination URL must use HTTP or HTTPS.");
            }
            payload.destinationUrl = destinationUrl;
        }

        if (typeof input.frequencyEnabled !== "boolean") {
            throw new Error("Choose whether frequency limits are enabled.");
        }
        if (input.frequencyEnabled) {
            const frequencySeconds = typeof input.frequencySeconds === "number"
                ? input.frequencySeconds
                : Number(input.frequencySeconds);
            if (!Number.isInteger(frequencySeconds) || frequencySeconds <= 0 || frequencySeconds > 1073741823) {
                throw new Error("Frequency seconds must be a positive whole number.");
            }
            if (!["cooldown", "return_after"].includes(input.frequencyMode)) {
                throw new Error("Choose a supported frequency mode.");
            }
            payload.frequencySeconds = frequencySeconds;
            payload.frequencyMode = input.frequencyMode;
        }

        return payload;
    }

    return {
        createConditionsState,
        createLeafCondition,
        buildRulePayload,
        cloneCondition,
        toEditorConditionState,
        fieldLabels,
        numericFields: [...numericFields],
        operatorLabels,
        operatorsForField,
        serializeConditions,
        supportedFields,
    };
});
