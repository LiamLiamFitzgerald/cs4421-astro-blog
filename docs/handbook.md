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

Start every piece of work with:

```
git checkout develop
git pull
git checkout -b feat/<name>
```

## Commits

Conventional Commits: `type(scope): summary`, for example
`fix(ci): exclude cdk from root lint and type check`.

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`.

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
2. `npm run lint`: ESLint
3. `npm run check`: `astro check` (type check)
4. `npm run test:unit`: Vitest

Run the same commands locally before pushing. The `cdk/` folder is a separate
package with its own dependencies and is excluded from the root lint and type
check.

## Branch protection (target configuration)

Apply to both `main` and `develop`:

- Require a pull request before merging (0 approvals).
- Require the `validate` status check to pass.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Do not allow administrators to bypass these rules.

**Status:** to be configured. Update this section once it is enabled and add
screenshots to `docs/evidence/`.

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

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Astro site (pages, components, content) |
| `cdk/` | AWS CDK (TypeScript) infrastructure app |
| `docs/adr/` | Architecture decision records |
| `docs/retrospectives/` | Sprint retrospectives |
| `docs/evidence/` | Screenshots and other proof for assessed tasks |
| `.github/workflows/` | CI workflows |
