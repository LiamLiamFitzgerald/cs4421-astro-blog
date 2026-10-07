# ADR-003: Model matches as an event log (decide / evolve)

- **Status:** Proposed (2026-10-07)
- **Deciders:** Liam Fitzgerald

## Context

The tracker must score Catan games: base victory points, plus the Largest Army
and Longest Road awards, which can move between players or be lost. The award
rules depend on history (the current holder wins ties), so a simple function from
counts to a score is not enough once awards move. Players also make mistakes, so
the tracker needs undo. The project also wants a design that other games and
variants can reuse, and that is easy to test.

## Decision

Model a match as an append-only list of **events**. Keep two pure functions per
game: `decide(state, command)` returning events or a rule violation, and
`evolve(state, event)` returning the next state. Current state, scores, award
holders and the winner are computed by folding the events; they are not stored.

## Alternatives considered

- **Mutable state object updated in place.** Simplest to start, but undo, audit
  and bug reproduction need extra machinery, and award history is awkward.
- **Store scores and totals directly.** Cheap to read, but loses why a score is
  what it is and makes corrections error-prone.

## Consequences

**Positive**

- Undo and replay are trivial; any past game can be rebuilt from its log.
- Rules become Given (events) / When (command) / Then (events or violation)
  tests, matching the BDD convention.
- Statistics are additional folds over the same events, with no schema change.
- Determinism makes property-based testing effective (ADR-005).

**Negative**

- More concepts (commands, events, projections) than the problem strictly needs.
- Reading current state costs a fold. For game-sized logs this is negligible.
- Changing an event's shape later needs a versioning or migration approach.
  Mitigation: keep events small and add a `version` field early.
