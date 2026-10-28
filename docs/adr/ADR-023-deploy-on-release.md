# ADR-023: Deploy both sites when a release is created

- **Status:** Proposed (2026-10-28)
- **Deciders:** Liam Fitzgerald
- **Issue:** #157

## Context

Both sites were deployed only by hand (App Environment and Deploy Static Site).
That meant the live site could lag behind the latest release, or be deployed
from an unreleased state. Releases already exist as the "ready" signal: GitFlow
merges `develop` into `main`, and release-please turns that into a versioned
release with a changelog.

## Decision

1. **A release deploys itself.** When release-please creates a release on
   `main`, the same workflow run deploys the SSR site (App Environment,
   `deploy`) and the static site from that release commit.
2. **The deploy workflows are called directly** (`workflow_call`) rather than
   triggered by the release event, because a release created with the built-in
   `GITHUB_TOKEN` does not start other workflows (GitHub prevents loops).
3. **Nothing else deploys automatically.** Pushes to `develop`, and pushes to
   `main` that only open or update the release PR, deploy nothing.
4. **Manual runs stay** for rollbacks (deploying an older tag), drills, revive
   and destroy.

## Consequences

- The live site is always the latest release; the changelog says what is on it.
- Each deploy still goes through the canary, the smoke test and automatic
  rollback (ADR-010, ADR-015, ADR-016).
- Releasing now spends a little AWS money each time; the budget kill switch
  remains the ceiling (ADR-019).
- A failed deploy does not undo the release: the release exists, the site stays
  on the previous version (the canary rolls back), and a manual deploy retries.
