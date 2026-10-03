(function initializeDashboard() {
    const projectsList = document.getElementById("projects-list");
    const message = document.getElementById("dashboard-message");
    const createSection = document.getElementById("create-project-section");
    const createForm = document.getElementById("create-project-form");
    const createSubmit = document.getElementById("create-project-submit");
    const createError = document.getElementById("create-project-error");

    function showMessage(text, isError = false) {
        message.textContent = text;
        message.classList.toggle("error-message", isError);
        message.hidden = false;
    }

    function projectCard(project) {
        const card = document.createElement("article");
        card.className = "panel project-card";

        const details = document.createElement("div");
        const title = document.createElement("h2");
        title.textContent = project.name;
        const key = document.createElement("p");
        key.className = "project-key";
        key.textContent = `Key: ${project.projectKey}`;
        const summary = document.createElement("p");
        summary.className = "project-meta";
        summary.textContent = `Status: ${project.enabled ? "Enabled" : "Disabled"} · Allowed origins: ${project.allowedOrigins.length}`;
        details.append(title, key, summary);

        const open = document.createElement("a");
        open.className = "button-link";
        open.textContent = "Open";
        const destination = new URL("/dashboard/project.html", window.location.origin);
        destination.searchParams.set("id", project.id);
        open.href = `${destination.pathname}${destination.search}`;
        card.append(details, open);
        return card;
    }

    async function loadProjects() {
        projectsList.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "panel empty-state";
        loading.textContent = "Loading projects…";
        projectsList.append(loading);
        message.hidden = true;

        try {
            const projects = await window.dashboardApi.request("/api/projects");
            projectsList.replaceChildren();
            if (!Array.isArray(projects)) {
                throw new Error("unexpected_response");
            }
            if (projects.length === 0) {
                const empty = document.createElement("p");
                empty.className = "panel empty-state";
                empty.textContent = "No projects yet. Create a project to get started.";
                projectsList.append(empty);
                return true;
            }
            projects.forEach((project) => projectsList.append(projectCard(project)));
            return true;
        } catch (error) {
            projectsList.replaceChildren();
            if (error.status === 401) return false;
            showMessage(
                error.name === "NetworkError"
                    ? "Could not connect to the server. Check your connection and try again."
                    : "Could not load projects. Please try again.",
                true,
            );
            return false;
        }
    }

    document.getElementById("show-create-project").addEventListener("click", () => {
        createSection.hidden = false;
        document.getElementById("project-name").focus();
    });

    function closeCreateForm() {
        createSection.hidden = true;
        createForm.reset();
        document.getElementById("project-enabled").checked = true;
        createError.hidden = true;
    }

    document.getElementById("cancel-create-project").addEventListener("click", closeCreateForm);

    createForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        createError.hidden = true;
        createSubmit.disabled = true;
        createSubmit.textContent = "Creating…";

        const formData = new FormData(createForm);
        const project = {
            name: formData.get("name"),
            projectKey: formData.get("projectKey"),
            allowedOrigins: String(formData.get("allowedOrigins"))
                .split(/\r?\n/)
                .map((origin) => origin.trim())
                .filter(Boolean),
            enabled: document.getElementById("project-enabled").checked,
        };

        try {
            await window.dashboardApi.request("/api/projects", { method: "POST", body: project });
            closeCreateForm();
            if (await loadProjects()) {
                showMessage("Project created successfully.");
            } else {
                showMessage("Project was created, but the list could not be refreshed.", true);
            }
        } catch (error) {
            if (error.status === 401) return;
            createError.textContent = window.dashboardApi.messageFor(
                error,
                error.name === "NetworkError"
                    ? "Could not connect to the server. Your project may not have been created."
                    : "Could not create the project. Please try again.",
            );
            createError.hidden = false;
        } finally {
            createSubmit.disabled = false;
            createSubmit.textContent = "Create project";
        }
    });

    document.getElementById("logout-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await window.dashboardApi.request("/api/auth/logout", {
                method: "POST",
                redirectOnUnauthorized: false,
            });
        } catch {
            // Leave the page even if the session already expired or the server is unavailable.
        }
        window.location.assign("/login");
    });

    loadProjects();
})();
