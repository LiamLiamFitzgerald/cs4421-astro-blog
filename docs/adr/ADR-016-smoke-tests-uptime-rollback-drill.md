# ADR-016: Post-deploy smoke tests, an uptime check and a rollback drill

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #116
- **Builds on:** ADR-010 (canary deploys), ADR-013 (liveness and readiness) and
  ADR-015 (alarms).

## Context

Until now a deploy was judged by one `curl` of `/api/health`, which only shows
that the process started. Nothing checked the site from outside AWS once it was
up, and the automatic rollback had never been seen to work: a rollback that has
never been exercised is a hope, not a control.

## Decision

1. **One smoke test, `scripts/smoke-test.sh`.** It waits for `/api/ready`, then
   checks `/api/live`, `/api/ready`, `/api/health`, the home page, `/catan` and a
   stylesheet linked from it. It runs after every deploy and rehearsal, and is
   the same script the uptime check and the drill use.
2. **The Web Adapter's readiness check moves to `/api/ready`** (it was
   `/api/health`), so a release that is up but not ready gets no traffic.
3. **Uptime check from outside AWS.** A scheduled workflow runs the smoke test
   hourly against the `SITE_URL` repository variable. It runs only while that
   variable is set, because the site is destroyed between demos on purpose.
   GitHub emails the owner when a scheduled run fails.
4. **A repeatable rollback drill** (`drill` in the App Environment workflow).
   It deploys the good release, then the same code with
   `ROLLBACK_DRILL=fail-requests` under steady traffic, expects that deploy to be
   rejected, and checks that the `live` alias is back on the good version.
5. **Fault injection is in the app, off by default.** `drillFailsRequest`
   answers 500 for everything except the three probes. The probes stay healthy so
   the broken release passes readiness and takes canary traffic, which is what a
   real bad release would do. Only `cdk deploy -c rollbackDrill=true` sets the
   variable, and a normal deploy never has it (tested).

## Consequences

- A deploy is judged on what visitors use, not on whether the process started.
- The rollback is evidenced, and the drill can be rerun before the defence.
- The drill depends on the ServerErrors alarm from ADR-015 seeing enough 500s in
  the canary window. The workflow sends a request every 4 seconds for 10
  minutes; if AWS changes how quickly alarms evaluate, the drill may need more
  traffic or a longer window.
- Shipping fault-injection code is a small risk. It is a single exact-value check,
  unit tested, and set only through CDK context.
- The uptime check needs the variable maintained by hand; forgetting to clear it
  after `destroy` produces failure emails.
- **Free:** GitHub Actions minutes on a public repository, and the drill costs a
  few cents of Lambda and CloudWatch.

## Alternatives considered

- **Break the release by changing the code** (a commit that throws). Realistic,
  but it needs a throwaway branch each time and the broken commit lives in
  history. The flag drills the same path without either.
- **Break the release by failing readiness.** CodeDeploy would never send it
  traffic, so it would test the readiness check, not the rollback.
- **CloudWatch Synthetics for the uptime check.** A real browser and AWS-native,
  but billed per run and it only runs while the stack exists; the GitHub check is
  free and independent of AWS.
- **Run the drill on every deploy.** Doubles deploy time for little gain; it is
  run before releases and before the defence instead.
