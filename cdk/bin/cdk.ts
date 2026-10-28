#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { StaticSiteStack } from '../lib/static-site-stack';
// import { AppServiceStack } from '../lib/app-service-stack';
import { AppLambdaStack } from '../lib/app-lambda-stack';

const app = new cdk.App();

/** A context value as a number, `undefined` for "none", or the default when it is not set. */
function numberOrNone(value: unknown, fallback: number | undefined): number | undefined {
  if (value === undefined || value === '') return fallback;
  if (value === 'none') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Expected a number or "none", got ${String(value)}`);
  return n;
}

// ADR-018: the static site publishes the Catan app built by `npm run build:static`,
// which writes dist/index.html. The server build (dist/client, dist/server) and a
// clean checkout have no such file, so the stack is defined only for a static
// build. Otherwise CDK would fail with CannotFindAsset, or upload the wrong build.
if (fs.existsSync(path.join(__dirname, '..', '..', 'dist', 'index.html'))) {
  new StaticSiteStack(app, 'StaticSiteStack', {
    env: { account: '480174683659', region: 'us-east-1' },
  });
}

// ADR-001 (superseded by ADR-010): the ECS Fargate service. Commented out
// because its load balancer and always-on task cost about $1.40/day. The code
// in lib/app-service-stack.ts is kept, and still tested, so it can come back.
// new AppServiceStack(app, 'AppServiceStack', {
//   env: { account: '480174683659', region: 'us-east-1' },
// });

// ADR-010: the same image on Lambda, with canary deploys and automatic rollback.
new AppLambdaStack(app, 'AppLambdaStack', {
  env: { account: '480174683659', region: 'us-east-1' },
  // ADR-015: alarm email from the environment (a GitHub variable), never committed.
  alarmEmail: process.env.ALARM_EMAIL || undefined,
  // ADR-016: `cdk deploy -c rollbackDrill=true` deploys a release that fails on purpose.
  rollbackDrill: app.node.tryGetContext('rollbackDrill') === 'true',
  // ADR-019 cost ceilings, from the MAX_CONCURRENCY and BUDGET_USD repository variables.
  // No cap by default: an account whose Lambda limit is 10 cannot reserve any (and is
  // then capped at 10 by AWS anyway). The kill switch defaults to a $5 budget.
  maxConcurrency: numberOrNone(app.node.tryGetContext('maxConcurrency'), undefined),
  budgetUsd: numberOrNone(app.node.tryGetContext('budgetUsd'), 5),
  // ADR-022: custom domain, from the SITE_DOMAIN and SITE_CERT_ARN repository variables.
  domainName: process.env.SITE_DOMAIN || undefined,
  certificateArn: process.env.SITE_CERT_ARN || undefined,
});
