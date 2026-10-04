# Project Status

## Current Phase

Step 44 — Render deployment preparation

## Completed

- [x] PostgreSQL schema and repositories
- [x] Domain models and RuleEngine
- [x] Frequency, GeoIP, client identity, and client information services
- [x] Evaluation API with project-specific CORS and rate limiting
- [x] Browser SDK and server-side redirect endpoint
- [x] Event logging and in-memory project/rule configuration cache
- [x] Project and rule management APIs
- [x] bcrypt authentication, signed sessions, explicit admin provisioning, and ownership checks for management APIs
- [x] Authenticated, owner-scoped event listing API with bounded pagination and analytics-only fields
- [x] Vanilla HTML/CSS/JavaScript login, project dashboard, and project details foundation
- [x] Project-scoped vanilla JavaScript Rule Builder using authenticated Rule CRUD APIs
- [x] Project allowed origins persist and round-trip as JSONB arrays on create and update
- [x] Authenticated Test Rules API and project-page visitor simulation UI
- [x] Browser geolocation removed from public inputs and product scope
- [x] Fullscreen prompt signaling and explicit-click SDK UI
- [x] Project edit and confirmed delete controls on project details
- [x] PostgreSQL/Redis-backed integration coverage for authentication, project/rule lifecycle, evaluation, frequency, CORS, events, cache invalidation, Test Rules, redirects, rate limiting, and SDK serving
- [x] Evaluation responses include the documented `triggered` boolean for trigger and no-trigger decisions
- [x] Login rate limiting rejects requests when Redis or visitor identity is unavailable
- [x] Reproducible local evaluation load-test harness with isolated test data and Redis keys
- [x] Production Docker packaging with PostgreSQL/Redis health checks, secure configuration validation, and graceful shutdown
- [x] Render deployment preparation: configurable platform port, explicit 0.0.0.0 binding, and deployment runbook

## Remaining

- [ ] Event dashboard
- [ ] Actual Render deployment (not started)

## Tests

Step 39 verification: `npm test` passes all 513 tests across 24 test files. Browser geolocation is intentionally out of MVP scope. Visitor location is determined server-side using GeoIP. The SDK does not request browser location permission. Fullscreen prompting uses `_fs=1` on validated redirect/open-new-tab destinations and requires an explicit visitor click.

Step 40: Project owners can edit project name, allowed origins, and enabled status, or delete projects with explicit cascade confirmation. Project key is displayed read-only because PATCH validation does not permit changing it. Backend ownership, cache invalidation, and cascades are reused.

Step 41: `npm run test:integration` passes 13 integration tests against the real `visitor_routing_test` PostgreSQL database and real Redis service; `npm test` passed 542 tests across 26 files before Step 42. Integration data is created under unique test users and removed by owner-scoped cascade cleanup; Redis writes use a per-run `integration:<uuid>` namespace and cleanup deletes only matching keys. Integration tests use a deterministic GeoIP fixture because `.env.test` does not configure a MaxMind database; client IP extraction, PostgreSQL, Redis frequency/rate limits, and application APIs remain real. No browser automation, live MaxMind database verification, or load test was performed.

Step 42: Login rate limiting now fails closed with a generic 503 if Redis, client IP derivation, or visitor identity is unavailable; public evaluation rate limiting retains its existing fail-open behavior. Local development uses Node's built-in watch mode instead of nodemon, removing the vulnerable nodemon/chokidar/braces chain while retaining automatic restarts. `npm run dev` was verified to start and restart after a source-file change. After removing nodemon, `npm audit` reports zero vulnerabilities. `npm run test:integration` passes 14 tests against real PostgreSQL and Redis; `npm test` passes 546 tests across 26 files.

Step 43: Added a reproducible `npm run load:test` benchmark that is restricted to `visitor_routing_test`, creates uniquely scoped users/projects/rules and Redis keys, warms the configuration cache, measures three evaluation scenarios, waits for event persistence, and cleans up. On the local Windows 10 host (Node 24.12.0, 16 logical CPUs, about 15.25 GiB RAM) with PostgreSQL 17 and Redis 7 in Docker, 1,000 requests per scenario at concurrency 25 completed with no errors: cached RuleEngine match 935.30 req/s (p95 41.42 ms), match with atomic Redis cooldown 1,130.78 req/s (p95 28.72 ms), and cached no-match 1,426.86 req/s (p95 23.39 ms). The measured windows had zero project/rule database lookups; 3,003 emitted events were persisted and then cleaned up. This is a local baseline, not a production capacity guarantee.

Production packaging uses a Node 22 slim image running as the non-root `node` user, a separate PostgreSQL 17/Redis 7 Compose stack with persistent volumes and dependency health checks, authenticated Redis, and an app port bound to loopback for a TLS-terminating proxy. Production startup validates secure cookies, distinct 32-byte session/IP-hash secrets, and an HTTPS `BASE_URL`; migrations and initial admin provisioning remain explicit operator commands. `/health` checks PostgreSQL and Redis, JSON request bodies are capped at 64 KB, and shutdown drains HTTP work before closing database/Redis. The image starts Node directly so Docker SIGTERM reaches the graceful handler.

Step 43 verification: `npm test` passes 558 tests across 29 files; `npm run test:integration` passes 14 tests against real PostgreSQL and Redis; `npm audit` reports zero vulnerabilities. Production Compose configuration, migrations, app/dependency health, non-root execution, authenticated login/project/rule management, public evaluation, redirect, SDK serving, and project cleanup were smoke-tested. A rebuilt production container exited with status 0 on SIGTERM and emitted the graceful-shutdown log. The production image was built with zero production dependency vulnerabilities. Live TLS proxy behavior and a production GeoIP database were not tested; supply the GeoIP database through the configured read-only host mount.

Step 44 preparation: verified the Docker entrypoint starts Node directly, listens on the platform-provided `PORT`, and now binds explicitly to `0.0.0.0`; PostgreSQL and Redis are supplied through standard connection URLs; migrations remain an explicit `npm run db:migrate` release/pre-deploy operation and are not run per request or automatically at app startup. `/health` is unauthenticated and checks both PostgreSQL and Redis with inexpensive readiness probes and sanitized output. Production cookies remain HttpOnly, Secure, SameSite=Strict, Path=/api, and session-expiring. GeoLite2 remains external and optional at startup; production needs a provider-supported persistent disk or other secure file-delivery process and `GEOIP_DATABASE_PATH`. Added [docs/RENDER_DEPLOYMENT.md](./docs/RENDER_DEPLOYMENT.md). No Render service/resources were created and no deployment was performed. The deployment's persistent GeoLite2 delivery method and live Render configuration remain to be verified in the next phase.