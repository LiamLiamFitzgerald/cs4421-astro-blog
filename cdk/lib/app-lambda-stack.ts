import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * ADR-010: the same container image as before, run on AWS Lambda.
 *
 * The AWS Lambda Web Adapter in the image turns Lambda invocations into plain
 * HTTP requests to the Node server, so the app is unchanged. Each deploy
 * publishes a new version; CodeDeploy shifts the `live` alias to it as a
 * canary and rolls back automatically if the error alarm fires.
 *
 * Nothing here runs when idle, so a deployed environment costs close to zero.
 */
export class AppLambdaStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda.DockerImageFunction(this, 'App', {
      // Built from the Dockerfile at the repo root (respects .dockerignore).
      code: lambda.DockerImageCode.fromImageAsset('..'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      logGroup,
      description: 'Catan Tracker (Astro Node server via Lambda Web Adapter)',
      environment: {
        // The Web Adapter forwards requests to this port and waits for the
        // health endpoint before sending traffic (the readiness check).
        AWS_LWA_PORT: '4321',
        AWS_LWA_READINESS_CHECK_PATH: '/api/health',
      },
    });

    // Every deploy publishes a version; traffic always goes through this alias.
    const live = new lambda.Alias(this, 'Live', {
      aliasName: 'live',
      version: fn.currentVersion,
    });

    // Rollback trigger: any function errors on the alias during the canary.
    const errors = new cloudwatch.Alarm(this, 'Errors', {
      metric: live.metricErrors({ period: cdk.Duration.minutes(1), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Errors on the live alias; CodeDeploy rolls back while this is in alarm.',
    });

    new codedeploy.LambdaDeploymentGroup(this, 'Deploy', {
      alias: live,
      deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
      alarms: [errors],
      autoRollback: { failedDeployment: true, deploymentInAlarm: true },
    });

    const url = live.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(url),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // Server-rendered pages and the API must not be cached at the edge.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'HealthUrl', { value: `https://${distribution.distributionDomainName}/api/health` });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: url.url });
  }
}
