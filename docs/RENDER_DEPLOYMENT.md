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
  Do not run rollback automatically. Confirm that the selected Render service
  plan/UI supports a pre-deploy command and supplies `DATABASE_URL` to that
  command. If not, use a one-time Render Shell command against the configured
  web-service environment after PostgreSQL is available and before relying on
  the app; do not put migrations into the normal start command.
- Use the normal container stop signal and grace period so the application can
  stop accepting requests, finish active work, and close PostgreSQL/Redis.

## Environment variables

Set these through Render's environment/secret configuration. Do not commit
credentials or generated secrets:

| Variable | Required in production? | Source / configuration |
| --- | --- | --- |
| `NODE_ENV` | Yes | Set manually to `production` |
| `PORT` | Yes; provider-managed | Supplied by Render; do not set a fixed port |
| `DATABASE_URL` | Yes | Render PostgreSQL connection URL |
| `REDIS_URL` | Yes | Render Key Value/Redis-compatible connection URL |
| `ADMIN_USERNAME` | Yes | Set the intended admin username before provisioning |
| `ADMIN_PASSWORD_HASH` | Yes for provisioning only | Generate bcrypt hash locally; remove after provisioning |
| `SESSION_SECRET` | Yes | Generate a unique random secret of at least 32 bytes |
| `IP_HASH_SECRET` | Yes | Generate a separate random secret of at least 32 bytes |
| `GEOIP_DATABASE_PATH` | Deployment-dependent | External `.mmdb` path if enabling GeoIP; otherwise may be empty |
| `BASE_URL` | Yes | Set to the final public HTTPS Render service URL |
| `COOKIE_SECURE` | Yes | Set to `true`; production validation rejects false |
| `TRUSTED_PROXIES` | Deployment-dependent | Only set after verifying exact Render peer IP/CIDR values |
| `EVENT_RETENTION_DAYS` | Choose intended value | Optional in schema; application default is `30` |
| `RATE_LIMIT_PER_MINUTE` | Choose intended value | Optional in schema; application default is `60` |

`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
`APP_PORT`, and `GEOIP_DATABASE_DIR` are local production-Compose inputs, not
Render web-service settings. Do not set Render's URLs to Compose service names
such as `postgres` or `redis`.

### Generating secrets and admin credentials

Generate `SESSION_SECRET` and `IP_HASH_SECRET` independently on a trusted
local machine with Node's cryptographic random generator. Run the following
command twice and use a different output each time:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Do not reuse development values. Paste the two independent values directly
into Render's secret environment fields; do not save them in the repository.

For initial admin provisioning, choose the production admin username and
password, then generate a bcrypt hash locally with the project's `bcryptjs`
dependency using cost 12. Supply the password through a local environment
variable or another method that does not place it in shell history or command
arguments, and print/copy only the resulting hash. For example, after setting
`ADMIN_PASSWORD` securely in the local shell (not on the command line), run:

```powershell
node -e "require('bcryptjs').hash(process.env.ADMIN_PASSWORD, 12).then(console.log)"
```

Remove the local `ADMIN_PASSWORD` variable afterward. The bcrypt hash is
temporary provisioning input, not a runtime credential.

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

## Trusted proxy and visitor IP

The client-IP service reads `X-Forwarded-For`, `CF-Connecting-IP`, and
`X-Real-IP` only when the direct socket peer matches an explicit IP or IPv4
CIDR in `TRUSTED_PROXIES`. It does not use Express's blanket `trust proxy`
setting. With `TRUSTED_PROXIES` empty, forwarded headers are ignored and the
socket peer address is used.

Do not set `TRUSTED_PROXIES=*` or guess a Render proxy range. Before enabling
forwarded visitor IPs, establish the actual direct peer address/range used by
the deployed Render Web Service from provider documentation/support and a
carefully controlled deployment check. Enter only those exact trusted
addresses/CIDRs. Until verified, leaving the setting empty is the conservative
spoof-resistant choice, but visitor identity/rate limiting may then be based
on the platform proxy peer rather than the end visitor; validate this behavior
before production evaluation use. If Render does not provide a stable,
documented trusted-proxy range suitable for this check, record the limitation
and do not broaden trust to arbitrary senders.

## First deployment sequence

1. Create the Render PostgreSQL service and keep its connection URL private.
2. Create the Render Key Value service and obtain its connection URL.
3. Confirm the selected web-service plan supports a persistent disk; attach
   one for GeoLite2 or explicitly choose to run without GeoIP.
4. Create a Render Web Service connected to this Git repository; choose Docker
   deployment and keep the repository's existing `Dockerfile` as the build
   file. Do not override its Node start command.
5. Configure `NODE_ENV`, `COOKIE_SECURE`, the eventual HTTPS `BASE_URL`, and
   provider-generated `DATABASE_URL` and `REDIS_URL`. Add independently
   generated `SESSION_SECRET` and `IP_HASH_SECRET`; do not put values in Git.
6. Set `ADMIN_USERNAME` to the chosen production username. Create and retain
   the password securely, generate its bcrypt hash locally, and configure
   `ADMIN_PASSWORD_HASH` temporarily for initial provisioning.
7. Configure `/health` as the health-check path and confirm the service exposes
   the port supplied through Render's `PORT`.
8. Supply the GeoLite2 file through the approved external process and configure
   its mounted path, if GeoIP is enabled.
9. Verify the selected Render plan/UI can run `npm run db:migrate` as a
   pre-deploy command with the configured `DATABASE_URL`. If it cannot, arrange
   a one-time Render Shell execution after the web-service environment is
   configured and before relying on the app. Do not run migrations yet as part
   of this preparation checklist.
10. Deploy the Web Service. **This sequence has not yet been executed.**
11. Verify the Render health check and public `/health` response.
12. After migrations have succeeded, use the Web Service's Render Shell and
    configured production environment to run `npm run admin:provision` once.
    The provisioner connects through `DATABASE_URL`, validates the bcrypt hash,
    refuses to overwrite an existing username, and prints no password/hash.
13. Remove `ADMIN_PASSWORD_HASH` from persistent service environment
    configuration after provisioning; retain `ADMIN_USERNAME`.
14. Log in to the dashboard.
15. Create a project and enter its customer allowed origin(s).
16. Create a rule and test its evaluation.
17. Test a redirect rule using a controlled destination.
18. Load the SDK from the Render service hostname and test evaluation from an
    allowed customer origin.

Do not consider the deployment complete until these steps, including the
provider-specific GeoLite2 persistence and delivery checks, have been performed
and verified.
