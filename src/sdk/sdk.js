(function attachVisitorRouting(global) {
    "use strict";

    var initializationPromise = null;
    var popupFallbackHandler = null;
    var sdkOrigin = null;

    try {
        var currentScript = global.document && global.document.currentScript;
        if (currentScript && typeof currentScript.src === "string" && currentScript.src.trim()) {
            var scriptUrl = new global.URL(currentScript.src);
            if (
                (scriptUrl.protocol === "http:" || scriptUrl.protocol === "https:") &&
                scriptUrl.origin !== "null"
            ) {
                sdkOrigin = scriptUrl.origin;
            }
        }
    } catch (_error) {
        sdkOrigin = null;
    }

    function detectBrowser(userAgent) {
        var agent = userAgent.toLowerCase();

        if (/samsungbrowser/.test(agent)) return "Samsung Internet";
        if (/edg\//.test(agent)) return "Edge";
        if (/(opr\/|opera)/.test(agent)) return "Opera";
        if (/(firefox|fxios)\//.test(agent)) return "Firefox";
        if (/(chrome|crios)\//.test(agent)) return "Chrome";
        if (/safari\//.test(agent)) return "Safari";
        return "Other";
    }

    function detectOperatingSystem(userAgent, navigatorObject) {
        var agent = userAgent.toLowerCase();

        if (/android/.test(agent)) return "Android";
        if (/(iphone|ipad|ipod)/.test(agent)) return "iOS";
        if (/macintosh/.test(agent) && Number(navigatorObject.maxTouchPoints) > 1) return "iOS";
        if (/windows/.test(agent)) return "Windows";
        if (/(macintosh|mac os x)/.test(agent)) return "macOS";
        if (/linux/.test(agent)) return "Linux";
        return "Other";
    }

    function detectDeviceType(userAgent, navigatorObject) {
        var agent = userAgent.toLowerCase();

        if (/(ipad|tablet)/.test(agent)) return "tablet";
        if (/android/.test(agent)) return /mobile/.test(agent) ? "mobile" : "tablet";
        if (/(iphone|ipod|mobile)/.test(agent)) return "mobile";
        if (/windows|macintosh|mac os x|linux/.test(agent)) {
            if (/macintosh/.test(agent) && Number(navigatorObject.maxTouchPoints) > 1) return "tablet";
            return "desktop";
        }
        return "other";
    }

    function collectClientInfo() {
        var navigatorObject = global.navigator || {};
        var userAgent = typeof navigatorObject.userAgent === "string" ? navigatorObject.userAgent : "";
        var payload = {
            browser: detectBrowser(userAgent),
            os: detectOperatingSystem(userAgent, navigatorObject),
            deviceType: detectDeviceType(userAgent, navigatorObject),
            language: typeof navigatorObject.language === "string" && navigatorObject.language.trim()
                ? navigatorObject.language.trim()
                : undefined,
            timezone: undefined,
            screen: {},
        };

        try {
            var timezone = global.Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (typeof timezone === "string" && timezone.trim()) {
                payload.timezone = timezone;
            }
        } catch (_error) {
            // The timezone is optional when Intl or the host timezone is unavailable.
        }

        var screenObject = global.screen;
        if (screenObject) {
            if (typeof screenObject.width === "number" && Number.isFinite(screenObject.width) && screenObject.width > 0) {
                payload.screen.width = screenObject.width;
            }
            if (typeof screenObject.height === "number" && Number.isFinite(screenObject.height) && screenObject.height > 0) {
                payload.screen.height = screenObject.height;
            }
        }

        return payload;
    }

    function getEvaluationUrl(projectKey) {
        if (
            typeof projectKey !== "string" ||
            projectKey.length === 0 ||
            projectKey.length > 200 ||
            typeof sdkOrigin !== "string" ||
            !sdkOrigin ||
            typeof global.URL !== "function"
        ) {
            return null;
        }

        try {
            var url = new global.URL("/api/v1/evaluate", sdkOrigin);
            url.searchParams.set("projectKey", projectKey);
            return url.toString();
        } catch (_error) {
            return null;
        }
    }

    function validateHttpUrl(value) {
        if (typeof value !== "string" || !value.trim() || typeof global.URL !== "function") {
            return null;
        }

        try {
            var url = new global.URL(value.trim());
            if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
                return null;
            }
            return url.toString();
        } catch (_error) {
            return null;
        }
    }

    function prepareDestination(value, fullscreenMode) {
        var destinationUrl = validateHttpUrl(value);
        if (!destinationUrl || fullscreenMode !== "prompt") {
            return destinationUrl;
        }

        try {
            var url = new global.URL(destinationUrl);
            url.searchParams.set("_fs", "1");
            return url.toString();
        } catch (_error) {
            return null;
        }
    }

    function fullscreenRequestMethod(element, documentObject) {
        if (!element) {
            return null;
        }

        if (
            (documentObject.fullscreenEnabled === false && documentObject.webkitFullscreenEnabled !== true) ||
            (documentObject.webkitFullscreenEnabled === false && documentObject.fullscreenEnabled !== true)
        ) {
            return null;
        }

        if (typeof element.requestFullscreen === "function") {
            return element.requestFullscreen;
        }
        if (typeof element.webkitRequestFullscreen === "function") {
            return element.webkitRequestFullscreen;
        }
        if (typeof element.webkitRequestFullScreen === "function") {
            return element.webkitRequestFullScreen;
        }
        return null;
    }

    function showFullscreenPrompt() {
        try {
            var documentObject = global.document;
            if (!documentObject || global.__visitorRoutingFullscreenPrompt === true) {
                return;
            }

            var locationHref = global.location && global.location.href;
            if (typeof locationHref !== "string" || typeof global.URL !== "function") {
                return;
            }

            var currentUrl = new global.URL(locationHref);
            if (currentUrl.searchParams.get("_fs") !== "1") {
                return;
            }

            var fullscreenTarget = documentObject.documentElement;
            var requestFullscreen = fullscreenRequestMethod(fullscreenTarget, documentObject);
            if (!requestFullscreen) {
                return;
            }

            var container = documentObject.createElement("div");
            var message = documentObject.createElement("p");
            var actions = documentObject.createElement("div");
            var viewButton = documentObject.createElement("button");
            var dismissButton = documentObject.createElement("button");
            var parent = documentObject.body || documentObject.documentElement;
            if (!parent || typeof parent.appendChild !== "function") {
                return;
            }

            container.setAttribute("role", "group");
            container.setAttribute("aria-label", "Fullscreen option");
            container.style.position = "fixed";
            container.style.right = "1rem";
            container.style.bottom = "1rem";
            container.style.zIndex = "2147483647";
            container.style.maxWidth = "20rem";
            container.style.padding = "1rem";
            container.style.borderRadius = "0.5rem";
            container.style.background = "#ffffff";
            container.style.color = "#111827";
            container.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
            container.style.font = "14px/1.4 system-ui, sans-serif";
            message.textContent = "View this page in full screen?";
            message.style.margin = "0 0 0.75rem";
            actions.style.display = "flex";
            actions.style.justifyContent = "flex-end";
            actions.style.gap = "0.5rem";
            viewButton.type = "button";
            viewButton.textContent = "View full screen";
            dismissButton.type = "button";
            dismissButton.textContent = "Not now";
            actions.appendChild(dismissButton);
            actions.appendChild(viewButton);
            container.appendChild(message);
            container.appendChild(actions);

            function dismissPrompt() {
                try {
                    if (typeof container.remove === "function") {
                        container.remove();
                    } else if (container.parentNode && typeof container.parentNode.removeChild === "function") {
                        container.parentNode.removeChild(container);
                    }
                } catch (_error) {
                    // Prompt cleanup must not affect the host page.
                }
            }

            dismissButton.addEventListener("click", dismissPrompt);
            viewButton.addEventListener("click", function requestFullscreenFromGesture() {
                try {
                    var result = requestFullscreen.call(fullscreenTarget);
                    global.Promise.resolve(result).then(dismissPrompt, dismissPrompt);
                } catch (_error) {
                    dismissPrompt();
                }
            });
            parent.appendChild(container);
            global.__visitorRoutingFullscreenPrompt = true;
        } catch (_error) {
            // Fullscreen prompting is optional and must not affect the host page.
        }
    }

    function normalizeDecision(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }

        var actions = ["redirect", "open_new_tab", "none"];
        var fullscreenModes = ["off", "prompt"];
        var action = "none";
        var destinationUrl = null;

        if (value.matched === true && actions.indexOf(value.action) >= 0 && value.action !== "none") {
            destinationUrl = validateHttpUrl(value.destinationUrl);
            if (destinationUrl) {
                action = value.action;
            }
        }

        return {
            matched: value.matched === true,
            ruleId: typeof value.ruleId === "string" ? value.ruleId : null,
            action: action,
            destinationUrl: destinationUrl,
            fullscreenMode: fullscreenModes.indexOf(value.fullscreenMode) >= 0 ? value.fullscreenMode : "off",
            reason: typeof value.reason === "string" ? value.reason : "no_match",
        };
    }

    function handleRedirect(value, fullscreenMode) {
        var destinationUrl = prepareDestination(value, fullscreenMode);
        if (!destinationUrl) {
            return;
        }

        try {
            if (global.location && typeof global.location.replace === "function") {
                global.location.replace(destinationUrl);
            }
        } catch (_error) {
            // Navigation failures must not escape into the host page.
        }
    }

    function removePopupFallback() {
        var handler = popupFallbackHandler;
        popupFallbackHandler = null;

        if (handler && global.document && typeof global.document.removeEventListener === "function") {
            try {
                global.document.removeEventListener("click", handler, false);
            } catch (_error) {
                // Listener cleanup is best-effort in restricted browser contexts.
            }
        }
    }

    function handleOpenNewTab(value, fullscreenMode) {
        var destinationUrl = prepareDestination(value, fullscreenMode);
        if (!destinationUrl || typeof global.open !== "function") {
            return;
        }

        removePopupFallback();

        var opened = null;
        try {
            opened = global.open(destinationUrl, "_blank", "noopener,noreferrer");
        } catch (_error) {
            opened = null;
        }

        if (opened) {
            return;
        }

        var documentObject = global.document;
        if (!documentObject || typeof documentObject.addEventListener !== "function") {
            return;
        }

        var handler = function retryAfterClick() {
            removePopupFallback();
            try {
                global.open(destinationUrl, "_blank", "noopener,noreferrer");
            } catch (_error) {
                // A blocked or failed retry is intentionally not repeated.
            }
        };

        popupFallbackHandler = handler;
        try {
            documentObject.addEventListener("click", handler, { once: true });
        } catch (_error) {
            removePopupFallback();
        }
    }

    function handleDecision(decision) {
        try {
            if (!decision || decision.matched !== true) {
                return;
            }

            if (decision.action === "redirect") {
                handleRedirect(decision.destinationUrl, decision.fullscreenMode);
            } else if (decision.action === "open_new_tab") {
                handleOpenNewTab(decision.destinationUrl, decision.fullscreenMode);
            }
        } catch (_error) {
            // SDK actions are isolated from the customer page.
        }
    }

    function init(options) {
        if (initializationPromise) {
            return initializationPromise;
        }

        try {
            showFullscreenPrompt();
            var projectKey = options && typeof options.projectKey === "string"
                ? options.projectKey.trim()
                : "";
            if (!projectKey || projectKey.length > 200 || typeof global.fetch !== "function") {
                return Promise.resolve(null);
            }

            initializationPromise = Promise.resolve().then(function sendEvaluation() {
                var url = getEvaluationUrl(projectKey);
                if (!url) {
                    return null;
                }

                return global.fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "omit",
                    body: JSON.stringify(collectClientInfo()),
                }).then(function handleResponse(response) {
                    if (!response || response.ok !== true || typeof response.json !== "function") {
                        return null;
                    }

                    return response.json().then(function processDecision(value) {
                        var decision = normalizeDecision(value);
                        handleDecision(decision);
                        return decision;
                    });
                });
            }).catch(function handleFailure() {
                return null;
            });

            return initializationPromise;
        } catch (_error) {
            return Promise.resolve(null);
        }
    }

    try {
        global.VisitorRouting = { init: init };
    } catch (_error) {
        // Do not interfere with the host page if the global cannot be assigned.
    }
})(typeof window !== "undefined" ? window : globalThis);