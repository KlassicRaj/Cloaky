# Architecture Decisions

## Authentication and Sessions

- Passwords are verified against bcrypt hashes in the existing `users` table. Initial provisioning is an explicit command (`npm run admin:provision`) that consumes `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`; it refuses to overwrite an existing username and the application never provisions an admin at startup.
- Provisioning requires a bcrypt hash generated in a secure local environment (cost 10–14), a separate random `SESSION_SECRET` of at least 32 bytes, and existing migrations. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` through a secure environment/secret manager, run `npm run db:migrate`, then run `npm run admin:provision`. The provisioner prints neither the password nor hash and refuses to overwrite an existing username.
- Sessions are stateless HMAC-SHA256 signed cookies containing only the user ID and expiry. `SESSION_SECRET` is separate from `IP_HASH_SECRET` and must contain at least 32 bytes outside test mode.
- Session cookies are HttpOnly, SameSite=Strict, scoped to `/api`, and Secure when configured or in production. Logout clears the browser cookie; there is no server-side token revocation store, so copied tokens remain valid until expiry or their user is deleted.
- Management middleware verifies the signed cookie, reloads the user, and attaches the database user ID. Project/rule services require that authenticated ID and verify project ownership; they do not fall back to `ADMIN_USERNAME` or trust client-supplied IDs.
- Login rate limiting uses the existing Redis rate-limit middleware with a separate `login_rate_limit` namespace and a limit of 10 attempts per minute. Its existing fail-open behavior applies when Redis is unavailable.

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