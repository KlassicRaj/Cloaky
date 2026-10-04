The primary goal is a **reliable, production-capable API and rule engine** that can comfortably handle at least **10,000 API requests per day**, while keeping the frontend intentionally simple.

Do not over-engineer authentication or the frontend. Spend engineering effort on the correctness, reliability, performance, security, and testability of the API, rule engine, frequency system, GeoIP handling, SDK, and redirect functionality.

---

# 1. Product concept

A website owner/admin creates a project, configures rules in a basic dashboard, and embeds a small JavaScript SDK on their site.

When a visitor loads a page:

1. The SDK collects browser/device information.
2. The SDK sends the information to the backend.
3. The backend determines the visitor's IP and IP-based location.
4. The backend evaluates the project's rules in priority order.
5. The backend checks the frequency restriction.
6. The backend returns a decision.
7. The SDK performs the configured action.

The system must support:

- redirect
- opening a new tab
- no action
- frequency limits
- IP-based GeoIP
- server-side GeoIP location
- fullscreen prompt
- server-side redirect endpoint
- event logging
- project/rule management
- rule testing

The API and rule evaluation functionality are the most important parts of the application.

---

# 2. Technology stack

## Frontend

Use only:

- HTML
- CSS
- Vanilla JavaScript

Do NOT use:

- React
- Vue
- Angular
- Next.js
- Tailwind
- Bootstrap
- any frontend framework

The frontend should be:

- basic
- clean
- responsive
- functional
- easy to modify

Do not spend excessive engineering effort on visual design.

Server-rendered HTML templates are acceptable.

Use EJS if templates are needed.

---

# 3. Backend

Use:

- Node.js 20+ LTS
- JavaScript
- Express.js

Use a clean backend architecture with separate:

- routes/controllers
- services
- database layer
- validation
- middleware
- rule engine
- frequency service
- GeoIP service
- event logging
- caching

Do not put business logic directly inside Express route handlers.

The backend is the core of the application and should be designed to remain maintainable as functionality grows.

---

# 4. Expected API load

The application must comfortably handle:

**10,000 requests/day**

10,000 requests/day is not a high average throughput requirement, but the implementation must also tolerate reasonable bursts.

Do not optimize prematurely for massive-scale distributed infrastructure.

A single Node.js application instance with PostgreSQL and Redis should be sufficient for the MVP.

The implementation should nevertheless avoid obvious performance problems.

In particular:

- Do not query PostgreSQL unnecessarily on every evaluation request.
- Cache project rules.
- Keep rule evaluation in memory.
- Use Redis for frequency state.
- Use Redis for rate limiting.
- Use PostgreSQL for persistent data.
- Use asynchronous event logging.
- Use database indexes where appropriate.
- Use connection pooling.
- Avoid blocking synchronous operations in the request path.
- Avoid unnecessary external API calls during evaluation.

The evaluation endpoint should be lightweight enough that 10K requests/day is comfortably within its capabilities.

Do NOT introduce:

- Kubernetes
- microservices
- Kafka
- RabbitMQ
- complicated distributed systems
- load balancers
- serverless architecture

unless they become necessary later.

---

# 5. Authentication

Authentication is deliberately low priority.

There is only **one client/admin using this application**.

Do NOT spend significant engineering effort on:

- OAuth
- JWT refresh tokens
- complex session management
- multi-tenant authentication
- RBAC
- social login
- SSO

A simple ID/password login is sufficient.

Implement:

- login
- logout
- simple credential verification
- protection of the admin/dashboard pages

The authentication implementation should still avoid storing the password in plaintext.

Use a basic hashed password stored in environment variables or a small users table.

The purpose of authentication here is simply to prevent unauthorized people from accessing the dashboard.

**Do not allow authentication complexity to interfere with the API implementation.**

---

# 6. Database

Use:

- PostgreSQL
- Knex.js
- `pg`

PostgreSQL stores:

- users
- projects
- rules
- events

Use JSONB for rule conditions.

Use proper indexes.

Required indexes include:

```text
events(project_id, created_at)
rules(project_id, priority)

```

Use PostgreSQL connection pooling.

Do not use PostgreSQL as the frequency-state store.

---

# 7. Redis

Redis is required only for:

1. Frequency control
2. API rate limiting

Do not use Redis as the primary database.

Frequency state must use TTLs so Redis cannot grow indefinitely.

If Redis becomes unavailable:

**fail safe.**

The API must not repeatedly trigger a visitor's action.

Instead:

- return no-action
- provide an appropriate reason
- log the Redis failure
- keep the customer's website functioning

Redis operations for frequency control must be atomic.

Use:

- `SET NX EX`
- or Lua scripts
- or equivalent atomic Redis operations

Concurrent requests must never cause duplicate triggers.

---

# 8. Rule engine

Implement a dedicated:

```text
RuleEngine

```

The RuleEngine must not know about:

- Express
- HTTP requests
- PostgreSQL
- Redis
- dashboard UI

It should receive normalized visitor information and return a normalized decision.

Example input:

```javascript
{
    ip,
    geo,
    browser,
    os,
    device,
    language,
    timezone,
    screen
}

```

Example output:

```javascript
{
    matched: true,
    ruleId: "rule_123",
    action: "redirect",
    url: "https://example.com",
    fullscreen: "prompt"
}

```

Rules are evaluated by priority.

**First matching rule wins.**

This behavior must be clearly documented and thoroughly tested.

---

# 9. Rule conditions

Support:

- country
- region
- city
- IP address
- IP CIDR
- browser
- OS
- device type
- language
- timezone
- screen width
- screen height

Device types:

- mobile
- desktop
- tablet

Operators:

- equals
- not equals
- contains
- starts with
- greater than
- less than
- CIDR match

Support:

```text
AND
OR

```

Example:

```json
{
    "operator": "AND",
    "conditions": [
        {
            "field": "geo.country",
            "operator": "equals",
            "value": "IN"
        },
        {
            "field": "device.type",
            "operator": "equals",
            "value": "mobile"
        }
    ]
}

```

---

# 10. Frequency control

This functionality must be preserved exactly.

Each rule has:

```text
frequency_enabled
frequency_seconds
frequency_mode

```

Modes:

### cooldown

First matching visit:

```text
trigger action
start cooldown

```

Subsequent matching visit inside cooldown:

```text
do not trigger
reason = frequency_limited

```

After cooldown:

```text
trigger again
restart timer

```

### return_after

First matching visit:

```text
record visit
do not trigger
reason = first_visit_recorded

```

Return after configured duration:

```text
trigger action
restart timer

```

Visitor identity:

```text
HMAC-SHA256(IP, server_secret)

```

Combine the identity with:

- project ID
- rule ID

Never store the raw IP in Redis.

Redis keys should effectively identify:

```text
project + rule + hashed visitor identity

```

Use TTLs.

Concurrent requests must not double-trigger.

---

# 11. GeoIP

Determine IP server-side.

Never determine the IP client-side.

Use:

- MaxMind GeoLite2 `.mmdb`
- Node.js `maxmind` package

Create:

```text
GeoIPService

```

Return where available:

- country
- region
- city
- latitude
- longitude
- ASN

Support trusted proxies.

Only trust:

- `X-Forwarded-For`
- `CF-Connecting-IP`

when the request came through a configured trusted proxy.

Do not allow arbitrary clients to spoof their IP through these headers.

IP location is approximate and must never be presented as GPS-level accuracy.

---

# 12. Browser SDK

The SDK must remain a small standalone JavaScript file.

Example integration for local development:

```html
<script src="http://localhost:3000/sdk.js"></script>
<script>
  VisitorRouting.init({
    projectKey: "tester12340"
  });
</script>

```

In deployment, load the SDK from the Visitor Routing server's public hostname (for example, `https://routing.example.com/sdk.v1.js`). The SDK captures its own script URL while it loads and sends evaluation requests to that server origin, even when the customer page is hosted on a different origin. It does not derive the API host from the customer page URL.

The SDK collects:

- browser
- OS
- device type
- language
- timezone
- screen width
- screen height
- page URL

Send this to:

```text
POST /api/v1/evaluate

```

The SDK must:

- never determine the IP
- never contain secrets
- support async loading
- use try/catch around all functionality
- never break the customer's website
- use sessionStorage where appropriate to avoid unnecessary repeated calls
- support long cache headers
- use a versioned SDK filename

---

# 13. Browser geolocation

Browser geolocation is intentionally out of MVP scope. Visitor location is determined server-side using GeoIP. The SDK does not request browser location permission.

Do not expose browser geolocation as a supported SDK, rule-builder, or Test Rules input. Legacy internal parsing may remain for backward compatibility, but the production request path must not collect or use browser-provided coordinates.

---

# 14. URL actions

Support:

```text
open_new_tab
redirect
none

```

### open_new_tab

Use:

```javascript
window.open(...)

```

If the browser blocks the popup:

- do not bypass the popup blocker
- retain the pending action
- execute it after the visitor's first click/tap

### redirect

Use:

```javascript
location.replace(url)

```

### none

Perform no action.

---

# 15. Server-side redirect

Implement:

```text
GET /r/{project_key}

```

This endpoint must:

1. identify the project
2. determine visitor information
3. evaluate rules
4. apply frequency
5. return a real HTTP 302 when appropriate

The same rule/frequency logic should be used by the API and redirect endpoint.

Do not duplicate the rule engine.

---

# 16. URL security

Only allow:

```text
http://
https://

```

Reject:

```text
javascript:
data:
vbscript:
file:

```

and all other unsafe schemes.

Validate URLs:

1. when creating a rule
2. when updating a rule
3. when evaluating the rule

Do not rely only on frontend validation.

---

# 17. Fullscreen

Each rule has:

```text
fullscreenMode = off
fullscreenMode = prompt

```

Respect browser restrictions.

Fullscreen cannot automatically happen after redirect.

When `fullscreenMode` is `prompt`, set the `_fs=1` query parameter on the validated destination URL, preserving other query parameters and the URL fragment. Use the same marker for redirects and open-new-tab actions. When fullscreen mode is `off`, leave the destination unchanged.

```text
https://example.com/page?foo=bar&_fs=1#section

```

to the destination if appropriate.

On the destination page, if the SDK is installed:

show:

```text
View full screen

```

The visitor must click the button.

Use the standard API, with WebKit fallback where applicable, only inside the button's click/tap handler:

```javascript
document.documentElement.requestFullscreen()

```

A rejected request dismisses the prompt without affecting the page. Do not request fullscreen automatically.

Never:

- bypass the user gesture requirement
- block Escape
- use keyboard lock
- fake browser fullscreen UI

If fullscreen is unsupported, hide the prompt.

---

# 18. CORS / allowed origins

Each project has an allowed-origin list.

For:

```text
POST /api/v1/evaluate

```

the backend must check the request origin against that project's allowed origins.

Only allowed origins receive CORS headers.

Do not use:

```text
*

```

for CORS.

Requests from unauthorized origins must be rejected.

---

# 19. Rate limiting

Rate-limit public endpoints using Redis.

The exact rate can be configurable through:

```text
RATE_LIMIT_PER_MINUTE

```

Rate limiting should prevent abuse without interfering with normal customer traffic.

---

# 20. Rule caching

This is important for API performance.

Do not query PostgreSQL for the project's rules on every evaluation request.

Cache project rules in application memory.

Invalidate the relevant cache whenever:

- a project changes
- a rule is created
- a rule is updated
- a rule is deleted
- a project is disabled

The evaluation path should generally be:

```text
HTTP request
      ↓
project lookup/cache
      ↓
visitor normalization
      ↓
RuleEngine
      ↓
FrequencyService
      ↓
decision
      ↓
async event logging
      ↓
response

```

Avoid unnecessary database access.

---

# 21. Event logging

Store:

- project ID
- rule ID
- timestamp
- matched
- triggered
- reason
- action
- country
- region
- device type
- browser
- OS

Do not store raw IP addresses.

Events should be written asynchronously so event logging does not significantly increase evaluate latency.

If event logging fails:

**do not fail the visitor's evaluation request.**

The event failure should be logged separately.

Support configurable retention.

---

# 22. Dashboard

The dashboard only needs to be functional and basic.

Pages:

- Login
- Dashboard
- Create Project
- Project Details
- Rules
- Rule Builder
- Integration
- Events
- Test Rules
- Account

Use:

```text
HTML
CSS
Vanilla JavaScript

```

The UI should prioritize usability rather than visual polish.

---

# 23. Test Rules

Provide a dashboard tool where the administrator can enter:

- country
- region
- city
- IP
- browser
- OS
- device
- language
- timezone
- screen dimensions

Then execute the same RuleEngine logic.

Show:

- matching rule
- action
- destination
- fullscreen
- frequency result
- reason

Support:

```text
simulate returning visitor

```

with:

```text
time since last visit

```

Demo mode must NOT modify production Redis frequency state.

---

# 24. API endpoints

Authentication:

```text
POST /api/auth/login
POST /api/auth/logout

```

Projects:

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
DELETE /api/projects/{project_id}

```

Rules:

```text
GET    /api/projects/{project_id}/rules
POST   /api/projects/{project_id}/rules
PATCH  /api/projects/{project_id}/rules/{rule_id}
DELETE /api/projects/{project_id}/rules/{rule_id}

```

Public:

```text
POST /api/v1/evaluate
GET  /sdk.js
GET  /sdk.v1.js
GET  /r/{project_key}

```

Events:

```text
GET /api/projects/{project_id}/events

```

Testing:

```text
POST /api/projects/{project_id}/test-rules

```

Use Zod for API input validation.

---

# 25. Example response

Successful trigger:

```json
{
    "matched": true,
    "triggered": true,
    "rule_id": "rule_123",
    "action": "redirect",
    "url": "https://example.com",
    "fullscreen": "prompt",
    "reason": null
}

```

Frequency limited:

```json
{
    "matched": true,
    "triggered": false,
    "rule_id": "rule_123",
    "action": "redirect",
    "url": "https://example.com",
    "fullscreen": "prompt",
    "reason": "frequency_limited"
}

```

First return-after visit:

```json
{
    "matched": true,
    "triggered": false,
    "rule_id": "rule_123",
    "action": "redirect",
    "url": "https://example.com",
    "fullscreen": "prompt",
    "reason": "first_visit_recorded"
}

```

---

# 26. Project structure

Use:

```text
app/
  server.js

  routes/
    auth.js
    projects.js
    rules.js
    evaluation.js
    events.js

  controllers/
    auth.js
    projects.js
    rules.js
    evaluation.js
    events.js

  services/
    rule-engine.js
    frequency.js
    geoip.js
    device-detection.js
    evaluation.js
    event-logging.js
    cache.js

  db/
    database.js
    migrations/

  middleware/
    auth.js
    cors.js
    rate-limit.js
    error-handler.js

  schemas/
    auth.js
    projects.js
    rules.js
    evaluation.js

  templates/
    login.ejs
    dashboard.ejs
    project.ejs
    rules.ejs
    integration.ejs
    events.ejs
    test-rules.ejs

  static/
    css/
    js/

  sdk/
    sdk.v1.js

  tests/

  package.json
  knexfile.js
  Dockerfile
  docker-compose.yml
  .env.example
  README.md

```

---

# 27. Testing

Prioritize API and rule-engine testing over frontend testing.

Test:

- rule CRUD
- AND logic
- OR logic
- priority
- first-match-wins
- country matching
- browser matching
- device matching
- IP matching
- CIDR matching
- no-match
- invalid URL
- redirect 302
- CORS
- rate limiting
- cooldown
- return_after
- timer restart
- concurrent frequency requests
- Redis failure
- hashed IP Redis keys
- cache invalidation
- trusted proxy handling
- SDK error isolation
- fullscreen behavior

The RuleEngine should have strong unit-test coverage.

Use:

```text
Vitest
Supertest

```

---

# 28. Performance requirements

The application should comfortably support:

```text
10,000 requests/day

```

with room for bursts.

Do not attempt to build a massive distributed architecture.

Focus on these performance principles:

### Evaluation path

Avoid:

```text
request → PostgreSQL → rules → PostgreSQL → frequency → response

```

Prefer:

```text
request
  ↓
cached project/rules
  ↓
normalize visitor
  ↓
RuleEngine
  ↓
Redis frequency check
  ↓
response
  ↓
async event logging

```

### Database

Use:

- PostgreSQL connection pooling
- indexes
- parameterized queries
- efficient queries
- JSONB where appropriate

### Redis

Use:

- atomic operations
- TTLs
- minimal round trips

### Node.js

Do not perform blocking filesystem or CPU-heavy work inside the request path.

Load the GeoIP database once and reuse it rather than reading the `.mmdb` file for every request.

---

# 29. Configuration

Create:

```text
.env.example

```

with:

```text
NODE_ENV=development
PORT=3000

DATABASE_URL=

REDIS_URL=

ADMIN_USERNAME=
ADMIN_PASSWORD_HASH=

IP_HASH_SECRET=
GEOIP_DATABASE_PATH=

BASE_URL=

COOKIE_SECURE=false

TRUSTED_PROXIES=

EVENT_RETENTION_DAYS=30

RATE_LIMIT_PER_MINUTE=60

```

Do not commit real secrets.

---

# 30. Docker

Provide:

```text
docker-compose.yml

```

with:

- application
- PostgreSQL
- Redis

The application must run with:

```bash
docker compose up --build

```

---

# 31. Important architectural priority

The priority order for development is:

1. **Evaluation API**
2. **RuleEngine**
3. **FrequencyService**
4. **GeoIP**
5. **SDK**
6. **Redirect endpoint**
7. **Event logging**
8. **Caching**
9. **CORS/origin validation**
10. **Rule management API**
11. **Basic dashboard**
12. **Simple authentication**

Do NOT spend disproportionate time on:

- login UI
- authentication architecture
- visual design
- animations
- frontend frameworks
- multi-user permissions

The application has one client/admin.

The API must be the strongest and most thoroughly tested part of the system.

---

# 32. Failure-safety requirement

The most important requirement is:

**An infrastructure problem must not cause the customer's website to break.**

Examples:

### Redis unavailable

Return:

```text
no action

```

rather than repeatedly triggering redirects.

### Event logging unavailable

Continue returning the evaluation response.

### Browser geolocation

The SDK never requests browser geolocation. Continue using server-side GeoIP and other available visitor information.

### Fullscreen unsupported

Hide the fullscreen prompt.

### Popup blocked

Use the first-click fallback.

### GeoIP lookup unavailable

Continue evaluation with missing GeoIP fields rather than crashing the API.

### SDK/API unavailable

The customer's website must continue functioning normally.

The SDK must therefore have defensive error handling around the entire evaluation process.

---

# 33. Final verification

Before declaring the MVP complete:

1. Start PostgreSQL, Redis, and the Node.js application.
2. Login through the basic dashboard.
3. Create a project.
4. Configure an allowed origin.
5. Create:
   - Country = India
   - AND Device = Mobile
   - redirect
   - frequency = 10 minutes
   - cooldown
   - fullscreen = prompt
6. Load the SDK from a test HTML page.
7. Send a matching visitor.
8. Confirm the redirect decision.
9. Reload immediately.
10. Confirm:
    ```text
    frequency_limited

    ```
11. Simulate a return after 10+ minutes.
12. Confirm another trigger.
13. Test `return_after`.
14. Confirm first visit records without triggering.
15. Confirm returning visitor triggers.
16. Confirm timer restarts.
17. Test simultaneous requests.
18. Confirm only one request triggers.
19. Stop Redis.
20. Confirm the API fails safe.
21. Test an unauthorized Origin.
22. Confirm it is rejected.
23. Test unsafe destination URLs.
24. Confirm they are rejected.
25. Test `/r/{project_key}`.
26. Confirm a real HTTP 302.
27. Test fullscreen prompt.
28. Confirm fullscreen requires a click.
29. Test an unsupported browser.
30. Confirm graceful behavior.
31. Check dashboard event logs.
32. Modify a rule.
33. Confirm cached rules are invalidated.
34. Run the complete automated test suite.
35. Verify the application can comfortably process at least 10,000 requests/day under realistic load.

---

# 34. What not to do

Do not:

- remove any required functionality
- silently simplify the RuleEngine
- remove frequency control
- remove Redis
- remove GeoIP
- remove event logging
- remove CORS/origin protection
- remove the SDK
- remove the redirect endpoint
- remove fullscreen support
- add fingerprinting
- add cross-site tracking
- bypass browser security restrictions
- use client-side IP detection
- build unnecessary microservices
- introduce Kubernetes
- introduce a frontend framework
- over-engineer authentication

Build a **simple frontend and a robust backend**.

The MVP should be easy to run, easy to maintain, and capable of comfortably handling the required 10K requests/day while preserving all core product functionality.

how can i make this using AI and Free