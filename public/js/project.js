(function initializeProjectPage() {
    const projectStatusMessage = document.getElementById("project-status-message");
    const projectContent = document.getElementById("project-content");
    const rulesMessage = document.getElementById("rules-message");
    const rulesList = document.getElementById("rules-list");
    const editor = document.getElementById("rule-editor");
    const form = document.getElementById("rule-form");
    const saveButton = document.getElementById("save-rule-button");
    const actionInput = document.getElementById("rule-action");
    const frequencyEnabledInput = document.getElementById("frequency-enabled");
    const conditionTree = document.getElementById("condition-tree");
    const projectId = new URLSearchParams(window.location.search).get("id");
    const fieldLabels = window.ruleBuilder.fieldLabels;
    let currentProject = null;
    let rules = [];
    let editingRuleId = null;
    let conditionsState = window.ruleBuilder.createConditionsState();

    function setMessage(target, text, isError = false) {
        target.textContent = text;
        target.classList.toggle("error-message", isError);
        target.hidden = false;
    }

    function clearMessage(target) {
        target.textContent = "";
        target.hidden = true;
        target.classList.remove("error-message");
    }

    function makeElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function makeSelect(options, selectedValue, accessibleLabel) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", accessibleLabel);
        options.forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.append(option);
        });
        select.value = selectedValue;
        return select;
    }

    function parentCondition(path) {
        return path.slice(0, -1).reduce((node, index) => node.conditions[index], conditionsState);
    }

    function removeCondition(path) {
        const parent = parentCondition(path);
        parent.conditions.splice(path[path.length - 1], 1);
        renderConditionTree();
    }

    function renderLeafCondition(leaf, path, parent) {
        const row = makeElement("div", "condition-row");
        const fieldOptions = window.ruleBuilder.supportedFields.map((field) => [
            field,
            fieldLabels[field],
        ]);
        const fieldSelect = makeSelect(fieldOptions, leaf.field, "Condition field");
        fieldSelect.addEventListener("change", () => {
            leaf.field = fieldSelect.value;
            const allowedOperators = window.ruleBuilder.operatorsForField(leaf.field);
            if (!allowedOperators.includes(leaf.operator)) {
                leaf.operator = "equals";
            }
            if (leaf.field === "device_type" && !["mobile", "desktop", "tablet"].includes(leaf.value)) {
                leaf.value = "mobile";
            } else if (leaf.field !== "device_type" && !window.ruleBuilder.numericFields.includes(leaf.field)) {
                leaf.value = "";
            } else if (window.ruleBuilder.numericFields.includes(leaf.field)) {
                leaf.value = "";
            }
            renderConditionTree();
        });

        const operatorOptions = window.ruleBuilder.operatorsForField(leaf.field).map((operator) => [
            operator,
            window.ruleBuilder.operatorLabels[operator],
        ]);
        const operatorSelect = makeSelect(operatorOptions, leaf.operator, "Condition operator");
        operatorSelect.addEventListener("change", () => {
            leaf.operator = operatorSelect.value;
        });

        let valueInput;
        if (leaf.field === "device_type") {
            valueInput = makeSelect(
                [["mobile", "Mobile"], ["desktop", "Desktop"], ["tablet", "Tablet"]],
                leaf.value || "mobile",
                "Condition value",
            );
        } else {
            valueInput = document.createElement("input");
            valueInput.setAttribute("aria-label", "Condition value");
            valueInput.placeholder = leaf.field === "ip" && leaf.operator === "cidr"
                ? "192.168.1.0/24"
                : "Value";
            valueInput.type = window.ruleBuilder.numericFields.includes(leaf.field) ? "number" : "text";
            valueInput.step = "any";
            valueInput.value = leaf.value === undefined || leaf.value === null ? "" : String(leaf.value);
        }
        valueInput.addEventListener("input", () => {
            leaf.value = valueInput.value;
        });
        valueInput.addEventListener("change", () => {
            leaf.value = valueInput.value;
        });

        const removeButton = makeElement("button", "button-secondary condition-remove", "Remove");
        removeButton.type = "button";
        removeButton.disabled = parent.conditions.length === 1;
        removeButton.setAttribute("aria-label", "Remove condition");
        removeButton.addEventListener("click", () => removeCondition(path));

        row.append(fieldSelect, operatorSelect, valueInput, removeButton);
        return row;
    }

    function renderConditionNode(node, path, parent) {
        if (!node || !Array.isArray(node.conditions)) {
            return renderLeafCondition(node, path, parent);
        }

        const group = makeElement("fieldset", "condition-group");
        const toolbar = makeElement("div", "condition-group-toolbar");
        const operator = makeSelect(
            [["AND", "Match all (AND)"], ["OR", "Match any (OR)"]],
            node.operator,
            "Logical condition operator",
        );
        operator.addEventListener("change", () => {
            node.operator = operator.value;
        });
        toolbar.append(operator);

        if (path.length > 0) {
            const removeGroup = makeElement("button", "button-secondary condition-remove", "Remove group");
            removeGroup.type = "button";
            removeGroup.disabled = parent.conditions.length === 1;
            removeGroup.addEventListener("click", () => removeCondition(path));
            toolbar.append(removeGroup);
        }
        group.append(toolbar);

        const children = makeElement("div", "condition-children");
        node.conditions.forEach((child, index) => {
            children.append(renderConditionNode(child, path.concat(index), node));
        });

        const actions = makeElement("div", "condition-group-actions");
        const addLeaf = makeElement("button", "button-secondary", "+ Add condition");
        addLeaf.type = "button";
        addLeaf.addEventListener("click", () => {
            if (node.conditions.length >= 50) {
                setMessage(document.getElementById("condition-error"), "A group can contain at most 50 conditions.", true);
                return;
            }
            node.conditions.push(window.ruleBuilder.createLeafCondition());
            clearMessage(document.getElementById("condition-error"));
            renderConditionTree();
        });
        const addGroup = makeElement("button", "button-secondary", "+ Add nested group");
        addGroup.type = "button";
        addGroup.addEventListener("click", () => {
            if (node.conditions.length >= 50) {
                setMessage(document.getElementById("condition-error"), "A group can contain at most 50 conditions.", true);
                return;
            }
            node.conditions.push({
                operator: "AND",
                conditions: [window.ruleBuilder.createLeafCondition()],
            });
            clearMessage(document.getElementById("condition-error"));
            renderConditionTree();
        });
        actions.append(addLeaf, addGroup);
        group.append(children, actions);
        return group;
    }

    function renderConditionTree() {
        conditionTree.replaceChildren(renderConditionNode(conditionsState, [], null));
        clearMessage(document.getElementById("condition-error"));
    }

    function actionLabel(action) {
        return {
            none: "None",
            redirect: "Redirect",
            open_new_tab: "Open new tab",
        }[action] || "Unknown";
    }

    function renderRules() {
        rulesList.replaceChildren();
        if (rules.length === 0) {
            rulesList.append(makeElement(
                "p",
                "panel empty-state",
                "No rules yet. Create a rule to configure visitor routing.",
            ));
            return;
        }

        const sortedRules = rules
            .map((rule, index) => ({ rule, index }))
            .sort((left, right) => left.rule.priority - right.rule.priority || left.index - right.index)
            .map(({ rule }) => rule);

        sortedRules.forEach((rule) => {
            const card = makeElement("article", "panel rule-card");
            const details = makeElement("div", "rule-card-details");
            const titleRow = makeElement("div", "rule-title-row");
            titleRow.append(makeElement("h3", "", rule.name));
            titleRow.append(makeElement(
                "span",
                `status-badge${rule.enabled ? "" : " disabled"}`,
                rule.enabled ? "Enabled" : "Disabled",
            ));
            details.append(titleRow);
            details.append(makeElement("p", "project-meta", `Priority: ${rule.priority}`));
            details.append(makeElement(
                "p",
                "project-meta",
                `Action: ${actionLabel(rule.action)} · Frequency: ${
                    rule.frequencyEnabled
                        ? `${rule.frequencyMode === "cooldown" ? "Cooldown" : "Return after"} (${rule.frequencySeconds}s)`
                        : "Off"
                } · Fullscreen: ${rule.fullscreenMode === "prompt" ? "Prompt" : "Off"}`,
            ));

            const actions = makeElement("div", "rule-card-actions");
            const editButton = makeElement("button", "button-secondary", "Edit");
            editButton.type = "button";
            editButton.addEventListener("click", () => openEditor(rule));
            const deleteButton = makeElement("button", "button-danger", "Delete");
            deleteButton.type = "button";
            deleteButton.addEventListener("click", () => deleteRule(rule));
            actions.append(editButton, deleteButton);
            card.append(details, actions);
            rulesList.append(card);
        });
    }

    function setActionControls() {
        const needsDestination = actionInput.value !== "none";
        const destinationField = document.getElementById("destination-field");
        const destinationInput = document.getElementById("rule-destination");
        destinationField.hidden = !needsDestination;
        destinationInput.disabled = !needsDestination;
        destinationInput.required = needsDestination;
    }

    function setFrequencyControls() {
        const enabled = frequencyEnabledInput.checked;
        const options = document.getElementById("frequency-options");
        options.hidden = !enabled;
        document.getElementById("frequency-mode").disabled = !enabled;
        document.getElementById("frequency-seconds").disabled = !enabled;
        document.getElementById("frequency-seconds").required = enabled;
    }

    function resetEditor() {
        editingRuleId = null;
        conditionsState = window.ruleBuilder.createConditionsState();
        form.reset();
        document.getElementById("rule-priority").value = "0";
        document.getElementById("rule-enabled").checked = true;
        document.getElementById("frequency-seconds").value = "600";
        document.getElementById("frequency-mode").value = "cooldown";
        document.getElementById("fullscreen-mode").value = "off";
        document.getElementById("rule-editor-heading").textContent = "Create rule";
        saveButton.textContent = "Save rule";
        clearMessage(document.getElementById("rule-form-error"));
        clearMessage(document.getElementById("condition-error"));
        setActionControls();
        setFrequencyControls();
        renderConditionTree();
    }

    function openEditor(rule) {
        resetEditor();
        if (rule) {
            editingRuleId = rule.id;
            conditionsState = window.ruleBuilder.toEditorConditionState(rule.conditions);
            document.getElementById("rule-name").value = rule.name;
            document.getElementById("rule-priority").value = String(rule.priority);
            document.getElementById("rule-enabled").checked = rule.enabled;
            actionInput.value = rule.action;
            document.getElementById("rule-destination").value = rule.destinationUrl || "";
            frequencyEnabledInput.checked = rule.frequencyEnabled;
            document.getElementById("frequency-seconds").value = rule.frequencySeconds ?? "600";
            document.getElementById("frequency-mode").value = rule.frequencyMode || "cooldown";
            document.getElementById("fullscreen-mode").value = rule.fullscreenMode;
            document.getElementById("rule-editor-heading").textContent = "Edit rule";
            saveButton.textContent = "Save changes";
            setActionControls();
            setFrequencyControls();
        }
        clearMessage(document.getElementById("rule-form-error"));
        renderConditionTree();
        editor.hidden = false;
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("rule-name").focus();
    }

    async function loadRules() {
        rulesList.replaceChildren(makeElement("p", "panel empty-state", "Loading rules…"));
        clearMessage(rulesMessage);
        try {
            const result = await window.dashboardApi.request(
                `/api/projects/${encodeURIComponent(projectId)}/rules`,
            );
            if (!Array.isArray(result)) throw new Error("unexpected_response");
            rules = result;
            renderRules();
            return true;
        } catch (error) {
            rulesList.replaceChildren();
            if (error.status === 401) return false;
            setMessage(
                rulesMessage,
                error.name === "NetworkError"
                    ? "Could not connect to the server while loading rules."
                    : error.status === 404
                        ? "This project could not be found."
                        : "Could not load rules. Please try again.",
                true,
            );
            return false;
        }
    }

    async function deleteRule(rule) {
        if (!window.confirm(`Delete the rule "${rule.name}"?`)) return;
        clearMessage(rulesMessage);
        try {
            await window.dashboardApi.request(
                `/api/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(rule.id)}`,
                { method: "DELETE" },
            );
            if (editingRuleId === rule.id) {
                resetEditor();
                editor.hidden = true;
            }
            if (await loadRules()) setMessage(rulesMessage, "Rule deleted.");
        } catch (error) {
            if (error.status === 401) return;
            setMessage(
                rulesMessage,
                error.status === 404
                    ? "The project or rule no longer exists."
                    : error.name === "NetworkError"
                        ? "Could not connect to the server. The rule was not deleted."
                        : "Could not delete the rule. Please try again.",
                true,
            );
        }
    }

    function readFormPayload() {
        return window.ruleBuilder.buildRulePayload({
            name: document.getElementById("rule-name").value,
            priority: document.getElementById("rule-priority").value,
            enabled: document.getElementById("rule-enabled").checked,
            conditions: conditionsState,
            action: actionInput.value,
            destinationUrl: document.getElementById("rule-destination").value,
            frequencyEnabled: frequencyEnabledInput.checked,
            frequencySeconds: document.getElementById("frequency-seconds").value,
            frequencyMode: document.getElementById("frequency-mode").value,
            fullscreenMode: document.getElementById("fullscreen-mode").value,
        });
    }

    async function loadProject() {
        if (!projectId) {
            setMessage(projectStatusMessage, "A project ID is required.", true);
            return;
        }

        try {
            currentProject = await window.dashboardApi.request(
                `/api/projects/${encodeURIComponent(projectId)}`,
            );
            document.title = `${currentProject.name} · Visitor Routing`;
            document.getElementById("project-name").textContent = currentProject.name;
            document.getElementById("project-key").textContent = currentProject.projectKey;
            document.getElementById("project-id").textContent = currentProject.id;
            const status = document.getElementById("project-enabled");
            status.textContent = currentProject.enabled ? "Enabled" : "Disabled";
            status.classList.toggle("disabled", !currentProject.enabled);

            const origins = document.getElementById("project-origins");
            origins.replaceChildren();
            if (currentProject.allowedOrigins.length === 0) {
                origins.append(makeElement("li", "", "None"));
            } else {
                currentProject.allowedOrigins.forEach((origin) => {
                    origins.append(makeElement("li", "", origin));
                });
            }
            projectStatusMessage.hidden = true;
            projectContent.hidden = false;
            await loadRules();
        } catch (error) {
            if (error.status === 401) return;
            setMessage(
                projectStatusMessage,
                error.name === "NetworkError"
                    ? "Could not connect to the server. Check your connection and try again."
                    : error.status === 404
                        ? "This project could not be found."
                        : "Could not load this project. Please try again.",
                true,
            );
        }
    }

    document.getElementById("create-rule-button").addEventListener("click", () => openEditor(null));
    document.getElementById("cancel-rule-edit").addEventListener("click", () => {
        resetEditor();
        editor.hidden = true;
    });
    document.getElementById("cancel-rule-edit-bottom").addEventListener("click", () => {
        resetEditor();
        editor.hidden = true;
    });
    document.getElementById("add-condition").addEventListener("click", () => {
        if (conditionsState.conditions.length >= 50) {
            setMessage(document.getElementById("condition-error"), "A group can contain at most 50 conditions.", true);
            return;
        }
        conditionsState.conditions.push(window.ruleBuilder.createLeafCondition());
        renderConditionTree();
    });
    document.getElementById("add-condition-group").addEventListener("click", () => {
        if (conditionsState.conditions.length >= 50) {
            setMessage(document.getElementById("condition-error"), "A group can contain at most 50 conditions.", true);
            return;
        }
        conditionsState.conditions.push({
            operator: "AND",
            conditions: [window.ruleBuilder.createLeafCondition()],
        });
        renderConditionTree();
    });
    actionInput.addEventListener("change", setActionControls);
    frequencyEnabledInput.addEventListener("change", setFrequencyControls);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessage(document.getElementById("rule-form-error"));
        saveButton.disabled = true;
        saveButton.textContent = editingRuleId ? "Saving…" : "Creating…";
        try {
            const payload = readFormPayload();
            const editingId = editingRuleId;
            await window.dashboardApi.request(
                editingId
                    ? `/api/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(editingId)}`
                    : `/api/projects/${encodeURIComponent(projectId)}/rules`,
                { method: editingId ? "PATCH" : "POST", body: payload },
            );
            resetEditor();
            editor.hidden = true;
            if (await loadRules()) {
                setMessage(rulesMessage, editingId ? "Rule updated." : "Rule created.");
            }
        } catch (error) {
            if (error.status === 401) return;
            const fallback = error.status === 404
                ? "The project or rule no longer exists."
                : error.status === 409
                    ? "This rule conflicts with current server data. Refresh and try again."
                : error.name === "NetworkError"
                    ? "Could not connect to the server. The rule was not saved."
                    : error.status >= 500
                        ? "The server could not save the rule. Please try again."
                        : "Could not save the rule. Please try again.";
            document.getElementById("rule-form-error").textContent =
                window.dashboardApi.messageFor(error, fallback);
            document.getElementById("rule-form-error").hidden = false;
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = editingRuleId ? "Save changes" : "Save rule";
        }
    });

    setActionControls();
    setFrequencyControls();
    loadProject();
})();
