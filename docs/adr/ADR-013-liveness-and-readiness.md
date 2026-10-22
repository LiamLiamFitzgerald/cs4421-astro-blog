# ADR-013: Separate liveness and readiness endpoints

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #113
- **Extends:** ADR-001 (health endpoint) and ADR-010 (Lambda health checks).

## Context

ADR-001 added a single `GET /api/health` that always returns 200 while the
process is running. That answers "is it up?" but not "can it serve traffic?".
The two questions fail differently and are acted on differently:

- A failed liveness check means the process is broken; the fix is to restart or
  replace it.
- A failed readiness check means the process is fine but a dependency is not;
  restarting would not help, and traffic should simply wait or be held back.

Today the app has no dependencies, since games live in the visitor's browser
(ADR-006, ADR-008). Planned work (shared rooms, a database) will add one, and the
checks should already exist by then. Readiness is also what the canary deploy and
post-deploy smoke tests should be asking (ADR-010).

## Decision

1. **`GET /api/live`** returns `200 {"status":"ok"}`. It checks nothing else, so
   it can never fail because of a dependency.
2. **`GET /api/ready`** runs a list of named checks and returns `200` with
   `{"status":"ready","checks":[...]}`, or `503` with `not-ready` and each check's
   result. A check that returns false, throws or rejects counts as failing. All
   checks always run, so the response names every failure, not just the first.
3. **The first check, `rules-engine`,** confirms the game rules module loaded and
   can deal a valid 19-hex board. It is cheap and proves the build is usable.
4. **`GET /api/health` is unchanged,** so existing monitoring (the Lambda Web
   Adapter, the deploy smoke test) keeps working until it is moved over.
5. The check logic is a pure function taking a list of checks, in
   `src/lib/observability/readiness.ts`, so it is unit tested without a server.
   The endpoints are thin wrappers, covered by e2e tests.
6. All three endpoints send `cache-control: no-store`.

## Consequences

- Probes and alarms can target the right question. Rooms add a database check by
  appending one entry to the list.
- Readiness is deliberately shallow today; `rules-engine` proves little beyond a
  successful build. It is a placeholder that makes the structure real.
- Readiness checks run on every request, so they must stay cheap. Slow checks
  (a database round trip) will need a timeout and possibly caching.
- Three endpoints are slightly more to document and keep consistent. They are
  listed in `docs/handbook.md`.

## Alternatives considered

- **Keep one `/api/health`.** Simplest, but it cannot express "up but not ready".
- **Make `/api/health` do dependency checks.** A dependency outage would then look
  like a dead process and could trigger needless restarts or rollbacks.
- **Use the Lambda function alone as the check.** Lambda restarts failing
  invocations itself, so liveness matters less there, but the same endpoints
  serve the container build and give the smoke tests a clear target.
