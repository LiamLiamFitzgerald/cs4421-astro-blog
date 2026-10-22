# Runbook

What to do when something is wrong with the deployed site, and how to rehearse
it. Architecture and decisions are in `architecture.md` and `adr/`.

## Where to look

| Question | Where |
| --- | --- |
| Is it up? | `GET /api/live` (process up), `GET /api/ready` (can serve; 503 names the failing check) |
| What is it doing? | CloudWatch dashboard `AppLambdaStack-health` (link: `DashboardUrl` output of the deploy) |
| What went wrong? | CloudWatch Logs, the function's log group: one JSON line per request and error |
| Is it up from outside AWS? | Actions, **Uptime check** (hourly while the `SITE_URL` variable is set) |

## When an alarm fires

Every alarm emails the `ALARM_EMAIL` address (ADR-015) when it fires and when it
recovers.

| Alarm | Likely cause | First step |
| --- | --- | --- |
| Errors / ServerErrors | A release crashing or answering 500 | If a deploy is running, CodeDeploy rolls it back by itself. Otherwise filter the logs for `"statusCode":500` and `"unhandled server error"` |
| Throttles | Concurrency limit reached | Check traffic on the dashboard; raise reserved concurrency only if it is real traffic |
| Slow | Cold starts or a slow route | Compare p50 and p95 on the dashboard; find slow `route`s in the request log by `latencyMs` |
| EdgeErrors | CloudFront cannot reach the function, or it is failing | Check ServerErrors first; if that is quiet, check the function URL output directly |
| BrowserErrors | A front-end bug | Filter the logs for `"client error"` and group by `context` |
| GameLogProblems | A damaged save or a broken rule of the game (ADR-014) | Replay the report (below) and write a regression test |

### Replaying a game from a report

1. In CloudWatch Logs, filter for `"client error"` and the `gameId`, or for
   `play:salvaged` / `play:invariant`.
2. Copy the log line (or just its `eventLog`) into a file, say `report.json`.
3. Run `npx jiti scripts/replay-report.ts report.json`. It prints how far the
   game replays and the first problem, and exits 1 if there is one.
4. Copy the events into a test under `src/lib/games/catan-play/`, watch it fail,
   fix the rule, and open a PR as usual.

## Deploying and rolling back

All from Actions, **App Environment (Lambda)**, Run workflow:

- `deploy`: builds, deploys as a canary (10% for 5 minutes), then runs
  `scripts/smoke-test.sh` against the site. If an alarm fires during the canary,
  CodeDeploy moves traffic back and CloudFormation undoes the release.
- `rehearse`: the same, then always destroys the stack.
- `destroy`: removes the stack. Clear the `SITE_URL` variable too, or the uptime
  check will report the site as down.
- To roll back by hand, revert the change on `develop` (or `main`) and deploy
  again. The previous image is rebuilt from the reverted code.

## The rollback drill (ADR-016)

Proves that a bad release is stopped. Run **App Environment** with `drill`:

1. Deploys the current code (the good release) and smoke-tests it.
2. Records which Lambda version the `live` alias points at.
3. Deploys the same code with `ROLLBACK_DRILL=fail-requests`, which makes pages
   and the API answer 500 while the probes stay healthy, and sends traffic to the
   site throughout the canary.
4. Expects that deploy to **fail**: the ServerErrors alarm fires, CodeDeploy
   stops the canary and CloudFormation rolls back. If the broken deploy
   succeeds, the drill fails.
5. Checks the `live` alias is back on the good version without the drill flag,
   prints the CodeDeploy deployment status, and smoke-tests the site again.

It leaves the good release running. Expect about 15 minutes and a few cents.

**Evidence to keep** in `docs/evidence/`: the run's summary page, the CodeDeploy
deployment showing "Stopped" with a rollback, the ServerErrors alarm history on
the dashboard, and the alarm email.
