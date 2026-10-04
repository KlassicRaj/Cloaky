# Render Deployment Preparation

This is a deployment runbook, not evidence of a completed deployment. No Render
resources have been created or deployed as part of this preparation step. Use
the Render dashboard for the first deployment; this repository intentionally
does not include a `render.yaml`.

## Services

Create these managed services in Render:

1. **PostgreSQL** for persistent users, projects, rules, and events.
2. **Key Value** (Redis-compatible) for rate limiting and frequency state.
3. **Web Service** using this repository's Dockerfile.

Use the provider's private/internal connection URLs where available. Set
`DATABASE_URL` and `REDIS_URL` from the corresponding Render service values;
the app does not require Docker Compose service names. `REDIS_URL` may use
`redis://` or `rediss://` as provided by the service.

PostgreSQL is the source of truth. Redis stores only rate-limit counters and
visitor frequency state. Redis data loss or restart can reset active rate
limits/frequency windows, but does not remove users, projects, rules, or events.

## Web service configuration

- Select Docker as the runtime and let Render build from `Dockerfile`.
- The container starts `node src/server.js` directly. Do not add an `npm start`
  wrapper; direct Node startup allows Docker SIGTERM to reach graceful shutdown.
- Set `NODE_ENV=production`. Render supplies `PORT`; the app validates and uses
  that value and listens on `0.0.0.0`. Do not hardcode a Render port.
- Set the health-check path to `/health`. The unauthenticated endpoint runs
  lightweight PostgreSQL `SELECT 1` and Redis `PING` checks. It returns HTTP
  200 only when both required dependencies are reachable, otherwise sanitized
  HTTP 503 status with no connection details or secrets.
- Configure the service pre-deploy command as `npm run db:migrate`. This runs
  Knex forward migrations once for a release, before the new version serves
  requests. Migrations are not executed on requests or ordinary app startup.
  Do not run rollback automatically. Confirm that the selected Render plan
  supports the pre-deploy command before relying on this release workflow.
- Use the normal container stop signal and grace period so the application can
  stop accepting requests, finish active work, and close PostgreSQL/Redis.

## Environment variables

Set these through Render's environment/secret configuration. Do not commit
credentials or generated secrets:

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Supplied by Render; do not hardcode |
| `DATABASE_URL` | Render PostgreSQL connection URL |
| `REDIS_URL` | Render Key Value/Redis-compatible connection URL |
| `ADMIN_USERNAME` | Initial admin username; required by application configuration |
| `SESSION_SECRET` | Random secret of at least 32 bytes |
| `IP_HASH_SECRET` | Separate random secret of at least 32 bytes |
| `COOKIE_SECURE` | `true`; production validation rejects false |
| `BASE_URL` | Final public `https://<service>.onrender.com` URL; not a redirect target |
| `GEOIP_DATABASE_PATH` | Path to the externally supplied database file; may be empty if GeoIP is intentionally unavailable |
| `TRUSTED_PROXIES` | Set only if the real proxy addresses/CIDRs are known and required; otherwise leave empty |
| `EVENT_RETENTION_DAYS` | Optional; defaults to `30` |
| `RATE_LIMIT_PER_MINUTE` | Optional; defaults to `60` |
| `ADMIN_PASSWORD_HASH` | Needed only for one-time admin provisioning; remove from persistent web-service environment after provisioning if not otherwise needed |

`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
`APP_PORT`, and `GEOIP_DATABASE_DIR` are local production-Compose inputs, not
Render web-service settings. Do not set Render's URLs to Compose service names
such as `postgres` or `redis`.

## GeoLite2 City database

The application looks for `GeoLite2-City.mmdb` at `GEOIP_DATABASE_PATH`.
The database is not included in Git or the Docker image, and MaxMind license
credentials must not be put in source, `.env.example`, or image layers.

Before deployment, confirm the chosen Render service plan supports persistent
disk storage and attach a disk at a stable mount path (for example,
`/var/data/geoip`). Arrange a secure, authorized process to place/update the
licensed `.mmdb` file on that disk, set
`GEOIP_DATABASE_PATH=/var/data/geoip/GeoLite2-City.mmdb`, and verify the
application user can read it. Do not bake a developer-machine path or local
GeoIP copy into the image. If no database is supplied, startup continues with
GeoIP lookups disabled and location fields unavailable; location-dependent
rules will not match based on missing GeoIP data.

Persistent-disk availability, cost, file-delivery method, and behavior during
disk updates must be confirmed for the actual Render plan before deployment.
Do not assume a free/ephemeral filesystem retains the database across deploys.

## Cookies and CORS

Production session cookies are HttpOnly, Secure, SameSite=Strict, scoped to
`/api`, and expire with the signed session. The dashboard and API are served
from the same application origin, so cross-site cookies are not needed.

Project allowed origins remain authoritative for public evaluation CORS. Do
not add the Render hostname as a global allowed origin or use wildcard CORS.
After deployment, enter each customer website origin through that project's
allowed-origin configuration.

## First deployment sequence

1. Create the Render PostgreSQL service and keep its connection URL private.
2. Create the Render Key Value service and obtain its connection URL.
3. Confirm the selected web-service plan supports a persistent disk; attach
   one for GeoLite2 or explicitly choose to run without GeoIP.
4. Create the Render Web Service from the repository using Docker.
5. Configure the production environment variables and provider URLs above.
6. Supply the GeoLite2 file through the approved external process and configure
   its mounted path, if GeoIP is enabled.
7. Configure the `npm run db:migrate` pre-deploy command.
8. Deploy the service. **This sequence has not yet been executed.**
9. Verify the Render health check and public `/health` response.
10. Run `npm run admin:provision` once after migrations, with
    `ADMIN_USERNAME` and a valid bcrypt `ADMIN_PASSWORD_HASH` available in the
    Render service shell; remove the hash from persistent service settings
    afterward.
11. Log in to the dashboard.
12. Create a project and enter its customer allowed origin(s).
13. Create a rule and test its evaluation.
14. Test a redirect rule using a controlled destination.
15. Load the SDK from the Render service hostname and test evaluation from an
    allowed customer origin.

Do not consider the deployment complete until these steps, including the
provider-specific GeoLite2 persistence and delivery checks, have been performed
and verified.
