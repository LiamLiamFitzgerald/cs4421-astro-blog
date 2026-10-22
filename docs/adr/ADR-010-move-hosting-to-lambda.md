# ADR-010: Move hosting from ECS Fargate to AWS Lambda

- **Status:** Proposed (2026-10-21)
- **Deciders:** Liam Fitzgerald
- **Issue:** #102
- **Supersedes:** the hosting decision (points 3 and 6) of ADR-001. The rest of
  ADR-001 (server mode, the Docker image, the health endpoint, JSON logs) stands.

## Context

ADR-001 chose ECS Fargate behind an Application Load Balancer. It works, but it
bills by the hour whether or not anyone visits: roughly $0.06/hour, about
$1.40/day, mostly the load balancer and public IPv4 addresses. That forced a
manual deploy/rehearse/destroy workflow and a nightly safety-net destroy.

The project's AWS budget then became unreliable:

- The account's free plan was **automatically upgraded to a paid plan on
  29 September 2026**, with no action from the account owner.
- A **$100 promotional credit issued on 28 September expired on 29 September**
  with $99.90 unused, so there is no credit to absorb hourly charges.
- A **billing support case is open** with AWS to explain the upgrade and
  restore the credit. Until it is resolved, every hour a Fargate stack exists is
  paid out of pocket.
- The nightly destroy job had also been failing at the credential step, so the
  safety net could not be relied on.

The app itself is light: games are stored in the visitor's browser (ADR-006,
ADR-008), so the server mostly renders pages, answers `/api/health` and logs
browser error reports. That is a workload that suits per-request pricing.

## Decision

1. **Run the same container image on AWS Lambda** (`cdk/lib/app-lambda-stack.ts`).
   The AWS Lambda Web Adapter is copied into the image and turns invocations
   into ordinary HTTP requests to the Node server. No Astro adapter change. The
   adapter lives in a separate `lambda` stage of the Dockerfile on top of the
   normal app image, so `docker build .` (local and CI) never pulls it; the CDK
   stack builds `--target lambda`.
2. **Keep the safety properties Fargate gave us:**
   - *Health:* the adapter's readiness check waits for `/api/health`; the
     workflow smoke-tests it after every deploy.
   - *Safe deploys and automatic rollback:* each deploy publishes a version, and
     CodeDeploy moves the `live` alias with a 10%-for-5-minutes canary. A
     CloudWatch alarm on errors rolls it back automatically.
   - *Manual rollback:* point the alias at the previous version.
   - *Logs:* stdout still goes to CloudWatch Logs (one-week retention).
   - *Infrastructure as code:* CDK, with assertion tests and `cdk synth` in CI.
3. **Comment out the Fargate stack** in `cdk/bin/cdk.ts`. Its code and tests are
   kept so it can be restored without rewriting.
4. **Drop the nightly destroy schedule.** An idle Lambda stack has no hourly
   charge; deploys stay manual.

## Consequences

- An idle environment costs close to nothing, and at this traffic requests fall
  within the Lambda and CloudFront free allowances. The demo environment can be
  left up for the defence without watching the clock.
- **Cold starts:** the first request after a quiet period takes a second or two
  longer while the container starts.
- **Health is judged by errors, not by a load balancer:** there is no ongoing
  health check, so a version that starts but serves wrong pages is only caught
  by the smoke test or the error alarm.
- **A canary needs traffic:** with very few visitors the 5-minute canary may see
  no requests, so the smoke test is the main signal during a deploy.
- Fewer moving parts to explain than ECS (no VPC, load balancer, task
  definition), but also less of the container-orchestration platform on show.
  The comparison is kept as part of the project's record in this ADR and
  ADR-001.

- **The adapter comes from public.ecr.aws, which rate-limits anonymous pulls.**
  The first CI run failed with `429 Too Many Requests` because GitHub's shared
  runners hit that limit, and retries with a back-off did not get through.
  Controls: the adapter is only in the `lambda` stage, so the normal image
  build (a required CI step) never pulls it; CI still tries the Lambda build
  but as a non-blocking step; and the deploy workflow signs in to ECR Public
  first, which raises the limit, so the build that matters is authenticated.

## Alternatives considered

- **Keep Fargate and destroy it between demos.** Works, but every forgotten
  hour is billed while the account has no credit, and the safety net was
  failing. Rejected for now; the stack can be re-enabled.
- **Lambda with Astro's serverless adapter instead of the Web Adapter.** Avoids
  the extension, but production would run different code from the local server
  and the CI browser tests. Rejected.
- **AWS App Runner.** Simpler than ECS but still bills for provisioned capacity
  while idle. Rejected for cost.
- **Static hosting only (S3 and CloudFront).** Cheapest, but loses
  `/api/health`, the request logs and `/api/client-errors`. Rejected.
