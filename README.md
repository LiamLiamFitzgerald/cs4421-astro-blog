# Catan Tracker

Settlers of Catan in the browser: play on one device, keep score of a real game,
or open a **room** with the board on a shared screen and everyone playing from
their phone. Built as the cumulative project for CS4421 DevOps. The game is the
vehicle; the project is the engineering around it.

## Architecture highlights

Each choice below has a decision record in [docs/adr](docs/adr/) that says why,
what it costs, and what was rejected.

**A game core that is easy to trust and change**

- **Event sourcing (ADR-004).** A game is an ordered log of facts; the state is
  a pure fold over it. Saving, undo-free replay, reconnecting screens and bug
  reproduction all fall out of that one idea.
- **Pure rules, no framework (ADR-004, ADR-008).** `decide` and `evolve` are
  plain TypeScript with no I/O, clock or randomness (randomness is passed in and
  stored as a fact, ADR-011). The same rules run in the browser, on the server
  and in tests, unchanged.
- **Ports and adapters, enforced (ADR-004).** Storage is an interface with memory,
  browser and DynamoDB adapters. Moving a game from `localStorage` to a shared
  database (rooms, ADR-019) needed a new adapter, not a rules change.
  `npm run arch` fails the build if a layer reaches where it should not.
- **Tests that check the tests.** BDD-style unit tests, property tests over
  random games, rule invariants checked after every move in every test
  (ADR-014), shared contract tests every storage adapter must pass, browser tests
  on the built server, and mutation testing that fails below 75%.

**Change that ships safely**

- **GitFlow with Conventional Commits.** Feature branches into `develop`,
  releases into `main` via release-please, commit messages linted in CI, branch
  rules requiring the `validate` check. Safe Dependabot updates merge
  themselves once CI is green; majors wait for a person (ADR-012).
- **Infrastructure as code (AWS CDK)** with its own tests, including the cost
  ceilings (ADR-010, ADR-019).
- **Canary deploys with automatic rollback (ADR-010, ADR-015).** New versions get
  10% of traffic for 5 minutes; Lambda errors or any 5xx in the request log roll
  them back. A repeatable drill proves it (ADR-016).

**Running it without a budget**

- **Pay-per-use hosting (ADR-010).** The server is a container on Lambda behind
  CloudFront: idle costs close to nothing, and the Fargate/ALB version is kept,
  tested, for when an always-on server is worth paying for.
- **Hard cost ceilings (ADR-019).** The rooms table is provisioned inside the
  free allowance (overuse throttles rather than bills), and a budget kill switch
  turns the site off at $5 a month; `revive` turns it back on.
- **The same app as a static site (ADR-018)** for zero-server hosting on S3.

**Knowing when something is wrong**

- **Liveness and readiness probes (ADR-013)**, a post-deploy smoke test and an
  hourly uptime check from outside AWS (ADR-016).
- **Alarms, email and a dashboard (ADR-015)** for errors, latency, throttling,
  browser errors and broken game logs.
- **Errors carry the game (ADR-014).** A browser error report includes the game's
  event log, so a bug seen once can be replayed (`scripts/replay-report.ts`) and
  turned into a regression test. Damaged saves are cut back to the last good move
  instead of losing the game.

**A game people enjoy**

- **Rooms (ADR-019, ADR-021):** a lobby, names typed on phones, the server as
  arbiter so nobody can cheat or see another player's cards, and moves pushed
  over WebSockets with polling as the fallback.
- **Action-first, accessible UI (ADR-020):** only the moves you can make, colour
  coded, with big-moment banners and a leaderboard; WCAG AA contrast and full
  reduced-motion support.

## Performance

Measured with `npm run bench` (room views over the real DynamoDB adapter on a
metered table) and `scripts/load-test.ts` (bots playing rooms over HTTP; the
**Load test** workflow runs it against the deployed site). Local numbers, one
Node process, 27 October 2026:

| Log length (events) | Build one view | Read units per full view | View size |
| ------------------: | -------------: | -----------------------: | --------: |
|                  50 |         1.9 ms |                        8 |    4.5 KB |
|                 150 |         3.8 ms |                       11 |    6.7 KB |
|                 300 |         7.9 ms |                       15 |   10.1 KB |
|                 600 |         9.3 ms |                       24 |   16.7 KB |

**What the numbers show**

- **The app code is not the bottleneck.** One Node process served 50 rooms of
  bots (about 420 requests a second) with a p95 under 50 ms and no errors.
- **DynamoDB reads are.** Every change makes every screen re-read the room's
  whole log, so one realistic room (5 screens, a move every few seconds) needs
  about **25 read units a second against 10 provisioned**. Burst credit hides
  this for the first minutes of a game; after that it throttles.
- **Polling alone fills the table.** A "nothing new" check costs 3 read units;
  five screens polling every 1.5 s use all 10. It only stays healthy while push
  notices are arriving (then screens poll every 30 s).
- **One room is about 12,900 requests an hour** (about 8 per move), so with
  polling the Lambda free tier covers roughly 75 room-hours a month.
- **Every CSS and script request reaches Lambda** on the server-rendered site,
  because CloudFront caching is off for everything there; the static site caches.
- **The per-address limits** cap a load test from one machine at about two rooms
  (they are sized for a household); tests raise them with `ROOMS_LIMIT_MULTIPLIER`.

**Next fixes, in order:** read only new events (each Lambda copy caches the
log, and eventually consistent reads halve the cost), cache `/_astro/*` at
CloudFront, then re-measure.

## Quick start

Requires Node 22.12 or newer.

```sh
npm ci
npm run dev            # http://localhost:4321
```

Production-like run (the same server the container uses):

```sh
npm run build
HOST=127.0.0.1 PORT=4321 node dist/server/entry.mjs
curl http://localhost:4321/api/ready
```

## Commands

| Command                 | What it does                                         |
| :---------------------- | :--------------------------------------------------- |
| `npm run dev`           | Dev server with live reload                          |
| `npm run build`         | Server build into `dist/`                            |
| `npm run build:static`  | The same app as plain files for the static site      |
| `npm run lint`          | ESLint                                               |
| `npm run check`         | Astro and TypeScript type check                      |
| `npm run arch`          | Architecture (dependency) rules, see ADR-004         |
| `npm run test:unit`     | Unit, BDD-style and property-based tests (Vitest)    |
| `npm run test:e2e`      | Browser tests against the built server (Playwright)  |
| `npm run test:mutation` | Mutation testing of the domain code (Stryker)        |
| `npm run bench`         | Room view benchmark: time, DynamoDB read units, size |
| `npm run load-test`     | Load test a running site (`--url`, `--scenario`)     |

## Layout

```
src/lib/games         game rules: decide / evolve, pure TypeScript
src/lib/app           application layer and ports (EventStore, RoomRepository)
src/lib/adapters      adapters: memory, browser storage, DynamoDB, push
src/lib/observability logging, health, readiness
src/pages             routes, including /api/rooms and the health probes
src/ui                browser controllers (no rules)
e2e/                  Playwright tests
scripts/              replay a bug report, benchmark, load test
cdk/                  AWS infrastructure (CDK) and its tests
docs/                 architecture, ADRs, handbook, runbook, evidence
```

## Documentation

- [Architecture](docs/architecture.md) and [decision records](docs/adr/)
- [Handbook](docs/handbook.md): branching, commits, releases, running the app
- [Runbook](docs/runbook.md): alarms, replaying a game, rollback, custom domain
