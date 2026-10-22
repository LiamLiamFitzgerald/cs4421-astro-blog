#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { StaticSiteStack } from '../lib/static-site-stack';
// import { AppServiceStack } from '../lib/app-service-stack';
import { AppLambdaStack } from '../lib/app-lambda-stack';

const app = new cdk.App();
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

// ADR-001 (superseded by ADR-010): the ECS Fargate service. Commented out
// because its load balancer and always-on task cost about $1.40/day. The code
// in lib/app-service-stack.ts is kept, and still tested, so it can come back.
// new AppServiceStack(app, 'AppServiceStack', {
//   env: { account: '480174683659', region: 'us-east-1' },
// });

// ADR-010: the same image on Lambda, with canary deploys and automatic rollback.
new AppLambdaStack(app, 'AppLambdaStack', {
  env: { account: '480174683659', region: 'us-east-1' },
});
