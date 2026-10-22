# ADR-015: Alarms, notifications and a dashboard for the Lambda stack

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #115
- **Builds on:** ADR-010 (Lambda hosting, canary rollback), ADR-013 (liveness and
  readiness) and ADR-014 (game log in error handling).

## Context

ADR-010 gave the Lambda stack one alarm: Lambda `Errors` on the `live` alias,
used by CodeDeploy to roll a canary back. It notified nobody, and it missed most
of what can go wrong:

- **A handled 500 is not a Lambda error.** The Web Adapter returns the app's 500
  as a normal response, so the function "succeeded". A release that answers every
  request with a 500 would pass the canary. This is the most important gap.
- Throttling, slow responses and errors at CloudFront were not watched.
- Browser error reports and the damaged-save and broken-rule reports from
  ADR-014 were only lines in a log nobody was told to read.
- There was no single place to see whether the site is healthy.

The app already writes one JSON line per request and per error, so most of these
signals can be counted from the logs without changing the app.

## Decision

1. **Metrics from the logs.** CloudWatch metric filters on the function's log
   group count, under the `CatanTracker` namespace:
   - `Http5xx`: request lines with `statusCode >= 500`
   - `ClientErrors`: `"client error"` lines (browser reports)
   - `GameLogProblems`: reports with context `play:salvaged` or `play:invariant`
2. **Alarms**, all treating missing data as fine (no traffic is not a fault):

   | Alarm | Metric | Fires when |
   | --- | --- | --- |
   | Errors | Lambda `Errors` on `live` | 1 or more in a minute |
   | ServerErrors | `Http5xx` | 1 or more in a minute |
   | Throttles | Lambda `Throttles` | 1 or more in 5 minutes |
   | Slow | Lambda `Duration` p95 | over 5 s for 10 minutes |
   | EdgeErrors | CloudFront `5xxErrorRate` | over 5% in 5 minutes |
   | BrowserErrors | `ClientErrors` | over 10 in 5 minutes |
   | GameLogProblems | `GameLogProblems` | 1 or more in 5 minutes |

3. **The canary rolls back on `Errors` or `ServerErrors`.** That closes the
   handled-500 gap. The log group is shared by the old and new versions during a
   canary, so a 500 from either rolls back; with one version taking 90% of
   traffic, a false rollback is the safer mistake.
4. **Notifications.** Every alarm sends both its alarm and its recovery to one SNS
   topic. The email address comes from the `ALARM_EMAIL` repository variable at
   deploy time and is never committed. Without it the topic has no subscriber:
   alarms still show on the dashboard and still roll back. AWS sends a
   confirmation email that must be clicked once.
5. **Dashboard.** `AppLambdaStack-health` shows alarm status, requests with the
   edge 5xx rate, p50/p95 latency, errors and throttles, and browser reports with
   game-log problems. Its link is a stack output.
6. Log retention stays at one week (already set in ADR-010), which also bounds
   how long the player names in attached game logs are kept (ADR-014).

## Consequences

- A broken release is caught whether it crashes or answers with 500s, and the
  rollback drill (#116) can demonstrate it.
- Problems reach a person, and the dashboard is one link for the defence.
- **Cost:** seven alarms, three custom metrics and one dashboard fit inside the
  CloudWatch free tier (10 alarms, 10 custom metrics, 3 dashboards). Each extra
  alarm beyond that costs about $0.10 a month.
- Thresholds are guesses for a low-traffic student site. With little traffic one
  bad request can fire an alarm; that is acceptable here and should be revisited
  if traffic grows.
- CloudFront metrics exist only in us-east-1. The stack is deployed there; moving
  region would need the edge alarm in a separate us-east-1 stack.
- Readiness is not yet the adapter's readiness check, and there is no check from
  outside AWS; both are part of #116.

## Alternatives considered

- **Alarm only on Lambda `Errors`.** Misses handled 500s, which is how most app
  bugs show up.
- **Change the app to throw on 500s.** Would turn them into Lambda errors, but at
  the cost of distorting the app for the platform.
- **CloudWatch Synthetics canaries for everything.** Real browser checks, but
  billed per run; a scheduled GitHub Actions check (#116) gives most of the value
  for free.
- **A third-party monitoring service.** More features, another account and
  another set of keys; not justified for this project.
