(function exposeProjectManagement(root, factory) {
    const projectManagement = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = projectManagement;
    } else {
        root.projectManagement = projectManagement;
    }
})(typeof globalThis === "object" ? globalThis : this, function createProjectManagementModule() {
    function createProjectManagement({
        projectId,
        getProject,
        setProject,
        renderProject,
        dashboardApi,
        document,
        window,
    }) {
        const editor = document.getElementById("project-editor");
        const form = document.getElementById("project-edit-form");
        const nameInput = document.getElementById("project-edit-name");
        const keyInput = document.getElementById("project-edit-key");
        const originsInput = document.getElementById("project-edit-origins");
        const enabledInput = document.getElementById("project-edit-enabled");
        const editorMessage = document.getElementById("project-editor-message");
        const managementMessage = document.getElementById("project-management-message");
        const saveButton = document.getElementById("save-project-button");
        const deleteButton = document.getElementById("delete-project-button");
        let saving = false;
        let deleting = false;

        function clearMessage(target) {
            target.textContent = "";
            target.hidden = true;
            target.classList.toggle("error-message", false);
        }

        function showMessage(target, text, isError = false) {
            target.textContent = text;
            target.classList.toggle("error-message", isError);
            target.hidden = false;
        }

        function openEditor() {
            const project = getProject();
            if (!project) return;

            clearMessage(editorMessage);
            clearMessage(managementMessage);
            nameInput.value = project.name;
            keyInput.value = project.projectKey;
            originsInput.value = project.allowedOrigins.join("\n");
            enabledInput.value = project.enabled ? "true" : "false";
            editor.hidden = false;
            nameInput.focus();
        }

        function closeEditor() {
            if (saving) return;
            editor.hidden = true;
            clearMessage(editorMessage);
        }

        document.getElementById("edit-project-button").addEventListener("click", openEditor);
        document.getElementById("cancel-project-edit").addEventListener("click", closeEditor);

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (saving) return;

            saving = true;
            clearMessage(editorMessage);
            clearMessage(managementMessage);
            saveButton.disabled = true;
            saveButton.textContent = "Saving…";

            const updates = {
                name: nameInput.value,
                allowedOrigins: originsInput.value
                    .split(/\r?\n/)
                    .map((origin) => origin.trim())
                    .filter(Boolean),
                enabled: enabledInput.value === "true",
            };

            try {
                const project = await dashboardApi.request(
                    `/api/projects/${encodeURIComponent(projectId)}`,
                    { method: "PATCH", body: updates },
                );
                setProject(project);
                renderProject(project);
                editor.hidden = true;
                showMessage(managementMessage, "Project updated successfully.");
            } catch (error) {
                if (error.status === 401) return;
                const fallback = error.status === 404
                    ? "This project could not be found."
                    : error.name === "NetworkError"
                        ? "Could not connect to the server. The project was not updated."
                        : error.status >= 500
                            ? "The server could not update the project. Please try again."
                            : "Could not update the project. Check the name and allowed origins.";
                showMessage(editorMessage, dashboardApi.messageFor(error, fallback), true);
            } finally {
                saving = false;
                saveButton.disabled = false;
                saveButton.textContent = "Save Changes";
            }
        });

        deleteButton.addEventListener("click", async () => {
            if (deleting) return;
            const project = getProject();
            if (!project) return;

            const confirmed = window.confirm(
                `Delete "${project.name}"? Deleting this project also permanently removes its associated rules and events. This cannot be undone.`,
            );
            if (!confirmed) return;

            deleting = true;
            clearMessage(managementMessage);
            deleteButton.disabled = true;
            deleteButton.textContent = "Deleting…";
            try {
                await dashboardApi.request(
                    `/api/projects/${encodeURIComponent(projectId)}`,
                    { method: "DELETE" },
                );
                window.location.assign("/dashboard");
            } catch (error) {
                if (error.status === 401) return;
                showMessage(
                    managementMessage,
                    error.status === 404
                        ? "This project could not be found or has already been deleted."
                        : error.name === "NetworkError"
                            ? "Could not connect to the server. The project was not deleted."
                            : "The server could not delete the project. Please try again.",
                    true,
                );
            } finally {
                deleting = false;
                deleteButton.disabled = false;
                deleteButton.textContent = "Delete Project";
            }
        });
    }

    return { createProjectManagement };
});
