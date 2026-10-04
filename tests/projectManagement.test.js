import { describe, expect, it, vi } from "vitest";

const { createProjectManagement } = require("../public/js/project-management.js");

const projectId = "8e5efb54-49f0-4ce4-b224-90f8365d8e20";

function createElement() {
    const listeners = new Map();
    return {
        value: "",
        textContent: "",
        hidden: true,
        disabled: false,
        classList: { toggle: vi.fn() },
        addEventListener: vi.fn((eventName, listener) => listeners.set(eventName, listener)),
        focus: vi.fn(),
        fire: async (eventName, event = {}) => listeners.get(eventName)?.(event),
    };
}

function createHarness({
    project = {
        id: projectId,
        name: "Test Project",
        projectKey: "test-project",
        allowedOrigins: ["https://example.com"],
        enabled: true,
    },
    request = vi.fn(),
    confirm = vi.fn().mockReturnValue(true),
} = {}) {
    const ids = [
        "project-editor",
        "project-edit-form",
        "project-edit-name",
        "project-edit-key",
        "project-edit-origins",
        "project-edit-enabled",
        "project-editor-message",
        "project-management-message",
        "save-project-button",
        "delete-project-button",
        "edit-project-button",
        "cancel-project-edit",
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, createElement()]));
    elements["save-project-button"].textContent = "Save Changes";
    elements["delete-project-button"].textContent = "Delete Project";
    let currentProject = project;
    const setProject = vi.fn((updatedProject) => { currentProject = updatedProject; });
    const renderProject = vi.fn();
    const dashboardApi = {
        request,
        messageFor: vi.fn((_error, fallback) => fallback),
    };
    const window = {
        confirm,
        location: { assign: vi.fn() },
    };

    createProjectManagement({
        projectId,
        getProject: () => currentProject,
        setProject,
        renderProject,
        dashboardApi,
        document: { getElementById: (id) => elements[id] },
        window,
    });

    return { elements, setProject, renderProject, dashboardApi, window, getProject: () => currentProject };
}

describe("project management UI", () => {
    it("loads the current project values into the editor and keeps its key read-only", async () => {
        const harness = createHarness();

        await harness.elements["edit-project-button"].fire("click");

        expect(harness.elements["project-editor"].hidden).toBe(false);
        expect(harness.elements["project-edit-name"].value).toBe("Test Project");
        expect(harness.elements["project-edit-key"].value).toBe("test-project");
        expect(harness.elements["project-edit-origins"].value).toBe("https://example.com");
        expect(harness.elements["project-edit-enabled"].value).toBe("true");
        expect(harness.elements["project-edit-name"].focus).toHaveBeenCalled();
    });

    it("saves project name, allowed origins, and enabled state without sending a project key", async () => {
        const updatedProject = {
            id: projectId,
            name: "Updated Project",
            projectKey: "test-project",
            allowedOrigins: ["https://new.example", "http://localhost:5500"],
            enabled: false,
        };
        const request = vi.fn().mockResolvedValue(updatedProject);
        const harness = createHarness({ request });
        await harness.elements["edit-project-button"].fire("click");
        harness.elements["project-edit-name"].value = "Updated Project";
        harness.elements["project-edit-origins"].value = "https://new.example\n\n http://localhost:5500 ";
        harness.elements["project-edit-enabled"].value = "false";

        const event = { preventDefault: vi.fn() };
        await harness.elements["project-edit-form"].fire("submit", event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(request).toHaveBeenCalledWith(`/api/projects/${projectId}`, {
            method: "PATCH",
            body: {
                name: "Updated Project",
                allowedOrigins: ["https://new.example", "http://localhost:5500"],
                enabled: false,
            },
        });
        expect(request.mock.calls[0][1].body).not.toHaveProperty("projectKey");
        expect(harness.setProject).toHaveBeenCalledWith(updatedProject);
        expect(harness.getProject()).toEqual(updatedProject);
        expect(harness.renderProject).toHaveBeenCalledWith(updatedProject);
        expect(harness.elements["project-editor"].hidden).toBe(true);
        expect(harness.elements["project-management-message"].textContent).toBe("Project updated successfully.");
    });

    it("shows backend validation errors and leaves the editor available", async () => {
        const request = vi.fn().mockRejectedValue(Object.assign(new Error("validation_error"), { status: 400 }));
        const harness = createHarness({ request });
        await harness.elements["edit-project-button"].fire("click");

        await harness.elements["project-edit-form"].fire("submit", { preventDefault: vi.fn() });

        expect(harness.elements["project-editor"].hidden).toBe(false);
        expect(harness.elements["project-editor-message"].hidden).toBe(false);
        expect(harness.elements["project-editor-message"].textContent)
            .toContain("Check the name and allowed origins");
        expect(harness.setProject).not.toHaveBeenCalled();
    });

    it("uses the shared API helper's login redirect for an expired edit session", async () => {
        const harness = createHarness({
            request: vi.fn(async () => {
                harness.window.location.assign("/login");
                throw Object.assign(new Error("unauthorized"), { status: 401 });
            }),
        });
        await harness.elements["edit-project-button"].fire("click");

        await harness.elements["project-edit-form"].fire("submit", { preventDefault: vi.fn() });

        expect(harness.window.location.assign).toHaveBeenCalledWith("/login");
        expect(harness.setProject).not.toHaveBeenCalled();
    });

    it("prevents duplicate saves while the PATCH request is pending", async () => {
        let resolveRequest;
        const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
        const harness = createHarness({ request });
        await harness.elements["edit-project-button"].fire("click");

        const firstSubmission = harness.elements["project-edit-form"].fire("submit", {
            preventDefault: vi.fn(),
        });
        await harness.elements["project-edit-form"].fire("submit", { preventDefault: vi.fn() });

        expect(request).toHaveBeenCalledTimes(1);
        expect(harness.elements["save-project-button"].disabled).toBe(true);
        expect(harness.elements["save-project-button"].textContent).toBe("Saving…");
        resolveRequest(harness.getProject());
        await firstSubmission;
        expect(harness.elements["save-project-button"].disabled).toBe(false);
    });

    it("requires explicit confirmation and explains associated data deletion", async () => {
        const request = vi.fn();
        const confirm = vi.fn().mockReturnValue(false);
        const harness = createHarness({ request, confirm });

        await harness.elements["delete-project-button"].fire("click");

        expect(confirm).toHaveBeenCalledWith(expect.stringContaining("associated rules and events"));
        expect(request).not.toHaveBeenCalled();
        expect(harness.window.location.assign).not.toHaveBeenCalled();
    });

    it("deletes the project once and navigates to the dashboard", async () => {
        const request = vi.fn().mockResolvedValue({ deleted: true });
        const harness = createHarness({ request });

        await harness.elements["delete-project-button"].fire("click");

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(`/api/projects/${projectId}`, { method: "DELETE" });
        expect(harness.window.location.assign).toHaveBeenCalledWith("/dashboard");
    });

    it("keeps the project page and reports delete failures without retrying", async () => {
        const request = vi.fn().mockRejectedValue(Object.assign(new Error("not_found"), { status: 404 }));
        const harness = createHarness({ request });

        await harness.elements["delete-project-button"].fire("click");

        expect(request).toHaveBeenCalledTimes(1);
        expect(harness.window.location.assign).not.toHaveBeenCalled();
        expect(harness.elements["project-management-message"].textContent)
            .toContain("could not be found or has already been deleted");
    });

    it("uses the shared API helper's login redirect for an expired delete session", async () => {
        const harness = createHarness({
            request: vi.fn(async () => {
                harness.window.location.assign("/login");
                throw Object.assign(new Error("unauthorized"), { status: 401 });
            }),
        });

        await harness.elements["delete-project-button"].fire("click");

        expect(harness.window.location.assign).toHaveBeenCalledWith("/login");
        expect(harness.elements["project-management-message"].hidden).toBe(true);
    });
});
