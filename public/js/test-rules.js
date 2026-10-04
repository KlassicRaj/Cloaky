(function initializeTestRules() {
    const projectId = new URLSearchParams(window.location.search).get("id");
    const form = document.getElementById("test-rules-form");
    const visitType = document.getElementById("test-visit-type");
    const elapsedInput = document.getElementById("test-seconds-since");
    const submitButton = document.getElementById("test-rules-submit");
    const errorMessage = document.getElementById("test-rules-error");
    const resultPanel = document.getElementById("test-rules-result");
    const resultContent = document.getElementById("test-result-content");

    function readOptionalText(formData, key) {
        const value = formData.get(key);
        if (typeof value !== "string" || value.trim() === "") return undefined;
        return value.trim();
    }

    function readOptionalNumber(formData, key) {
        const value = formData.get(key);
        if (typeof value !== "string" || value.trim() === "") return undefined;
        const number = Number(value);
        return Number.isFinite(number) ? number : value;
    }

    function addOptional(target, key, value) {
        if (value !== undefined) target[key] = value;
    }

    function buildRequestBody(formData) {
        const visitor = {};
        addOptional(visitor, "ip", readOptionalText(formData, "ip"));
        addOptional(visitor, "browser", readOptionalText(formData, "browser"));
        addOptional(visitor, "os", readOptionalText(formData, "os"));
        addOptional(visitor, "deviceType", readOptionalText(formData, "deviceType"));
        addOptional(visitor, "language", readOptionalText(formData, "language"));
        addOptional(visitor, "timezone", readOptionalText(formData, "timezone"));

        const geo = {};
        addOptional(geo, "country", readOptionalText(formData, "country"));
        addOptional(geo, "region", readOptionalText(formData, "region"));
        addOptional(geo, "city", readOptionalText(formData, "city"));
        if (Object.keys(geo).length > 0) visitor.geo = geo;

        const screen = {};
        addOptional(screen, "width", readOptionalNumber(formData, "screenWidth"));
        addOptional(screen, "height", readOptionalNumber(formData, "screenHeight"));
        if (Object.keys(screen).length > 0) visitor.screen = screen;

        const frequencySimulation = { visit: visitType.value };
        if (visitType.value === "returning") {
            frequencySimulation.secondsSincePreviousTrigger =
                readOptionalNumber(formData, "secondsSincePreviousTrigger") ?? 0;
        }
        return { visitor, frequencySimulation };
    }

    function appendDetail(parent, label, value) {
        const row = document.createElement("p");
        const term = document.createElement("strong");
        term.textContent = `${label}: `;
        const description = document.createElement("span");
        description.textContent = value;
        row.append(term, description);
        parent.append(row);
    }

    function showResult(result) {
        resultContent.replaceChildren();
        if (!result.matched) {
            const noMatch = document.createElement("p");
            noMatch.className = "test-no-match";
            noMatch.textContent = "No rule matched.";
            resultContent.append(noMatch);
            appendDetail(resultContent, "Reason", result.reason);
        } else {
            const name = document.createElement("p");
            const nameLabel = document.createElement("strong");
            nameLabel.textContent = "Matched rule: ";
            const nameValue = document.createElement("span");
            nameValue.textContent = result.ruleName || "Rule";
            name.append(nameLabel, nameValue);
            resultContent.append(name);

            appendDetail(resultContent, "Priority", String(result.priority));
            appendDetail(resultContent, "Rule ID", result.ruleId);
            appendDetail(resultContent, "Configured action", result.configuredAction);
            appendDetail(resultContent, "Action", result.action);
            if (result.destinationUrl) appendDetail(resultContent, "Destination", result.destinationUrl);
            appendDetail(resultContent, "Frequency", result.frequencyStatus);
            appendDetail(resultContent, "Triggered", result.triggered ? "Yes" : "No");
            appendDetail(resultContent, "Fullscreen", result.fullscreenMode);
            appendDetail(resultContent, "Reason", result.reason);
        }
        resultPanel.hidden = false;
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.hidden = false;
    }

    visitType.addEventListener("change", () => {
        const returning = visitType.value === "returning";
        elapsedInput.disabled = !returning;
        if (!returning) elapsedInput.value = "0";
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorMessage.hidden = true;
        resultPanel.hidden = true;
        submitButton.disabled = true;
        submitButton.textContent = "Testing…";

        try {
            const result = await window.dashboardApi.request(
                `/api/projects/${encodeURIComponent(projectId)}/test-rules`,
                {
                    method: "POST",
                    body: buildRequestBody(new FormData(form)),
                },
            );
            showResult(result);
        } catch (error) {
            if (error.status === 401) return;
            showError(window.dashboardApi.messageFor(
                error,
                error.status === 404
                    ? "This project could not be found."
                    : error.name === "NetworkError"
                        ? "Could not connect to the server. Check your connection and try again."
                        : "Could not test the rules. Check the simulation values and try again.",
            ));
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Test Rules";
        }
    });
})();
