(function exposeDashboardApi() {
    class ApiError extends Error {
        constructor(status, data) {
            super(data && typeof data.error === "string" ? data.error : "request_failed");
            this.name = "ApiError";
            this.status = status;
            this.data = data;
        }
    }

    async function request(path, { method = "GET", body, redirectOnUnauthorized = true } = {}) {
        let response;
        try {
            response = await fetch(path, {
                method,
                credentials: "same-origin",
                headers: body === undefined ? {} : { "Content-Type": "application/json" },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
        } catch {
            const error = new Error("network_error");
            error.name = "NetworkError";
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        let data = null;
        if (contentType.includes("application/json")) {
            try {
                data = await response.json();
            } catch {
                data = null;
            }
        }

        if (response.status === 401 && redirectOnUnauthorized) {
            window.location.assign("/login");
        }
        if (!response.ok) {
            throw new ApiError(response.status, data);
        }
        return data;
    }

    function messageFor(error, fallback) {
        if (error instanceof ApiError && error.status === 409) {
            return "That project key is already in use. Choose a different key.";
        }
        if (error instanceof ApiError && error.status === 400) {
            const details = Array.isArray(error.data?.details) ? error.data.details : [];
            const messages = details
                .map((detail) => detail && typeof detail.message === "string" ? detail.message : "")
                .filter(Boolean);
            if (messages.length > 0) return messages.join(" ");
            return "Please check the information and try again.";
        }
        return fallback;
    }

    window.dashboardApi = { ApiError, messageFor, request };
})();
