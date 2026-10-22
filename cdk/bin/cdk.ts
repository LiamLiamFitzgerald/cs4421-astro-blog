#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import { StaticSiteStack } from '../lib/static-site-stack';
// import { AppServiceStack } from '../lib/app-service-stack';
import { AppLambdaStack } from '../lib/app-lambda-stack';

const app = new cdk.App();

// The retired static-site stack (ADR-001) uploads ../dist, which only exists
// after `npm run build`. The App Environment workflow does not build the site,
// so define this stack only when dist is present (the manual static fallback
// builds first). Otherwise every CDK command would fail with CannotFindAsset.
if (fs.existsSync(path.join(__dirname, '..', '..', 'dist'))) {
  new StaticSiteStack(app, 'StaticSiteStack', {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
     env: { account: '480174683659', region: 'us-east-1' },

    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
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
});
