# Project Status

## Current Phase

Step 40 — Complete Project Management UI

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

## Remaining

- [ ] Event dashboard
- [ ] Production hardening and load testing

## Tests

Step 39 verification: `npm test` passes all 513 tests across 24 test files. Browser geolocation is intentionally out of MVP scope. Visitor location is determined server-side using GeoIP. The SDK does not request browser location permission. Fullscreen prompting uses `_fs=1` on validated redirect/open-new-tab destinations and requires an explicit visitor click.

Step 40: Project owners can edit project name, allowed origins, and enabled status, or delete projects with explicit cascade confirmation. Project key is displayed read-only because PATCH validation does not permit changing it. Backend ownership, cache invalidation, and cascades are reused.