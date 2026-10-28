# Sprint 1 Retrospective

- **Date:** 2026-10-07
- **Scope:** repository, branching and CI foundations for the CS4421 DevOps project
- **Format:** blameless. Each item states what happened, the root cause (a gap
  in process or tooling, not a person), and the fix.

## Summary

Sprint 1 set up the repository, the branching model, linting, testing and a CI
workflow. Most of the sprint's time went on repairing the foundations rather
than building on them. Every incident below was caught before it reached a
release, and each led to a concrete change in how work is done.

## What went well

- Problems were found by checking the repository state directly (branch
  history, CI behaviour) instead of trusting assumptions.
- The CI pipeline now runs lint, type check and unit tests on every pull
  request, and passes on the current `develop`.
- The project root is clean: `node_modules/` and the `.astro/` cache are no
  longer tracked and are covered by `.gitignore`.
- Fixes were made through branches and pull requests, with history preserved
  (a tag marks the old `develop`).

## Incidents

### 1. Two unrelated root histories; `develop` on the stale one

- **What happened:** the repository contained two histories with no common
  ancestor, and `develop` pointed at the stale one, so branches from it did not
  relate to `main`.
- **Root cause:** most likely the project was set up locally and on GitHub
  separately and the two histories were never reconciled. (Reconstructed after
  the fact; confirm before submitting.)
- **Fix:** tagged the old state as `backup/old-develop`, then reset `develop`
  to `origin/main` with `--force-with-lease`.
- **Lesson:** after the first push, check that every long-lived branch shares
  history with `main` (`git merge-base`).

### 2. Tooling PRs merged into `main` instead of `develop`

- **What happened:** the lint, test and CI tooling PRs (#7, #8, #9) were merged
  into `main`, bypassing the integration branch.
- **Root cause:** `main` was the default branch, so GitHub pre-selected it as
  the PR target, and nothing enforced the model.
- **Fix:** documented the model in ADR-002. Setting `develop` as the default
  branch and enabling branch protection are the preventive controls.
- **Lesson:** a convention that depends on remembering a dropdown will
  eventually be broken. Make the safe path the default.

### 3. Project committed inside a subfolder

- **What happened:** the Astro project lived in `my-astro-blog/` inside the
  repository, so `ci.yml` at the repository root could not find `package.json`.
- **Root cause:** the repository was created one level above the project
  folder. (Reconstructed after the fact; confirm before submitting.)
- **Fix:** flattened the project to the repository root (PR #10) and removed
  the workaround paths from the workflow.
- **Lesson:** create the repository at the project root.

### 4. `node_modules/` and `.astro/` committed

- **What happened:** roughly 9,590 dependency files were tracked in git,
  slowing every clone and checkout and polluting diffs.
- **Root cause:** no root `.gitignore` existed when the first commit was made.
- **Fix:** untracked both folders (`chore: stop tracking node_modules and .astro
  cache`) and added a root `.gitignore`.
- **Lesson:** add `.gitignore` before the first `git add`.

### 5. Syntax error in `eslint.config.ts`

- **What happened:** a stray duplicate `);` broke the lint configuration.
- **Root cause:** the file was committed without running the linter locally
  first, and CI did not yet exist to catch it.
- **Fix:** removed the duplicate. CI now runs the linter on every PR, which
  would have caught it.
- **Lesson:** run the same checks locally that CI will run.

### 6. CI pinned an unsupported Node version

- **What happened:** `ci.yml` used Node 20, but Astro 7 requires Node
  >= 22.12 and Vitest 5 requires ^22.12, ^24 or >= 26. The first real CI run
  would have failed.
- **Root cause:** the workflow was written before the dependency versions were
  checked against their `engines` fields.
- **Fix:** moved the workflow to Node 22.
- **Lesson:** read the `engines` field of key dependencies before choosing a
  runtime version.

### 7. Flatten PR merged before its CI fix was pushed

- **What happened:** the flatten PR was merged into `develop` while a separate
  commit repairing the workflow paths and Node version existed only locally,
  leaving `develop` with a workflow that would fail.
- **Root cause:** the flatten PR and the CI fix were intended to ship together
  but were separate units of work, and the order was not enforced.
- **Fix:** applied the fix as its own PR (#12) straight after.
- **Lesson:** do not merge a PR that leaves CI broken. Once branch protection
  requires a passing check, this cannot happen.

### 8. Root type check picked up the CDK app

- **What happened:** the first PR containing the `cdk/` app failed the Type
  check step with seven errors ("Cannot find module 'aws-cdk-lib'").
- **Root cause:** `astro check` and ESLint ran from the repository root and
  included `cdk/`, which has its own `package.json` and dependencies that the
  root install does not provide.
- **Fix:** excluded `cdk/` from the root `tsconfig.json` and ESLint ignores.
- **Lesson:** a nested package needs its own validation (`cdk synth` is planned
  in CI) and must be excluded from root-level tooling.

## What to change

| Action | Owner | Status |
| --- | --- | --- |
| Set `develop` as the default branch | Liam | To do |
| Enable branch protection on `main` and `develop` (see handbook) | Liam | To do |
| Add `cdk synth` to CI so infrastructure code is validated per PR | Liam | To do |
| Run lint, type check and tests locally before pushing | Liam | Ongoing habit |

## Evidence

Screenshots of a passing PR and a PR blocked by a failing check will be added
to `docs/evidence/` once branch protection is enabled.
