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