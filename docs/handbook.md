# Project Handbook

How work is done in this repository. Decisions and their reasoning live in
`docs/adr/`; this page is the day-to-day reference.

## Branching

The project uses GitFlow (see [ADR-002](adr/ADR-002-gitflow-branching-model.md)).

- `main`: tagged releases only.
- `develop`: integration branch and the default target for pull requests.
- `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`: short-lived
  branches created from an up-to-date `develop`.
- `release/<version>` and `hotfix/<name>`: merge into both `main` and `develop`.

### Releases

Versions and changelog are automated by release-please
(`.github/workflows/release-please.yml`). When commits land on `main`, it opens or
updates a release PR that bumps `package.json` and `CHANGELOG.md` from the
Conventional Commit history (`feat` = minor, `fix` = patch, `!` = major).
Merging that PR creates the tag and GitHub release. This is why commit messages
are linted. The repository setting "Allow GitHub Actions to create pull requests"
must be enabled.

Start every piece of work with:

```
git checkout develop
git pull
git checkout -b feat/<name>
```

## UI and design system

Every page uses `src/layouts/Layout.astro`. Colours, type, spacing, radii and
shadows are tokens in `src/styles/tokens.css`; shared buttons, fields, notices,
panels and dialogs are classes in `src/styles/base.css`; icons come from
`src/ui/icons.ts` (via `Icon.astro` on the server). Use these rather than
writing new values. See [ADR-007](adr/ADR-007-design-system.md).

## Commits

Conventional Commits: `type(scope): summary`, for example
`fix(ci): exclude cdk from root lint and type check`.

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`.

The format is enforced twice: a local `commit-msg` hook (husky + commitlint, set
up by `npm install`) rejects a bad message before the commit is made, and CI
checks every commit in a pull request. Rules: `commitlint.config.mjs`.

## Pull requests

1. Push the branch and open a PR into `develop` (check the base branch).
2. Describe what changed and why.
3. Wait for the `validate` check to pass.
4. Merge only when the check is green. Delete the branch afterwards.

Reviews: the project has one contributor, so the required number of approvals
is **0**. The pull request and the passing check are the control, not a second
reviewer. This is a deliberate choice for a solo project and would change on a
team.

## Continuous integration

Workflow: `.github/workflows/ci.yml` (name `CI`, job `validate`), run on pull
requests into `main` and `develop`, on Node 22:

1. `npm ci`
2. Commit messages are checked with commitlint (Conventional Commits)
3. `npm run lint`: ESLint
4. `npm run check`: `astro check` (type check)
5. `npm run arch`: dependency-cruiser checks the layer rules in
   `.dependency-cruiser.cjs` (see ADR-004)
6. `npm run test:unit`: Vitest (unit, BDD-style and property-based tests)
7. `npm run build`, then `npm run test:e2e`: Playwright plays the scoreboard in
   Chromium against the production server; the report is uploaded on failure
8. The container image is built, and the CDK app is tested and synthesised

Mutation testing (`npm run test:mutation`, Stryker) is slow, so it runs weekly and
on demand in `.github/workflows/mutation.yml`, not on every PR. It fails below a
mutation score of 75% (thresholds in `stryker.config.json`); the HTML report is
uploaded as a workflow artifact. Run the same commands locally before pushing. The `cdk/` folder is a separate
package with its own dependencies and is excluded from the root lint and type
check.

## Running the app

The site runs in server mode on the Astro Node adapter (ADR-001).

- `npm run build` then `node dist/server/entry.mjs` (set `PORT` and `HOST`).
- `GET /api/health` returns `{ status, uptime, timestamp }`.
- `GET /api/live` (liveness) returns `{ status: "ok" }` and checks nothing else.
- `GET /api/ready` (readiness) runs the named checks and returns 200 `{ status: "ready", checks }`, or 503 `not-ready` naming the failing checks.
- **Rooms** (`/rooms`, ADR-019, ADR-021): on the shared screen choose how many
  are playing and create a room; the board shows the code, a join link and the
  open seats (the host can add seats or remove empty ones). Each player opens the
  link, or types the code on the Rooms page, and enters their name; they take the
  next free seat. The host starts once at least 2 have joined. Phones keep a seat
  token and the board a host token in `localStorage`, so reloading keeps both. Moves are pushed: each
  screen holds a WebSocket (API Gateway in AWS, a local stand-in when
  `ROOMS_PUSH_LOCAL_PORT` is set, as the e2e tests do) that says "changed", and
  the screen fetches its own view. Without a socket, screens poll (fast while
  moves happen, slow when quiet, never while hidden). The static site shows that
  rooms need the server version.
- Rooms API (ADR-019), all on `/api/rooms`, `cache-control: no-store`:
  `GET ?code=ABCD&since=V` returns the view (send the seat token as
  `x-room-token` to see your own cards; `{unchanged, version}` when nothing is
  new); `POST {action:"create", seats}` (returns the host token),
  `{action:"join", code, name}`, `{action:"resize", code, seats}` and
  `{action:"start", code}` (host token), and `{action:"command", code, command}`
  (seat token). Errors are 400, 401, 403,
  404, 409, 413, 422 (rules, with words and the violation), 429 or 503, never 500.
  Rooms live in DynamoDB when `ROOMS_TABLE` is set, otherwise in memory.
- Every request writes one JSON log line to stdout (timestamp, level, route,
  method, statusCode, latencyMs). An unhandled server error also writes an
  `"unhandled server error"` line with the error name and message.
- Unexpected errors in visitors' browsers are sent to `POST /api/client-errors`
  and logged at level `error` with `"message":"client error"`, `context`,
  `errorName`, `errorMessage` and `page`. To find them, filter the logs (or
  CloudWatch) for `"client error"`. Reports are validated and capped at 32 KB;
  a page sends at most ten.
- An error during a game also logs `gameId`, `gameLogVersion`, `gameEvents` and
  `eventLog` (ADR-014). The log holds the typed player names, the board and every
  move, including hidden cards; it holds no account or contact details. To
  reproduce a bug: find the line by `gameId`, save the line (or its `eventLog`)
  to a file, run `npx jiti scripts/replay-report.ts file.json`, then copy the
  events into a regression test. Contexts `play:salvaged` (a damaged save was cut
  back) and `play:invariant` (a rule of the game was broken) are bugs to fix, not
  player mistakes.
- Alarms and the dashboard (ADR-015): the deploy output prints `DashboardUrl`.
  To get alarm emails, set the repository variable `ALARM_EMAIL` (Settings,
  Secrets and variables, Actions, Variables), deploy, then click the
  confirmation link AWS emails you. The canary rolls back on Lambda errors or on
  any 5xx in the request log.
- After every deploy, `scripts/smoke-test.sh SITE_URL` checks liveness,
  readiness, the pages and an asset; run it by hand the same way. The hourly
  **Uptime check** workflow runs it while the `SITE_URL` repository variable is
  set. `docs/runbook.md` covers alarms, replaying a game, rollback and the
  rollback drill (`drill` in App Environment, ADR-016).
- `docker build -t catan-app .` builds the production image; CI builds it too.
  `docker build --target lambda .` adds the AWS Lambda Web Adapter for Lambda
  (pulled from public.ecr.aws, which rate-limits anonymous pulls; CI retries).
- Production runs on AWS Lambda (`cdk/lib/app-lambda-stack.ts`, ADR-010): the
  same image, with the AWS Lambda Web Adapter forwarding requests to the Node
  server, behind a function URL and CloudFront. The adapter waits for
  `/api/health` before serving.
- Deploys publish a new Lambda version and CodeDeploy shifts the `live` alias
  to it as a canary (10% for 5 minutes). If the error alarm fires, CodeDeploy
  rolls back to the previous version automatically.
- Manual rollback: point the alias back at the previous version
  (`aws lambda update-alias --function-name <name> --name live --function-version <n>`),
  or redeploy the previous commit.
- Its lifecycle is the **App Environment** workflow
  (`.github/workflows/app-environment.yml`), manual only: `deploy`, `destroy`, or
  `rehearse` (deploy, smoke-test `/api/health`, then always destroy).
- Cost: close to zero while idle (no load balancer or always-on task); requests
  fall within the Lambda and CloudFront free allowances at this traffic.
- The ECS Fargate stack (`cdk/lib/app-service-stack.ts`, ADR-001) is commented
  out of `cdk/bin/cdk.ts` but kept and tested, so it can be restored.
- The static site (ADR-018) is the same Catan app built as plain files:
  `npm run build:static` writes `dist/` with no server and no `/api`. Actions,
  **Deploy Static Site** publishes it to S3 behind CloudFront and prints
  `StaticSiteUrl`. Games work and are saved in the browser exactly as on the
  server deploy; browser errors stay in the console because there is no server
  to report to. Preview locally with any static file server on `dist/`.

## Branch protection

Configured as a repository ruleset ("branch protection") that targets `main` and
the default branch, `develop`:

- Require a pull request before merging (0 approvals).
- Require the `validate` status check to pass.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Do not allow administrators to bypass these rules.

**Status:** enabled on 2026-10-12 (the ruleset was first created on 2026-10-07 without
a required check; the `validate` check was added on 2026-10-12). The check matters:
before it was required, a broken lockfile and a dropped `arch` script both reached
`develop` through merges. Do not use "Update branch" on PRs that change
`package.json` or the lockfile, because it text-merges the lockfile; rebase and
run `npm install` instead. Add a screenshot of the ruleset to `docs/evidence/`.

## Testing conventions

Tests are written BDD-style, with scenarios derived from the acceptance
criteria (Given / When / Then):

```ts
describe('Feature: base victory points', () => {
  describe('Scenario: tally a player', () => {
    it('given 2 settlements and 1 city, returns 4', () => { /* ... */ });
  });
});
```

Write the test from the acceptance criteria first, then the implementation.

- Unit tests sit next to the code (`*.test.ts`); domain rules also get
  property-based tests with fast-check.
- Browser behaviour is tested in `e2e/` with Playwright, against the built
  server (`npm run build && npm run test:e2e`). Locally, set
  `PLAYWRIGHT_CHROMIUM_PATH` to use an installed Chromium, or run
  `npx playwright install chromium` once.
- Every user-visible failure path (refused command, storage failure, blocked
  storage) has an e2e test.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/lib/` | Game core, app layer, adapters and observability (no DOM) |
| `src/lib/games/catan-play/` | Rules for playing on the site (ADR-008): board graph, setup, turns, building |
| `src/ui/` | Browser code: board drawing, icons, play and scoreboard controllers, feedback, error reporting |
| `src/pages/`, `src/components/`, `src/layouts/`, `src/styles/` | Routes, shared components and the design system |
| `e2e/` | Playwright browser tests |
| `cdk/` | AWS CDK (TypeScript) infrastructure app |
| `docs/adr/` | Architecture decision records |
| `docs/retrospectives/` | Sprint retrospectives |
| `docs/evidence/` | Screenshots and other proof for assessed tasks |
| `.github/workflows/` | CI workflows |
