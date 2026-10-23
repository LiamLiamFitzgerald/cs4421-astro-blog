# ADR-017: Install Playwright's browser without system packages, and cache it

- **Status:** Proposed (2026-10-22)
- **Deciders:** Liam Fitzgerald
- **Issue:** #120

## Context

The `validate` job installed the browser with
`npx playwright install --with-deps chromium`. `--with-deps` runs `apt-get` as
root on every run. The CI log showed:

- every library headless Chromium needs was already on the GitHub runner
  ("already the newest version");
- what it did install was about 26 MB of Japanese, Chinese, Thai and Unifont
  fonts plus `xvfb`, the virtual display used for headed browsers;
- the Ubuntu mirror ran at about 350 kB/s with retries (`Ign:` lines), so the
  step took several minutes, most of the job.

The tests run headless and use only Latin text, so they need neither the fonts
nor `xvfb`.

## Decision

1. Install with `npx playwright install chromium`, without `--with-deps`.
2. Cache `~/.cache/ms-playwright` with `actions/cache`, keyed on the runner OS
   and the installed `@playwright/test` version. On a cache hit the install step
   is skipped.
3. Read the version from the installed package, so a Dependabot bump changes the
   key and downloads the matching browser with nothing edited by hand.

## Consequences

- The install step drops from minutes to seconds on a cache hit, and to about
  half a minute on a miss, with no dependency on the Ubuntu mirror.
- **Risk:** a future runner image could drop a library Chromium needs. The e2e
  step would then fail to launch the browser with a clear "missing library"
  error; the fix is to restore `--with-deps` or install that one package.
- Tests could not render CJK or Thai text correctly. None do today; a test that
  needs them must install the fonts.

## Alternatives considered

- **Keep `--with-deps` and cache only the browser.** Still pays for `apt-get`,
  which was the slow part.
- **Run the job in Microsoft's Playwright container image.** Everything is
  preinstalled, but the image tag must match the package version, which needs an
  extra job to compute, and pulling the image costs about a minute every run.
  Worth revisiting if the runner ever lacks a library.
- **Drop browser tests from CI.** They are the only check that the pages work in
  a real browser, and they have caught real bugs.
