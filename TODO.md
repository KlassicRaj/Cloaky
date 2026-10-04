# TODO

## Completed

- [x] Backend foundation, database schema, migrations, and repositories
- [x] RuleEngine, frequency, GeoIP, client identity, and normalization services
- [x] Public evaluation API, CORS, and rate limiting
- [x] SDK foundation and redirect endpoint
- [x] Project/rule CRUD and configuration caching
- [x] bcrypt authentication, signed sessions, admin provisioning, and session-protected management APIs
- [x] Authenticated Events API with project ownership checks and paginated analytics data
- [x] Dashboard foundation with login, project listing/creation, project details, and logout
- [x] Rule Builder UI with nested condition serialization and authenticated rule CRUD
- [x] Serialize project allowed origins as JSONB arrays for repository create/update
- [x] Test Rules API and UI with request-local frequency simulation
- [x] Remove browser geolocation from supported product inputs
- [x] Implement fullscreen prompt signaling and explicit-click SDK prompt
- [x] Browser geolocation is intentionally out of MVP scope. Visitor location is determined server-side using GeoIP. The SDK does not request browser location permission.
- [x] Build SDK evaluation requests from the captured SDK script origin and document cross-origin integration
- [x] Complete project management UI with owner-authorized editing and confirmed deletion
- [x] Add real-PostgreSQL/Redis integration tests for complete management and public evaluation flows
- [x] Fail closed on unavailable login rate limiting without changing public evaluation failure behavior
- [x] Replace the vulnerable development-only nodemon chain with Node's built-in watch mode
- [x] Add reproducible local PostgreSQL/Redis evaluation load testing
- [x] Add production Docker packaging, dependency health checks, secure configuration validation, and graceful shutdown
- [x] Prepare Render deployment documentation and regression coverage for platform port/bind behavior
- [x] Verify Render requirements against migrations, admin provisioning, Redis, GeoIP, cookies, health, and proxy trust

## Remaining

- [ ] Events dashboard
- [ ] Perform actual Render deployment after externally provisioning GeoLite2 and Render services
- [ ] Confirm selected Render plan supports pre-deploy migration command and persistent GeoLite2 storage
- [ ] Verify Render direct proxy peer address/range before setting TRUSTED_PROXIES