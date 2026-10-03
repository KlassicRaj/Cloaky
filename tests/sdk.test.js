import { describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const request = require("supertest");
const env = require("../src/config/env");
const { createApp } = require("../src/server");

const sdkSource = fs.readFileSync(path.resolve(__dirname, "../src/sdk/sdk.js"), "utf8");

function createBrowser({
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    language = "en-US",
    timezone = "America/New_York",
    screen = { width: 1440, height: 900 },
    fetchImplementation,
    scriptUrl = "https://api.example.test/sdk.js",
    navigatorOverrides = {},
    responseDecision = {
        matched: true,
        ruleId: "rule-1",
        action: "none",
        destinationUrl: null,
        fullscreenMode: "off",
        reason: "rule_matched",
    },
    openImplementation = () => ({}),
    urlConstructor = URL,
    documentOverrides = {},
} = {}) {
    const fetch = vi.fn(fetchImplementation || (() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responseDecision),
    })));
    const location = {
        href: "https://customer.example.test/page",
        replace: vi.fn(),
    };
    const open = vi.fn(openImplementation);
    const document = {
        currentScript: { src: scriptUrl },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ...documentOverrides,
    };
    const window = {
        navigator: { userAgent, language, maxTouchPoints: 0, ...navigatorOverrides },
        screen,
        document,
        location,
        open,
        fetch,
        URL: urlConstructor,
        Intl: {
            DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: timezone }) }),
        },
    };

    vm.runInNewContext(sdkSource, vm.createContext({ window }));
    return { window, fetch, location, open, document };
}

async function fetchBody(browser, projectKey = "public-key") {
    await browser.window.VisitorRouting.init({ projectKey });
    const options = browser.fetch.mock.calls[0]?.[1];
    return options ? JSON.parse(options.body) : null;
}

function allowAllRateLimit(req, res, next) {
    return next();
}

function createSdkRouteApp() {
    return createApp({
        evaluationService: { evaluate: vi.fn() },
        projectRepository: { findByProjectKey: vi.fn() },
        rateLimitMiddleware: allowAllRateLimit,
    });
}

describe("browser SDK", () => {
    it("initializes with a project key and returns a normalized decision", async () => {
        const browser = createBrowser();

        await expect(browser.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toEqual({
            matched: true,
            ruleId: "rule-1",
            action: "none",
            destinationUrl: null,
            fullscreenMode: "off",
            reason: "rule_matched",
        });
    });

    it("handles a missing or blank project key without fetching", async () => {
        const browser = createBrowser();

        await expect(browser.window.VisitorRouting.init()).resolves.toBeNull();
        await expect(browser.window.VisitorRouting.init({ projectKey: "  " })).resolves.toBeNull();
        expect(browser.fetch).not.toHaveBeenCalled();
    });

    it("performs initialization only once", async () => {
        const browser = createBrowser();
        const first = browser.window.VisitorRouting.init({ projectKey: "public-key" });
        const second = browser.window.VisitorRouting.init({ projectKey: "another-key" });

        expect(second).toBe(first);
        await first;
        expect(browser.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["Edge", "Mozilla/5.0 Windows NT 10.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"],
        ["Opera", "Mozilla/5.0 Windows NT 10.0 OPR/105.0.0.0"],
        ["Samsung Internet", "Mozilla/5.0 Android 13 SamsungBrowser/22.0 Chrome/110.0.0.0"],
        ["Other", "UnrecognizedAgent/1.0"],
    ])("detects browser %s", async (expected, userAgent) => {
        const browser = createBrowser({ userAgent });
        expect((await fetchBody(browser)).browser).toBe(expected);
    });

    it.each([
        ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
        ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
        ["Linux", "Mozilla/5.0 (X11; Ubuntu; Linux x86_64)"],
        ["Android", "Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile"],
        ["iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"],
        ["Other", "UnrecognizedAgent/1.0"],
    ])("detects operating system %s", async (expected, userAgent) => {
        const browser = createBrowser({ userAgent });
        expect((await fetchBody(browser)).os).toBe(expected);
    });

    it.each([
        ["desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
        ["mobile", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"],
        ["tablet", "Mozilla/5.0 (Linux; Android 13; Pixel Tablet)"],
        ["other", "UnrecognizedAgent/1.0"],
    ])("detects device type %s", async (expected, userAgent) => {
        const browser = createBrowser({ userAgent });
        expect((await fetchBody(browser)).deviceType).toBe(expected);
    });

    it("collects language, timezone, and screen dimensions", async () => {
        const browser = createBrowser({
            language: "en-IN",
            timezone: "Asia/Kolkata",
            screen: { width: 1280, height: 720 },
        });

        expect(await fetchBody(browser)).toMatchObject({
            language: "en-IN",
            timezone: "Asia/Kolkata",
            screen: { width: 1280, height: 720 },
        });
    });

    it("sends the expected POST payload to the SDK host with projectKey in the query", async () => {
        const browser = createBrowser();
        await browser.window.VisitorRouting.init({ projectKey: "key with spaces" });

        const [url, options] = browser.fetch.mock.calls[0];
        const parsedUrl = new URL(url);
        const payload = JSON.parse(options.body);

        expect(parsedUrl.origin).toBe("https://api.example.test");
        expect(parsedUrl.pathname).toBe("/api/v1/evaluate");
        expect(parsedUrl.searchParams.get("projectKey")).toBe("key with spaces");
        expect(options.method).toBe("POST");
        expect(options.headers).toEqual({ "Content-Type": "application/json" });
        expect(options.credentials).toBe("omit");
        expect(payload).toEqual({
            browser: "Chrome",
            os: "Windows",
            deviceType: "desktop",
            language: "en-US",
            timezone: "America/New_York",
            screen: { width: 1440, height: 900 },
        });
    });

    it("does not send IP, GeoIP fields, or visitor identity", async () => {
        const browser = createBrowser();
        const payload = await fetchBody(browser);

        for (const forbiddenField of ["ip", "country", "region", "city", "visitorId", "ipHash"]) {
            expect(payload).not.toHaveProperty(forbiddenField);
        }
    });

    it.each([400, 500])("handles API status %s without throwing", async (status) => {
        const browser = createBrowser({
            fetchImplementation: () => Promise.resolve({ ok: false, status }),
        });

        await expect(browser.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();
    });

    it("handles a network failure without throwing", async () => {
        const browser = createBrowser({
            fetchImplementation: () => Promise.reject(new Error("network unavailable")),
        });

        await expect(browser.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();
    });

    it("handles malformed JSON and unexpected response shapes", async () => {
        const malformedJson = createBrowser({
            fetchImplementation: () => Promise.resolve({
                ok: true,
                json: () => Promise.reject(new Error("invalid json")),
            }),
        });
        const unexpectedShape = createBrowser({
            fetchImplementation: () => Promise.resolve({ ok: true, json: () => Promise.resolve(["unexpected"]) }),
        });

        await expect(malformedJson.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();
        await expect(unexpectedShape.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();
    });

    it("handles missing browser APIs and collection failures safely", async () => {
        const missingFetch = createBrowser({ fetchImplementation: undefined });
        missingFetch.window.fetch = undefined;
        await expect(missingFetch.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();

        const brokenNavigator = createBrowser();
        Object.defineProperty(brokenNavigator.window.navigator, "userAgent", {
            get() { throw new Error("browser API unavailable"); },
        });
        await expect(brokenNavigator.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toBeNull();
    });

    it("does nothing for a none action", async () => {
        const browser = createBrowser({
            responseDecision: {
                matched: true,
                action: "none",
                destinationUrl: "https://example.test/unused",
            },
        });

        await browser.window.VisitorRouting.init({ projectKey: "public-key" });

        expect(browser.location.replace).not.toHaveBeenCalled();
        expect(browser.open).not.toHaveBeenCalled();
        expect(browser.document.addEventListener).not.toHaveBeenCalled();
    });

    it.each(["https://safe.example/path", "http://safe.example/path"])(
        "redirects to valid URL %s using location.replace",
        async (destinationUrl) => {
            const browser = createBrowser({
                responseDecision: { matched: true, action: "redirect", destinationUrl },
            });

            await browser.window.VisitorRouting.init({ projectKey: "public-key" });

            expect(browser.location.replace).toHaveBeenCalledWith(destinationUrl);
            expect(browser.open).not.toHaveBeenCalled();
        },
    );

    it.each([
        ["missing URL", undefined],
        ["javascript URL", "javascript:alert(1)"],
        ["data URL", "data:text/html,unsafe"],
        ["vbscript URL", "vbscript:alert(1)"],
        ["file URL", "file:///etc/passwd"],
        ["blob URL", "blob:https://safe.example/resource"],
        ["about URL", "about:blank"],
        ["relative URL", "/relative/path"],
        ["malformed URL", "http://["],
    ])("does not redirect to %s", async (_label, destinationUrl) => {
        const browser = createBrowser({
            responseDecision: { matched: true, action: "redirect", destinationUrl },
        });

        await expect(browser.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toMatchObject({
            action: "none",
            destinationUrl: null,
        });
        expect(browser.location.replace).not.toHaveBeenCalled();
    });

    it("opens a valid new-tab destination with noopener and noreferrer", async () => {
        const destinationUrl = "https://safe.example/tab";
        const browser = createBrowser({
            responseDecision: { matched: true, action: "open_new_tab", destinationUrl },
        });

        await browser.window.VisitorRouting.init({ projectKey: "public-key" });

        expect(browser.open).toHaveBeenCalledWith(destinationUrl, "_blank", "noopener,noreferrer");
        expect(browser.document.addEventListener).not.toHaveBeenCalled();
    });

    it("retries a blocked popup once on click and removes the listener", async () => {
        const destinationUrl = "https://safe.example/tab";
        const openImplementation = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce({});
        const browser = createBrowser({
            responseDecision: { matched: true, action: "open_new_tab", destinationUrl },
            openImplementation,
        });

        await browser.window.VisitorRouting.init({ projectKey: "public-key" });

        expect(openImplementation).toHaveBeenCalledTimes(1);
        expect(browser.document.addEventListener).toHaveBeenCalledTimes(1);
        const [eventName, handler, options] = browser.document.addEventListener.mock.calls[0];
        expect(eventName).toBe("click");
        expect(options).toEqual({ once: true });

        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);

        expect(openImplementation).toHaveBeenCalledTimes(2);
        expect(openImplementation).toHaveBeenLastCalledWith(destinationUrl, "_blank", "noopener,noreferrer");
        expect(browser.document.removeEventListener).toHaveBeenCalledWith("click", handler, false);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it("does not throw when window.open throws", async () => {
        const browser = createBrowser({
            responseDecision: { matched: true, action: "open_new_tab", destinationUrl: "https://safe.example" },
            openImplementation: () => { throw new Error("popup unavailable"); },
        });

        await expect(browser.window.VisitorRouting.init({ projectKey: "public-key" })).resolves.toMatchObject({
            action: "open_new_tab",
        });
        expect(browser.document.addEventListener).toHaveBeenCalledTimes(1);
    });

    it.each([
        [null, null],
        [undefined, null],
        ["bad decision", null],
        [[], null],
        [{ matched: true, action: "unknown" }, "none"],
        [{ matched: true }, "none"],
    ])("safely handles malformed or non-actionable decision %s", async (responseDecision, expectedAction) => {
            const browser = createBrowser({
                responseDecision,
                fetchImplementation: () => Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(responseDecision),
                }),
            });

            const result = await browser.window.VisitorRouting.init({ projectKey: "public-key" });
            if (expectedAction === null) {
                expect(result).toBeNull();
            } else {
                expect(result).toMatchObject({ action: expectedAction, destinationUrl: null });
            }
            expect(browser.location.replace).not.toHaveBeenCalled();
            expect(browser.open).not.toHaveBeenCalled();
        });

    it("contains URL parser and popup-listener setup failures", async () => {
        function ThrowForDestinationURL(value, base) {
            if (value === "https://throws.example/") {
                throw new Error("URL parser failed");
            }
            return new URL(value, base);
        }

        const parserFailure = createBrowser({
            responseDecision: {
                matched: true,
                action: "redirect",
                destinationUrl: "https://throws.example/",
            },
            urlConstructor: ThrowForDestinationURL,
        });
        await expect(parserFailure.window.VisitorRouting.init({ projectKey: "public-key" }))
            .resolves.toMatchObject({ action: "none", destinationUrl: null });
        expect(parserFailure.location.replace).not.toHaveBeenCalled();

        const listenerFailure = createBrowser({
            responseDecision: {
                matched: true,
                action: "open_new_tab",
                destinationUrl: "https://safe.example/tab",
            },
            openImplementation: () => null,
            documentOverrides: {
                addEventListener: () => { throw new Error("listener unavailable"); },
            },
        });
        await expect(listenerFailure.window.VisitorRouting.init({ projectKey: "public-key" }))
            .resolves.toMatchObject({ action: "open_new_tab" });
    });
});

describe("GET /sdk.js", () => {
    it("serves the SDK as cacheable JavaScript without server configuration", async () => {
        const response = await request(createSdkRouteApp()).get("/sdk.js").expect(200);

        expect(response.headers["content-type"]).toContain("javascript");
        expect(response.headers["cache-control"]).toContain("max-age=86400");
        expect(response.text).toContain("VisitorRouting");

        const serverConfiguration = [
            env.DATABASE_URL,
            env.REDIS_URL,
            env.IP_HASH_SECRET,
            env.ADMIN_PASSWORD_HASH,
        ].filter((value) => typeof value === "string" && value.length > 0);

        for (const value of serverConfiguration) {
            expect(response.text).not.toContain(value);
        }
        expect(response.text).not.toContain("DATABASE_URL");
        expect(response.text).not.toContain("REDIS_URL");
        expect(response.text).not.toContain("IP_HASH_SECRET");
    });
});