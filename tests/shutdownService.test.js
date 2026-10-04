import { describe, expect, it, vi } from "vitest";

const http = require("node:http");
const { EventEmitter } = require("node:events");
const { createShutdownService } = require("../src/services/shutdownService");
const { registerShutdownHandlers } = require("../src/services/shutdownService");

describe("graceful shutdown", () => {
    it("stops accepting requests, lets an active request finish, and closes dependencies", async () => {
        let finishRequest;
        const server = http.createServer((req, res) => {
            finishRequest = () => res.end("finished");
        });
        const database = { destroy: vi.fn().mockResolvedValue(undefined) };
        const redisClient = {
            status: "ready",
            quit: vi.fn().mockResolvedValue("OK"),
            disconnect: vi.fn(),
        };

        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        const responsePromise = fetch(`http://127.0.0.1:${address.port}`);
        while (!finishRequest) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }

        const shutdown = createShutdownService({
            server,
            database,
            redisClient,
            timeoutMs: 1000,
            logger: { warn: vi.fn() },
        });
        const firstShutdown = shutdown();
        expect(shutdown()).toBe(firstShutdown);
        finishRequest();

        const response = await responsePromise;
        expect(await response.text()).toBe("finished");
        await firstShutdown;

        expect(server.listening).toBe(false);
        expect(database.destroy).toHaveBeenCalledTimes(1);
        expect(redisClient.quit).toHaveBeenCalledTimes(1);
        expect(redisClient.disconnect).not.toHaveBeenCalled();
    });

    it("disconnects a Redis client that is not connected", async () => {
        const redisClient = { status: "wait", disconnect: vi.fn() };
        const database = { destroy: vi.fn().mockResolvedValue(undefined) };
        const shutdown = createShutdownService({
            server: null,
            database,
            redisClient,
        });

        await shutdown();

        expect(redisClient.disconnect).toHaveBeenCalledTimes(1);
        expect(database.destroy).toHaveBeenCalledTimes(1);
    });

    it.each(["SIGINT", "SIGTERM"])("registers graceful cleanup for %s", async (signal) => {
        const processObject = new EventEmitter();
        const database = { destroy: vi.fn().mockResolvedValue(undefined) };
        const redisClient = { status: "wait", disconnect: vi.fn() };
        const logger = { info: vi.fn(), error: vi.fn() };
        const unregister = registerShutdownHandlers(null, {
            database,
            redisClient,
            processObject,
            logger,
        });

        processObject.emit(signal);
        await vi.waitFor(() => expect(database.destroy).toHaveBeenCalledTimes(1));
        expect(redisClient.disconnect).toHaveBeenCalledTimes(1);
        expect(processObject.exitCode).toBe(0);
        expect(logger.info).toHaveBeenCalledWith(
            `Received ${signal}; shutting down gracefully.`,
        );
        unregister();
    });
});
