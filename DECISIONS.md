# Architecture Decisions

## Authentication and Sessions

- Passwords are verified against bcrypt hashes in the existing `users` table. Initial provisioning is an explicit command (`npm run admin:provision`) that consumes `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`; it refuses to overwrite an existing username and the application never provisions an admin at startup.
- Provisioning requires a bcrypt hash generated in a secure local environment (cost 10–14), a separate random `SESSION_SECRET` of at least 32 bytes, and existing migrations. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` through a secure environment/secret manager, run `npm run db:migrate`, then run `npm run admin:provision`. The provisioner prints neither the password nor hash and refuses to overwrite an existing username.
- Sessions are stateless HMAC-SHA256 signed cookies containing only the user ID and expiry. `SESSION_SECRET` is separate from `IP_HASH_SECRET` and must contain at least 32 bytes outside test mode.
- Session cookies are HttpOnly, SameSite=Strict, scoped to `/api`, and Secure when configured or in production. Logout clears the browser cookie; there is no server-side token revocation store, so copied tokens remain valid until expiry or their user is deleted.
- Management middleware verifies the signed cookie, reloads the user, and attaches the database user ID. Project/rule services require that authenticated ID and verify project ownership; they do not fall back to `ADMIN_USERNAME` or trust client-supplied IDs.
- Login rate limiting uses the existing Redis rate-limit middleware with a separate `login_rate_limit` namespace and a limit of 10 attempts per minute. It fails closed with a generic 503 if Redis, trusted client-IP derivation, or visitor identity is unavailable. Public evaluation rate limiting retains its fail-open behavior to preserve customer-site availability.

## Authenticated Events API

- `GET /api/projects/:projectId/events` is protected by the existing management `requireAuth` middleware. The event service delegates project ownership verification to `projectService.getById`; missing and non-owned projects both return 404.
- Event listing accepts only positive-integer `page` and `pageSize` query parameters, defaults to page 1 and 50 events, and caps page size at 100. Unknown query parameters are rejected. The response includes total event and page counts.
- Event rows are paginated in PostgreSQL and ordered by `created_at DESC, id DESC` for deterministic newest-first results. The repository selects only the approved analytics columns; the service maps those fields to the API response shape and excludes visitor/request data.
- The repository uses the existing `(project_id, created_at)` index for listing/counting and performs a separate count query for pagination metadata. The schema/index is unchanged.

## Dashboard Foundation

- The first dashboard is plain HTML, CSS, and vanilla JavaScript under `public/`; Express serves only `/login`, `/dashboard`, `/dashboard/project.html`, and the intended frontend assets under `/assets`. The page routes serve a static shell and do not embed management data.
- Login uses `POST /api/auth/login`; subsequent dashboard API calls rely on the browser's existing HttpOnly session cookie with same-origin credentials. The frontend neither reads/stores the cookie nor stores credentials, and management data continues to be authorized by the existing protected API routes.
- Project listing and creation use the existing project API. Project details are fetched by ID through the existing ownership-protected project endpoint. The Events section remains a placeholder; rule management is implemented as described below.

## Rule Builder

- Rule management is a configuration-only UI on the project details page. It uses the existing owner-protected Rule CRUD endpoints and does not evaluate conditions in the browser.
- The builder serializer emits the backend schema verbatim: logical nodes use `{ operator: "AND" | "OR", conditions: [...] }` and leaves use `{ field, operator, value }`. Nested groups and child order are retained; numeric field values are serialized as numbers. An existing leaf-root condition is represented in the editor as an equivalent one-child AND root.
- The editor's fields, compatible operators, actions, frequency modes, and fullscreen modes mirror the existing Zod rule validation. Disabled frequency is sent with null seconds/mode, and action `none` omits the destination URL. Backend validation remains authoritative.

## Project Allowed Origins Storage

- `allowedOrigins` remains a JavaScript array in application services and a JSONB array in PostgreSQL. The project repository binds it as PostgreSQL `text[]` and converts it with `to_jsonb`, avoiding `pg`'s default PostgreSQL-array encoding being interpreted as invalid JSONB. The same conversion is applied on create and update; the schema and CORS contract are unchanged.

## Test Rules

- `POST /api/projects/:projectId/test-rules` uses the existing authenticated management middleware, verifies project ownership through the project service, loads current rules, normalizes a validated request-local visitor, and calls the existing RuleEngine. It does not call production EvaluationService, FrequencyService, visitor identity, event logging, or event persistence.
- Frequency is a deterministic simulation only: first-visit `cooldown` passes the gate; first-visit `return_after` returns `frequency_recorded` without triggering; a returning visitor is limited when elapsed seconds are less than the configured interval and passes at or after the interval for either mode. No state survives the request, unlike production Redis TTL state.
- Test Rules is embedded in the project details page and linked from its section navigation. Visitor, simulated location (country/region/city), and frequency inputs are sent to the management endpoint; results are rendered as text, and test IPs are neither logged nor persisted.

## Browser Geolocation and Fullscreen Prompt

- Browser geolocation is intentionally out of MVP scope. Visitor location is determined server-side using GeoIP. The SDK does not request browser location permission. Browser coordinates are excluded from public evaluation/Test Rules validation and the Rule Builder; legacy domain normalization and RuleEngine getters remain only for compatibility with internal callers or already-stored rules.
- Fullscreen prompting is opt-in through each rule's existing `fullscreenMode` value. After HTTP/HTTPS destination validation, redirect and SDK open-new-tab actions set `_fs=1` using the URL API, preserving other query parameters and fragments. Mode `off` does not add the marker.
- The destination SDK displays a dismissible prompt only when `_fs=1` is present and fullscreen is supported. `requestFullscreen()` or its WebKit equivalent is called only directly from the visitor's button click handler. The SDK never automatically enters fullscreen; failure or dismissal removes the prompt, and normal browser fullscreen controls (including Escape) remain untouched.

## SDK API Origin

- The SDK captures the currently executing script's absolute HTTP(S) URL during script evaluation and constructs evaluation requests using that script URL's origin. It never falls back to the customer page's location. If the executing script URL cannot be captured or parsed, evaluation stops safely without a request. `projectKey` is encoded through `URLSearchParams` and remains subject to the API's 200-character validation limit.

## Project Management UI

- The project details page exposes the existing owner-authenticated PATCH and DELETE APIs. Editing supports only name, allowed origins, and enabled state; project key is read-only because the backend PATCH schema intentionally rejects it. Origins are sent as an array and remain server-validated.
- Project deletion requires browser confirmation that associated rules and events are removed, then navigates to the dashboard, whose normal initialization reloads the project list. The UI relies on existing project-service ownership checks, cache invalidation, and PostgreSQL cascades; it maintains no separate project cache.

## Step 41 Integration Verification

- `npm run test:integration` runs Supertest flows against the real PostgreSQL database named `visitor_routing_test` and the configured real Redis service. A preflight refuses to run unless the configured database URL and connected database both identify `visitor_routing_test`, required migrations exist, and Redis responds to `PING`; missing infrastructure fails with a setup error rather than skipping tests.
- Test users and their projects/rules/events are created through the application/database and removed by deleting only the integration-created user IDs, relying on existing ownership and cascades. Every integration Redis key is prefixed with a unique `integration:<run UUID>` namespace; teardown scans and deletes only that prefix and never flushes Redis.
- The integration process uses an ephemeral session-signing secret and configures loopback as a test-only trusted proxy so Supertest can exercise the real server-side forwarded-IP extraction with controlled visitor addresses. PostgreSQL, Redis, auth, project/rule/event APIs, frequency checks, and rate limiting are not mocked.
- `.env.test` does not configure a MaxMind database. To keep country-based rule matching deterministic, the integration app injects a small GeoIP fixture for documentation-range test addresses; the real GeoIP database integration remains unverified in this environment.
- Integration verification found that the public evaluation response dropped the documented `triggered` value while normalizing decisions. `createDecision` now retains an explicitly supplied boolean, and EvaluationService returns `triggered: false` for no-action/failure outcomes and marks successful non-`none` actions as triggered. Missing values remain omitted for unrelated callers that do not supply this property.

## Step 42 Security Hardening

- Security review found the login limiter's shared fail-open behavior could allow unlimited password attempts when Redis or client identity derivation was unavailable. `createRateLimit` supports an explicit fail-closed mode; only the login limiter enables it. The response is a generic 503 (`rate_limit_unavailable`), and the authentication handler is not called. Public evaluation retains fail-open behavior. Tests cover Redis rejection, missing client IP, identity-generation failure, and the production-wired login path.
- The advisory was in the development-only chain `nodemon` → `chokidar` → `braces` (`braces@3.0.3`, affected range `<=3.0.3`), concerning stack exhaustion from deeply nested patterns. The configured registry exposed no patched braces release, and `npm audit` offered only a forced major nodemon downgrade. Rather than force an incompatible downgrade or override a transitive package speculatively, the project now uses Node.js 20+'s built-in `node --watch src/server.js` for `npm run dev` and removes nodemon. This preserves the required development restart workflow and removes the full vulnerable chain; `npm ls nodemon chokidar braces` reports no installed instances and `npm audit` reports zero vulnerabilities.
- Step 42 verification after dependency remediation: `npm install` completes successfully; `npm run dev` starts and was observed restarting after a source-file change; `npm run test:integration` passes 14 tests; `npm test` passes 546 tests across 26 files; `npm audit` reports zero vulnerabilities.
- Security review did not identify a confirmed IDOR, session-signature, CORS reflection, trusted-proxy spoofing, raw-IP persistence, redirect validation, or dashboard DOM-injection issue in the inspected paths. Production TLS/proxy headers and live GeoIP configuration were not verified. Stateless copied sessions remain valid until expiry as documented.

## Step 43 Performance and Production Packaging

- `npm run load:test` is a local repeatable baseline, not a production load generator. It forces test mode, refuses any database other than `visitor_routing_test`, isolates Redis state with a unique namespace, provisions unique data, warms configuration before measurement, waits for asynchronous event writes, and cleans up its own database and Redis records. It uses Node built-ins and adds no benchmark dependency.
- Local baseline (Windows 10, Node 24.12.0, 16 logical CPUs, approximately 15.25 GiB RAM, PostgreSQL 17 and Redis 7 in Docker; concurrency 25, 1,000 requests per scenario): cached match without frequency gate 935.30 requests/second (average 26.52 ms; p50 24.79 ms; p95 41.42 ms; p99 61.86 ms); match with atomic Redis cooldown 1,130.78 requests/second (average 21.85 ms; p50 22.02 ms; p95 28.72 ms; p99 33.57 ms); cached no-match 1,426.86 requests/second (average 17.40 ms; p50 17.18 ms; p95 23.39 ms; p99 24.76 ms). Each scenario reported zero errors and zero project/rule reads after warm-up; 3,003 temporary events were persisted then removed. This synthetic single-host result is not a production capacity guarantee.
- Production deployment is isolated in `docker-compose.prod.yml`; the local development Compose setup is unchanged. The Node 22 slim app image installs production dependencies only, runs as the unprivileged `node` user, uses a read-only root filesystem and bounded `/tmp`, and starts `node src/server.js` directly. Direct execution is required so Docker SIGTERM reaches the registered graceful-shutdown handlers rather than terminating through an `npm start` wrapper; a production-container stop verified exit status 0 and the shutdown log.
- PostgreSQL 17 and Redis 7 use named persistent volumes, dependency health checks, no published database/cache ports, and Redis password authentication. The app port is published only on loopback for a separately managed TLS proxy. Production requires `COOKIE_SECURE=true`, distinct session and IP-hash secrets of at least 32 bytes, and an HTTPS `BASE_URL`; secrets are supplied by the deployment environment. Schema migrations and admin provisioning are explicit operator steps, not app-startup side effects.
- `/health` reports readiness only when PostgreSQL and Redis are reachable, without exposing dependency error details. Request JSON is limited to 64 KB. Shutdown stops accepting HTTP requests, allows active requests to complete up to the configured grace period, then closes PostgreSQL and Redis.
- The GeoIP database remains an externally supplied, read-only host mount. The production Compose/image path, application health, non-root runtime, login cookie flags, management and public API smoke flows, and clean SIGTERM shutdown were verified locally. A real TLS proxy, production domain/DNS, production GeoIP data, multi-instance cache invalidation, and production-scale capacity were not verified.

## Step 44 Render Deployment Preparation

- The production container continues to start `node src/server.js` directly; the server binds to `0.0.0.0` and takes its port from validated `PORT` configuration (default 3000 only for local use). Render configuration must supply its port as `PORT`; Docker `EXPOSE 3000` is image metadata, not a runtime port override.
- Render deployment uses the Dockerfile and provider-injected standard `DATABASE_URL` and `REDIS_URL` values. The app does not depend on Compose DNS in this configuration. PostgreSQL is the source of truth for users/projects/rules/events; Redis-compatible service state is limited to rate limiting and frequency controls, so Redis loss can reset frequency windows but does not delete application records.
- Knex migrations stay outside the request and normal startup path. Configure `npm run db:migrate` as the Render service's pre-deploy command so migration completes before the new app release serves requests; use forward migrations only. Admin provisioning is a separate one-time `npm run admin:provision` operation after migrations and requires `ADMIN_PASSWORD_HASH` only for that operation.
- The health endpoint remains unauthenticated and checks both required dependencies using `SELECT 1` and Redis `PING`. It returns only sanitized service status with HTTP 200/503. Production session cookies remain HttpOnly, Secure, SameSite=Strict, scoped to `/api`, and expiry-bound. Evaluation CORS continues to use only each project's configured allowed origins.
- `BASE_URL` must be the eventual HTTPS service URL and is validated as such in production; source search confirms it is not used to construct redirect destinations. Rule destinations continue to be independently validated by existing rule validation/evaluation.
- GeoLite2 City remains a file outside the image and repository. Configure `GEOIP_DATABASE_PATH` to a provider-supported persistent disk mount containing `GeoLite2-City.mmdb`. If the file is absent or unreadable, existing initialization logs a concise failure and evaluation safely proceeds without GeoIP location. Render plan/disk availability and secure file delivery must be settled before live deployment.
- No `render.yaml` is added: first deployment is intentionally dashboard-configured so provider-managed URLs/secrets and external GeoIP storage are not encoded in repository configuration. Step 44 is preparation only; Render resources have not been created and deployment is not complete.