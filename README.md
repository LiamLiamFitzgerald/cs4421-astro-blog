# Catan Tracker and Game

A site for all things Catan, built as the cumulative project for
CS4421 DevOps. An event-sourced game core with enforced architecture rules,
automated checks on every pull request, a container image, infrastructure as
code and versioned releases.

# Main features
-a random board generator (with in build balancing)
-A simple score tracker 
-A single screen game

-Coming soon a multiplayer game, with room and individual controller for each players device

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
curl http://localhost:4321/api/health
```

## Commands

| Command                 | What it does                                          |
| :---------------------- | :---------------------------------------------------- |
| `npm run dev`           | Dev server with live reload                           |
| `npm run build`         | Production build into `dist/`                         |
| `npm run lint`          | ESLint                                                |
| `npm run check`         | Astro and TypeScript type check                       |
| `npm run arch`          | Architecture (dependency) rules, see ADR-004          |
| `npm run test:unit`     | Unit, BDD-style and property-based tests (Vitest)     |
| `npm run test:e2e`      | Browser tests against the built server (Playwright)   |
| `npm run test:mutation` | Mutation testing of the domain code (Stryker)         |

## Layout

```
src/lib/games/catan   game rules: decide / evolve, pure TypeScript
src/lib/app           application layer and ports (EventStore)
src/lib/adapters      EventStore adapters (memory, browser storage)
src/lib/observability logging and health
src/pages             routes, including /api/health
e2e/                  Playwright tests
cdk/                  AWS infrastructure (CDK)
docs/                 architecture, ADRs, handbook, evidence
```

## Documentation

- [Architecture](docs/architecture.md) and [decision records](docs/adr/)
- [Handbook](docs/handbook.md): branching, commits, releases, running the app
