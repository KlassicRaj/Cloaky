const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

function closeHttpServer(server, timeoutMs, logger) {
    if (!server || server.listening !== true) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            logger.warn("Graceful shutdown timed out; closing active HTTP connections.");
            server.closeAllConnections?.();
        }, timeoutMs);
        timeout.unref?.();

        server.close((error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
        server.closeIdleConnections?.();
    });
}

function createShutdownService({
    server,
    database,
    redisClient,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logger = console,
}) {
    let shutdownPromise;

    return function shutdown() {
        if (shutdownPromise) return shutdownPromise;

        shutdownPromise = (async () => {
            const errors = [];
            try {
                await closeHttpServer(server, timeoutMs, logger);
            } catch {
                errors.push("HTTP server");
            }

            const infrastructureClosures = [];
            if (database && typeof database.destroy === "function") {
                infrastructureClosures.push(() => database.destroy());
            }
            if (redisClient) {
                if (redisClient.status === "ready" && typeof redisClient.quit === "function") {
                    infrastructureClosures.push(() => redisClient.quit());
                } else if (typeof redisClient.disconnect === "function") {
                    infrastructureClosures.push(() => redisClient.disconnect());
                }
            }

            const results = await Promise.allSettled(
                infrastructureClosures.map((close) => Promise.resolve().then(close)),
            );
            if (results.some((result) => result.status === "rejected")) {
                errors.push("infrastructure clients");
            }

            if (errors.length > 0) {
                throw new Error(`Failed to close ${errors.join(" and ")}`);
            }
        })();

        return shutdownPromise;
    };
}

function registerShutdownHandlers(server, {
    database,
    redisClient,
    processObject = process,
    logger = console,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
} = {}) {
    const shutdown = createShutdownService({
        server,
        database,
        redisClient,
        timeoutMs,
        logger,
    });
    let shuttingDown = false;

    function handleSignal(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`Received ${signal}; shutting down gracefully.`);
        void shutdown().then(() => {
            processObject.exitCode = 0;
        }).catch(() => {
            logger.error("Graceful shutdown failed.");
            processObject.exitCode = 1;
        });
    }

    const onSigint = () => handleSignal("SIGINT");
    const onSigterm = () => handleSignal("SIGTERM");
    processObject.once("SIGINT", onSigint);
    processObject.once("SIGTERM", onSigterm);

    return () => {
        processObject.removeListener("SIGINT", onSigint);
        processObject.removeListener("SIGTERM", onSigterm);
    };
}

module.exports = {
    DEFAULT_SHUTDOWN_TIMEOUT_MS,
    createShutdownService,
    registerShutdownHandlers,
};
