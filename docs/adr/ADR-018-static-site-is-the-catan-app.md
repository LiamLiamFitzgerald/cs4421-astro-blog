# ADR-018: The static site is the Catan app, built as plain files

- **Status:** Proposed (2026-10-23)
- **Deciders:** Liam Fitzgerald
- **Issue:** #122
- **Revises:** ADR-001's retirement of the S3 static deploy.

## Context

The module asks for two deployments: a static site and a server-rendered one.
ADR-001 moved the app to server mode and retired the S3 + CloudFront static
deploy, which still served the old Astro template. Its stack read `dist/`, which
in server mode holds `client/` and `server/` folders rather than a website.

Nothing about the game needs a server. Games are event-sourced and stored in the
browser (ADR-004, ADR-006); the pages only render markup. The server adds the
`/api` endpoints: health, liveness, readiness and browser error reports
(ADR-001, ADR-013, ADR-014).

## Decision

1. **One codebase, two builds.** `npm run build` is unchanged (server mode, Node
   adapter). `npm run build:static` sets `SITE_MODE=static`, and the Astro config
   then uses `output: 'static'` with no adapter. A small script runs it so the
   command works in PowerShell as well as on CI.
2. **No `/api` in the static build.** Astro would freeze the GET endpoints into
   files (a health check with the build time in it), which would be misleading.
   An integration deletes `dist/api/` after a static build.
3. **No error reports from the static site.** The browser code is told at build
   time (`PUBLIC_STATIC_SITE`) and skips sending; the report code is removed from
   the static bundle. Errors still go to the console and are still shown to the
   player with Try again.
4. **Pretty URLs at the edge.** S3 has no directory indexes, so a CloudFront
   Function rewrites `/catan` and `/catan/` to `/catan/index.html`; anything with
   a file extension passes through. A missing key (403 from the private bucket)
   shows the site's `404.html` with status 404.
5. **The stack is only defined for a static build** (when `dist/index.html`
   exists), so CDK can neither fail on a clean checkout nor upload the server
   build by mistake. The bucket stays private (CloudFront origin access control)
   and HTTPS-only.
6. **The Deploy Static Site workflow** builds the static version, deploys, and
   checks `/`, `/catan` and a missing page.

## Consequences

- Both required links show the same Catan app; the difference between them is
  how it is served, which is the point of the comparison.
- The static site has no health endpoints, no request logs and no error
  reporting, so it cannot be monitored the way the server deploy is (ADR-015,
  ADR-016). That gap is the honest trade-off of static hosting.
- 35 of 37 browser tests pass against the static build served with the same
  rewrite rule. The two that do not are the ones that wait for an error report
  to reach the server, which is the intended difference.
- The game page markup is now built once instead of per request. That is fine
  because it has no per-request content.

## Alternatives considered

- **Keep the static site as the old template.** It would satisfy "a static site"
  on paper but show nothing of the project.
- **Prerender the pages in the server build and publish `dist/client`.** One
  build for both, but the server deploy would then serve prebuilt pages too and
  stop being a meaningful server-rendered example.
- **Point the static site at the server's API.** Error reports would work, but
  the static site would depend on the server being deployed, which defeats having
  a standalone static deployment.
