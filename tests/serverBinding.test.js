import { afterEach, describe, expect, it, vi } from "vitest";

const { startServer } = require("../src/server");
const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) =>
        new Promise((resolve, reject) => {
            if (!server.listening) {
                resolve();
                return;
            }
            server.close((error) => error ? reject(error) : resolve());
        }),
    ));
});

describe("production HTTP server binding", () => {
    it("binds on all IPv4 interfaces using the configured port", async () => {
        const geoIp = { initialize: vi.fn().mockResolvedValue(false) };
        const server = await startServer({ port: 0, geoIp });
        servers.push(server);
        await new Promise((resolve, reject) => {
            if (server.listening) {
                resolve();
                return;
            }
            server.once("listening", resolve);
            server.once("error", reject);
        });

        expect(geoIp.initialize).toHaveBeenCalledTimes(1);
        expect(server.address()).toMatchObject({
            address: "0.0.0.0",
            port: expect.any(Number),
        });
        expect(server.address().port).toBeGreaterThan(0);
    });
});
