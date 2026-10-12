# ADR-005: Layered verification strategy

- **Status:** Proposed (2026-10-07)
- **Deciders:** Liam Fitzgerald
- **Related:** ADR-003, ADR-004

## Context

Tests that merely run do not show that they would catch a bug. The project needs
evidence that the workflow keeps quality up as the code changes.

## Decision

Use four complementary checks, all run in CI:

1. **Example tests (BDD, Vitest):** one scenario per acceptance criterion, in the
   Feature > Scenario > `it('given ...')` shape.
2. **Property-based tests (fast-check):** invariants over many generated games,
   for example replaying a log always gives the same state; an award is never
   held by two players; total points equal base points plus awards.
3. **Mutation testing (Stryker) on `src/lib/core` and `src/lib/games`:** a
   threshold on the mutation score shows the tests detect real faults.
4. **Architecture rules (dependency-cruiser):** the layer rules from ADR-004.

Each is introduced on its own branch and PR, starting as report-only where it
could block unrelated work, then becoming a required check once stable.

## Consequences

**Positive**

- Strong, explainable evidence of quality for the project defence.
- Property tests find edge cases that hand-written examples miss.
- Mutation score exposes tests that pass without checking anything.

**Negative**

- Longer CI time; mutation testing is slow, so it may run only on changes to the
  core or on a schedule.
- More tooling to learn and keep up to date.
