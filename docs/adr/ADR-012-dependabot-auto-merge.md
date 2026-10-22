# ADR-012: Auto-merge safe Dependabot updates

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #108

## Context

Dependabot opens a pull request per dependency bump. With three ecosystems
(root npm, `cdk` npm, GitHub Actions) that was eleven open PRs after a few weeks,
each needing a manual merge, plus an "Update branch" click whenever another PR
merged first (the ruleset requires branches to be up to date and `validate` to
pass). Reviewing them by hand adds no information: the test suite is the review.

## Decision

1. **Enable auto-merge (squash) on Dependabot PRs for patch and minor updates.**
   GitHub merges them only when the required `validate` check is green.
2. **Never auto-merge major updates.** They can change behaviour and need a
   human to read the release notes (for example `actions/checkout` 4 to 7).
3. **Keep PRs current.** When `develop` changes, a job comments
   `@dependabot rebase` on any open Dependabot PR that is behind, so CI reruns.
4. **A manual run sweeps existing PRs** (`workflow_dispatch`), so the backlog
   needs no clicking.
5. The workflow acts only on PRs authored by Dependabot, with the narrowest
   permissions it needs (`contents: write`, `pull-requests: write`).

## Consequences

- Routine updates land without effort, and a failing bump never merges.
- Safety rests on the tests: 400+ unit tests, e2e tests and mutation testing.
  A malicious or subtly broken release that passes them would reach `develop`.
- Changes reach `main` only through a release-please PR that a human merges, so
  nothing ships unreviewed.
- Rebase comments rely on Dependabot honouring a comment made by the Actions
  bot. If it does not, stale PRs need a manual `@dependabot rebase`; this is to
  be verified on the first run.
- Requires "Allow auto-merge" to be enabled in the repository settings (done).
