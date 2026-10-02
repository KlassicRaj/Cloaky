# AI Development Rules

## General

- Read PROJECT.md before implementing functionality.
- PROJECT.md is the authoritative product specification.
- Do not silently remove or simplify requirements.
- Do not implement the entire application in one step.
- Work only on the requested phase/task.
- Do not implement future phases unless explicitly requested.

## Code Quality

- Prefer simple, maintainable code.
- Do not introduce unnecessary dependencies.
- Do not introduce microservices.
- Do not introduce Kubernetes.
- Do not introduce frontend frameworks.
- Keep business logic out of Express route handlers.
- Keep the RuleEngine independent from HTTP, PostgreSQL and Redis.

## Testing

- Every business-critical feature must have automated tests.
- Never delete or weaken a test merely to make the implementation pass.
- Run relevant tests after making changes.
- Do not mark a task complete while required tests are failing.

## Security

- Never hardcode secrets.
- Never store raw visitor IP addresses.
- Never trust client-provided IP addresses.
- Validate URLs server-side.
- Never use wildcard CORS for public evaluation requests.

## Documentation

After completing a task:

1. Update STATUS.md.
2. Update TODO.md.
3. Record important architectural decisions in DECISIONS.md.
4. Report which files were changed.
5. Report tests that were run.
6. Report any remaining problems.

## Git

Do not create commits unless explicitly requested.