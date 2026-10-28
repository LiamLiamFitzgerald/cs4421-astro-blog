# ADR-002: Adopt GitFlow as the branching model

- **Status:** Accepted (2026-10-07)
- **Deciders:** Liam Fitzgerald
- **Related:** Sprint 1 retrospective (`docs/retrospectives/sprint-1-retrospective.md`)

## Context

The project is built across several weekly labs and has to show each week's
DevOps practice in one repository. Early work showed what happens without a
clear branching model: pull requests for the lint, test and CI tooling were
merged into `main` instead of an integration branch, and `develop` pointed at
an unrelated, stale history.

The project needs a model that:

- keeps `main` stable and releasable at all times;
- gives feature work a place to integrate and be tested before release;
- makes rollbacks and emergency fixes a defined, rehearsable path (Week 4 drill).

## Decision

Use GitFlow (Driessen, 2010):

| Branch | Purpose | Branches from | Merges into |
| --- | --- | --- | --- |
| `main` | Tagged releases only | n/a | n/a |
| `develop` | Integration of finished work | `main` (initially) | `release/*` |
| `feat/*` | One feature or ticket | `develop` | `develop` via PR |
| `fix/*`, `chore/*` | Small fixes and maintenance | `develop` | `develop` via PR |
| `release/*` | Stabilise a release | `develop` | `main` **and** `develop` |
| `hotfix/*` | Emergency fix to production | `main` | `main` **and** `develop` |

Supporting rules:

- All changes reach `main` and `develop` through pull requests; no direct pushes.
- `develop` is the repository's default branch so new PRs target it by default.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:` ...).
- Required status check on both long-lived branches: the `validate` job in the
  `CI` workflow (lint, type check, unit tests).

## Consequences

**Positive**

- A clear home for every kind of change, and a defined path for hotfixes that
  also back-merges to `develop` so fixes are not lost.
- Fits the Week 4 rollback drill: the broken change travels
  `develop` -> `release/*` -> `main`, and the revert goes through `hotfix/*`.
- `main` always reflects what was released.

**Negative**

- More branches and more merges than trunk-based development; heavy for a
  one-person project.
- Release and hotfix branches must be merged twice (to `main` and `develop`);
  forgetting the back-merge causes drift.
- A wrong PR target is easy to pick, as Sprint 1 showed. Mitigation: set
  `develop` as the default branch and enforce branch protection.
