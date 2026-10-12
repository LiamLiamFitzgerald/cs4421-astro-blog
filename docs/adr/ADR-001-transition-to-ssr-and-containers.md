# ADR-001: Move from a static site to SSR in a container on ECS Fargate

- **Status:** Proposed (2026-10-12)
- **Deciders:** Liam Fitzgerald

## Context

The site is built by Astro into static files and served from S3 behind
CloudFront. That cannot host the Catan tracker's server side: games must be
stored somewhere that survives a page reload (the event store from ADR-003), the
service needs a live health endpoint, and requests should be logged with
latency and status. A static build also freezes anything computed at request
time, such as process uptime.

The module also asks for a workflow that can be deployed, observed and rolled
back, so the runtime needs to be reproducible and identical on a laptop, in CI
and in AWS.

## Decision

1. Switch Astro to `output: 'server'` with the Node adapter in `standalone`
   mode.
2. Package the app as a Docker image (multi-stage build, non-root user, only the
   built output and production dependencies in the final image).
3. Run the image on **Amazon ECS on Fargate** behind an Application Load
   Balancer, with CloudFront in front. The infrastructure stays in AWS CDK.
4. Expose `GET /api/health` (`{ status, uptime, timestamp }`) and use it for the
   ALB target-group health check and the container health check.
5. Write one JSON log line per request (timestamp, level, route, method,
   statusCode, latencyMs) to stdout; ECS ships it to CloudWatch Logs.
6. Retire the static deploy **in the same release** that makes the container
   deploy work, and keep the static site live until the container deploy has
   been verified.

## Consequences

- Server mode removes `dist/index.html`, so `deploy-static.yml` and the
  `BucketDeployment` can no longer publish the site. They are replaced by a
  workflow that builds and pushes an image and updates the ECS service.
- Rollback becomes "redeploy the previous image tag", which is quick to
  practise and easy to explain (the rollback drill, #21, will use it). Images
  are tagged with the commit SHA, never only `latest`.
- Running costs go up from near-zero (S3) to a small always-on Fargate task and
  load balancer. The task is kept to the smallest size, and the stack can be
  destroyed after the defence.
- More moving parts: a VPC, a load balancer, a task definition, a registry
  and IAM roles. All of it is defined in CDK and reviewed in pull requests.
- State must not live in the container's memory. The in-memory event store is
  fine for tests and a first demo, but a persistent adapter (for example
  DynamoDB) is needed before the data matters. The `EventStore` port from
  ADR-004 is what makes that a swap and not a rewrite.
- Logging goes through a small pure module with an injected clock and writer, so
  it is unit-tested and can change output without touching call sites.

## Alternatives considered

- **AWS App Runner.** Much simpler to operate and cheaper to set up, but hides
  the networking and task definitions, so it shows less of the platform and is
  harder to explain in depth. Rejected for learning value, not for capability.
- **Lambda behind CloudFront (adapter for serverless).** Cheap and scalable, but
  cold starts, a different local runtime and an adapter that differs from plain
  Node. It would not use containers, which the module covers.
- **Stay static and use a hosted backend service.** Smallest change, but it
  gives up control of the runtime, the logging and the deployment workflow that
  the project is meant to demonstrate.
- **A single EC2 instance running Docker.** Simple, but patching, scaling and
  zero-downtime deploys become manual work.
