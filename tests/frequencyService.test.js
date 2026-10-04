import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { randomUUID } = require("node:crypto");
const redis = require("../src/config/redis");
const { FrequencyService } = require("../src/services/frequencyService");

const keyPrefix = `test-frequency:${randomUUID()}`;
const service = new FrequencyService(redis, { keyPrefix });

function checkOptions(overrides = {}) {
    return {
        projectId: "project-1",
        ruleId: "rule-1",
        visitorId: "visitor-hash-1",
        frequencyEnabled: true,
        frequencySeconds: 60,
        frequencyMode: "cooldown",
        ...overrides,
    };
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deleteTestKeys() {
    let cursor = "0";

    do {
        const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            `${keyPrefix}:*`,
            "COUNT",
            100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } while (cursor !== "0");
}

beforeAll(async () => {
    await redis.ping();
});

afterAll(async () => {
    try {
        await deleteTestKeys();
    } finally {
        await redis.quit();
    }
});

describe("FrequencyService", () => {
    it("allows a trigger without contacting Redis when frequency is disabled", async () => {
        const unavailableClient = { set: vi.fn(), eval: vi.fn() };
        const noFrequencyService = new FrequencyService(unavailableClient);

        await expect(noFrequencyService.checkAndRecord(
            checkOptions({ frequencyEnabled: false }),
        )).resolves.toEqual({ triggered: true, reason: "frequency_disabled" });
        expect(unavailableClient.set).not.toHaveBeenCalled();
        expect(unavailableClient.eval).not.toHaveBeenCalled();
    });

    it("triggers and records the first cooldown request", async () => {
        await expect(service.checkAndRecord(checkOptions({ frequencySeconds: 60 })))
            .resolves.toEqual({ triggered: true, reason: "frequency_triggered" });
    });

    it("limits a second immediate cooldown request", async () => {
        const options = checkOptions({ ruleId: "cooldown-second", frequencySeconds: 60 });

        await service.checkAndRecord(options);
        await expect(service.checkAndRecord(options)).resolves.toEqual({
            triggered: false,
            reason: "frequency_limited",
        });
    });

    it("allows a cooldown request again after its TTL expires", async () => {
        const options = checkOptions({ ruleId: "cooldown-expiry", frequencySeconds: 1 });

        await service.checkAndRecord(options);
        await wait(1100);

        await expect(service.checkAndRecord(options)).resolves.toEqual({
            triggered: true,
            reason: "frequency_triggered",
        });
    });

    it("records the first return_after visit without triggering", async () => {
        await expect(service.checkAndRecord(checkOptions({
            ruleId: "return-first",
            frequencyMode: "return_after",
        }))).resolves.toEqual({ triggered: false, reason: "frequency_recorded" });
    });

    it("limits an immediate second return_after request", async () => {
        const options = checkOptions({ ruleId: "return-second", frequencyMode: "return_after" });

        await service.checkAndRecord(options);
        await expect(service.checkAndRecord(options)).resolves.toEqual({
            triggered: false,
            reason: "frequency_limited",
        });
    });

    it("triggers and restarts return_after state after the interval", async () => {
        const options = checkOptions({
            ruleId: "return-expiry",
            frequencySeconds: 1,
            frequencyMode: "return_after",
        });

        await service.checkAndRecord(options);
        await wait(1100);

        await expect(service.checkAndRecord(options)).resolves.toEqual({
            triggered: true,
            reason: "frequency_triggered",
        });
        await expect(service.checkAndRecord(options)).resolves.toEqual({
            triggered: false,
            reason: "frequency_limited",
        });
    });

    it("keeps state independent across rules", async () => {
        const baseOptions = checkOptions({ ruleId: "independent-rule-a" });

        await service.checkAndRecord(baseOptions);
        await expect(service.checkAndRecord({
            ...baseOptions,
            ruleId: "independent-rule-b",
        })).resolves.toEqual({ triggered: true, reason: "frequency_triggered" });
    });

    it("keeps state independent across visitors", async () => {
        const baseOptions = checkOptions({ ruleId: "independent-visitor" });

        await service.checkAndRecord(baseOptions);
        await expect(service.checkAndRecord({
            ...baseOptions,
            visitorId: "visitor-hash-2",
        })).resolves.toEqual({ triggered: true, reason: "frequency_triggered" });
    });

    it.each([
        ["non-positive interval", { frequencySeconds: 0 }],
        ["fractional interval", { frequencySeconds: 1.5 }],
        ["unknown mode", { frequencyMode: "unknown" }],
        ["missing project ID", { projectId: " " }],
        ["missing rule ID", { ruleId: null }],
        ["missing visitor ID", { visitorId: undefined }],
    ])("returns a safe result for %s", async (_description, overrides) => {
        await expect(service.checkAndRecord(checkOptions(overrides))).resolves.toEqual({
            triggered: false,
            reason: "frequency_invalid",
        });
    });

    it("fails safe and logs when Redis rejects an operation", async () => {
        const redisError = new Error("Redis unavailable");
        const unavailableService = new FrequencyService({
            set: vi.fn().mockRejectedValue(redisError),
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(unavailableService.checkAndRecord(checkOptions())).resolves.toEqual({
            triggered: false,
            reason: "frequency_unavailable",
        });
        expect(consoleError).toHaveBeenCalledWith(
            "Frequency service Redis operation failed:",
            redisError,
        );

        consoleError.mockRestore();
    });

    it("allows only one concurrent cooldown request to trigger", async () => {
        const options = checkOptions({ ruleId: "concurrent-cooldown", frequencySeconds: 60 });
        const results = await Promise.all(
            Array.from({ length: 20 }, () => service.checkAndRecord(options)),
        );

        expect(results.filter(({ triggered }) => triggered)).toHaveLength(1);
        expect(results.filter(({ reason }) => reason === "frequency_limited")).toHaveLength(19);
    });

    it("allows only one concurrent return_after request to record the first visit", async () => {
        const options = checkOptions({
            ruleId: "concurrent-return-after",
            frequencySeconds: 60,
            frequencyMode: "return_after",
        });
        const results = await Promise.all(
            Array.from({ length: 20 }, () => service.checkAndRecord(options)),
        );

        expect(results.filter(({ reason }) => reason === "frequency_recorded")).toHaveLength(1);
        expect(results.filter(({ reason }) => reason === "frequency_limited")).toHaveLength(19);
        expect(results.some(({ triggered }) => triggered)).toBe(false);
    });

    it("allows only one concurrent return_after request to trigger after expiry", async () => {
        const options = checkOptions({
            ruleId: "concurrent-return-after-expiry",
            frequencySeconds: 1,
            frequencyMode: "return_after",
        });

        await service.checkAndRecord(options);
        await wait(1100);

        const results = await Promise.all(
            Array.from({ length: 20 }, () => service.checkAndRecord(options)),
        );

        expect(results.filter(({ triggered }) => triggered)).toHaveLength(1);
        expect(results.filter(({ reason }) => reason === "frequency_limited")).toHaveLength(19);
    });
});