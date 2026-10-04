process.env.NODE_ENV = "test";

const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const bcrypt = require("bcryptjs");
const env = require("../src/config/env");
const db = require("../src/config/db");
const redis = require("../src/config/redis");
const userRepository = require("../src/repositories/userRepository");
const visitorIdentityService = require("../src/services/visitorIdentityService");

const runId = randomUUID();
const redisNamespace = `load_test:${runId}`;
const requestCount = Number(process.env.LOAD_TEST_REQUESTS || 1000);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 25);
const timeoutMs = 10_000;
const clientInfo = {
    browser: "Chrome",
    os: "Linux",
    deviceType: "mobile",
    language: "en-US",
    timezone: "UTC",
    screen: { width: 390, height: 844 },
};
const testCredentials = {
    username: `load-test-${runId}`,
    password: randomBytes(32).toString("base64url"),
};
const projects = [];
let userId;
let child;
let baseUrl;
let sessionCookie;
let childOutput = "";

function assertSafeTestConfiguration() {
    const parsedDatabaseUrl = new URL(env.DATABASE_URL);
    const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1));
    if (env.NODE_ENV !== "test" || databaseName !== "visitor_routing_test") {
        throw new Error("Load test is restricted to NODE_ENV=test and visitor_routing_test.");
    }
    if (!Number.isInteger(requestCount) || requestCount < 10 || requestCount > 10_000) {
        throw new Error("LOAD_TEST_REQUESTS must be an integer between 10 and 10000.");
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) {
        throw new Error("LOAD_TEST_CONCURRENCY must be an integer between 1 and 200.");
    }
}

async function preflightServices() {
    const result = await db.raw("SELECT current_database()");
    if (result.rows[0]?.current_database !== "visitor_routing_test") {
        throw new Error("Connected PostgreSQL database is not visitor_routing_test.");
    }
    if (await redis.ping() !== "PONG") {
        throw new Error("Redis did not respond to PING.");
    }
}

async function createTestUser() {
    const passwordHash = await bcrypt.hash(testCredentials.password, 10);
    const [user] = await db("users")
        .insert({
            username: testCredentials.username,
            password_hash: passwordHash,
        })
        .returning(["id"]);
    userId = user.id;
}

function startLoadServer() {
    return new Promise((resolve, reject) => {
        child = spawn(process.execPath, [path.join(__dirname, "load-test-server.js")], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: "test",
                LOAD_TEST_NAMESPACE: redisNamespace,
                LOAD_TEST_REQUESTS: String(requestCount),
            },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let lineBuffer = "";
        let settled = false;
        const startupTimeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("Load-test application did not start within 30 seconds."));
        }, 30_000);

        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            childOutput += text;
            lineBuffer += text;
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop() || "";
            for (const line of lines) {
                if (!line.startsWith("LOAD_TEST_READY ")) continue;
                if (settled) continue;
                settled = true;
                clearTimeout(startupTimeout);
                const { port } = JSON.parse(line.slice("LOAD_TEST_READY ".length));
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            }
        });
        child.stderr.on("data", (chunk) => {
            childOutput += chunk.toString();
        });
        child.once("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(startupTimeout);
            reject(error);
        });
        child.once("exit", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(startupTimeout);
            reject(new Error(`Load-test application exited before ready (code ${code}).`));
        });
    });
}

async function api(pathname, {
    method = "GET",
    body,
    authenticated = true,
} = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated && sessionCookie) headers.Cookie = sessionCookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsedBody;
    try {
        parsedBody = text ? JSON.parse(text) : null;
    } catch {
        parsedBody = text;
    }
    if (!response.ok) {
        throw new Error(`Load-test setup request failed with HTTP ${response.status}.`);
    }
    return { response, body: parsedBody };
}

async function login() {
    const { response } = await api("/api/auth/login", {
        method: "POST",
        authenticated: false,
        body: testCredentials,
    });
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) throw new Error("Test login did not return a session cookie.");
    sessionCookie = setCookie.split(";", 1)[0];
}

async function createProject(label) {
    const { body } = await api("/api/projects", {
        method: "POST",
        body: {
            name: `Load test ${label}`,
            projectKey: `load-${label}-${randomUUID()}`,
            allowedOrigins: [],
            enabled: true,
        },
    });
    projects.push(body);
    return body;
}

async function createRule(project, {
    name,
    deviceType,
    action = "none",
    frequencyEnabled = false,
}) {
    return (await api(`/api/projects/${project.id}/rules`, {
        method: "POST",
        body: {
            name,
            priority: 1,
            enabled: true,
            conditions: {
                field: "device_type",
                operator: "equals",
                value: deviceType,
            },
            action,
            destinationUrl: action === "none" ? null : "https://load-test.example/landing",
            frequencyEnabled,
            frequencySeconds: frequencyEnabled ? 1200 : null,
            frequencyMode: frequencyEnabled ? "cooldown" : null,
            fullscreenMode: "off",
        },
    })).body;
}

function percentile(sortedValues, percent) {
    if (sortedValues.length === 0) return 0;
    const index = Math.max(0, Math.ceil(percent * sortedValues.length) - 1);
    return Number(sortedValues[index].toFixed(2));
}

async function getMetrics() {
    return (await api("/__load_test/metrics", { authenticated: false })).body;
}

async function runScenario({ label, project, payload, expectedReasons }) {
    const warm = await fetch(`${baseUrl}/api/v1/evaluate?projectKey=${encodeURIComponent(project.projectKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!warm.ok) throw new Error(`${label} warm-up failed with HTTP ${warm.status}.`);
    await warm.arrayBuffer();
    const metricsBefore = await getMetrics();

    const latencies = [];
    const unexpectedReasons = {};
    let nextRequest = 0;
    let completed = 0;
    let errors = 0;
    const startedAt = performance.now();

    async function worker() {
        while (true) {
            const index = nextRequest;
            nextRequest += 1;
            if (index >= requestCount) return;

            const requestStarted = performance.now();
            try {
                const response = await fetch(
                    `${baseUrl}/api/v1/evaluate?projectKey=${encodeURIComponent(project.projectKey)}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                        signal: AbortSignal.timeout(timeoutMs),
                    },
                );
                const body = await response.json();
                latencies.push(performance.now() - requestStarted);
                completed += 1;
                if (!response.ok) errors += 1;
                if (!expectedReasons.includes(body.reason)) {
                    unexpectedReasons[body.reason || `http_${response.status}`] =
                        (unexpectedReasons[body.reason || `http_${response.status}`] || 0) + 1;
                }
            } catch {
                errors += 1;
                completed += 1;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));
    const durationSeconds = (performance.now() - startedAt) / 1000;
    const metricsAfter = await getMetrics();
    latencies.sort((left, right) => left - right);

    return {
        label,
        requests: requestCount,
        completed,
        durationSeconds: Number(durationSeconds.toFixed(3)),
        throughputRequestsPerSecond: Number((completed / durationSeconds).toFixed(2)),
        latencyMs: {
            average: Number((latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1)).toFixed(2)),
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            p99: percentile(latencies, 0.99),
        },
        errors,
        errorRate: Number((errors / requestCount).toFixed(4)),
        unexpectedDecisionReasons: unexpectedReasons,
        configurationDatabaseReadsDuringBenchmark: {
            projectLookups: metricsAfter.projects - metricsBefore.projects,
            ruleLists: metricsAfter.rules - metricsBefore.rules,
        },
    };
}

async function waitForEvents(expectedCount) {
    const projectIds = projects.map(({ id }) => id);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const result = await db("events")
            .whereIn("project_id", projectIds)
            .count({ total: "id" })
            .first();
        if (Number(result.total) >= expectedCount) return Number(result.total);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for asynchronous benchmark events to persist.");
}

async function cleanRedisNamespace() {
    let cursor = "0";
    const keys = [];
    do {
        const [nextCursor, matches] = await redis.scan(
            cursor,
            "MATCH",
            `${redisNamespace}:*`,
            "COUNT",
            100,
        );
        cursor = nextCursor;
        keys.push(...matches);
    } while (cursor !== "0");
    if (keys.length > 0) await redis.del(...keys);
}

async function stopLoadServer() {
    if (!child || child.exitCode !== null) return;
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([
        stopped,
        new Promise((resolve) => setTimeout(resolve, 12_000)),
    ]);
    if (child.exitCode === null) {
        child.kill("SIGKILL");
        await stopped;
    }
}

async function cleanup() {
    await stopLoadServer();
    if (userId) await userRepository.deleteById(userId);
    await cleanRedisNamespace();
}

async function main() {
    assertSafeTestConfiguration();
    await preflightServices();
    await createTestUser();
    await startLoadServer();
    await login();

    const cachedMatchProject = await createProject("cached");
    await createRule(cachedMatchProject, {
        name: "Cached mobile match",
        deviceType: "mobile",
    });
    const frequencyProject = await createProject("frequency");
    await createRule(frequencyProject, {
        name: "Atomic cooldown match",
        deviceType: "mobile",
        action: "redirect",
        frequencyEnabled: true,
    });
    const noMatchProject = await createProject("no-match");
    await createRule(noMatchProject, {
        name: "Non-matching tablet",
        deviceType: "tablet",
    });

    const results = [];
    results.push(await runScenario({
        label: "cached configuration + RuleEngine match (frequency disabled)",
        project: cachedMatchProject,
        payload: clientInfo,
        expectedReasons: ["rule_matched"],
    }));
    results.push(await runScenario({
        label: "RuleEngine match + atomic Redis cooldown",
        project: frequencyProject,
        payload: clientInfo,
        expectedReasons: ["frequency_limited"],
    }));
    results.push(await runScenario({
        label: "cached configuration + no match",
        project: noMatchProject,
        payload: clientInfo,
        expectedReasons: ["no_match"],
    }));

    const persistedEvents = await waitForEvents(requestCount * results.length + results.length);
    const namespaceKeys = [];
    let cursor = "0";
    do {
        const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            `${redisNamespace}:*`,
            "COUNT",
            100,
        );
        cursor = nextCursor;
        namespaceKeys.push(...keys);
    } while (cursor !== "0");

    const report = {
        warning: "Local test-services benchmark only; not a production-capacity guarantee.",
        endpoint: "POST /api/v1/evaluate?projectKey=<temporary-test-project>",
        environment: {
            node: process.version,
            platform: `${os.platform()} ${os.release()}`,
            cpuCount: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            postgresDatabase: "visitor_routing_test",
            postgresPool: "min=2 max=10",
            redisHost: new URL(env.REDIS_URL).hostname,
            concurrency,
            requestsPerScenario: requestCount,
            estimatedAverageRequestsPerSecondFor10000PerDay: Number((10_000 / 86_400).toFixed(3)),
            eventLogging: "enabled asynchronously; temporary events are removed during cleanup",
        },
        scenarios: results,
        persistedEvents,
        redisKeysInUniqueTestNamespaceBeforeCleanup: namespaceKeys.length,
        redisKeysContainRawLoopbackIp: namespaceKeys.some((key) => key.includes("127.0.0.1")),
    };

    console.log(JSON.stringify(report, null, 2));
}

main()
    .catch((error) => {
        console.error(`Load test failed: ${error.message}`);
        if (childOutput) {
            console.error("Load-test application did not report readiness or exited unexpectedly.");
        }
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await cleanup();
        } catch {
            console.error("Load-test cleanup failed; inspect only the unique load-test namespace and test user.");
            process.exitCode = 1;
        }
        await Promise.allSettled([db.destroy(), redis.quit()]);
    });
