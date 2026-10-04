(function initializeLogin() {
    const form = document.getElementById("login-form");
    const submit = document.getElementById("login-submit");
    const errorMessage = document.getElementById("login-error");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorMessage.hidden = true;
        submit.disabled = true;
        submit.textContent = "Signing in…";

        const formData = new FormData(form);
        try {
            await window.dashboardApi.request("/api/auth/login", {
                method: "POST",
                redirectOnUnauthorized: false,
                body: {
                    username: formData.get("username"),
                    password: formData.get("password"),
                },
            });
            window.location.assign("/dashboard");
        } catch {
            errorMessage.textContent = "Sign in failed. Check your username and password, then try again.";
            errorMessage.hidden = false;
        } finally {
            submit.disabled = false;
            submit.textContent = "Sign in";
        }
    });
})();
