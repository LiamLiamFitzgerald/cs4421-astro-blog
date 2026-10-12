# ADR-004: Layered architecture with enforced dependency rules

- **Status:** Proposed (2026-10-07)
- **Deciders:** Liam Fitzgerald
- **Related:** ADR-003

## Context

Later weeks add server rendering, containers and monitoring. If the game logic
imports framework or storage code, every one of those changes risks breaking the
rules. Architecture described only in prose tends to erode.

## Decision

Use ports and adapters with four layers: pure domain (`src/lib/core`,
`src/lib/games/*`), application (`src/lib/app`), adapters (`src/lib/adapters`),
and delivery (`src/pages`, `src/components`). Dependencies point inward only.
Storage is reached through an `EventStore` interface with an in-memory adapter
first and others later.

Enforce the rules automatically with `dependency-cruiser` in CI, so a pull
request that, for example, imports a component from `src/lib/core` fails.

## Consequences

**Positive**

- The domain can be tested without Astro, a browser or a database.
- Swapping or adding storage (browser storage, a database) does not touch the rules.
- The architecture is checked on every PR, not just described.

**Negative**

- More folders and interfaces up front.
- A new tool and config to maintain; rules must be kept in step with the layout.
