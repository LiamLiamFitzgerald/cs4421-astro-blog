import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

/** Namespace for metrics the stack derives from the app's JSON logs. */
export const APP_METRICS_NAMESPACE = 'CatanTracker';

export interface AppLambdaStackProps extends cdk.StackProps {
  /**
   * Where alarm emails go. Supplied at deploy time (the ALARM_EMAIL GitHub
   * variable), never committed. Without it the topic exists but has no
   * subscriber, so alarms still show on the dashboard and still roll back.
   */
  readonly alarmEmail?: string;
}

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
  constructor(scope: Construct, id: string, props: AppLambdaStackProps = {}) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new lambda.DockerImageFunction(this, 'App', {
      // The Dockerfile's `lambda` stage: the app image plus the Web Adapter.
      code: lambda.DockerImageCode.fromImageAsset('..', { target: 'lambda' }),
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

    // ADR-015: every alarm notifies this topic.
    const topic = new sns.Topic(this, 'Alarms', { displayName: 'Catan Tracker alarms' });
    if (props.alarmEmail) topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    const notify = new cloudwatchActions.SnsAction(topic);

    /** A metric counted from JSON log lines that match `pattern`. */
    const countFromLogs = (name: string, pattern: logs.IFilterPattern) => {
      new logs.MetricFilter(this, `${name}Filter`, {
        logGroup,
        filterPattern: pattern,
        metricNamespace: APP_METRICS_NAMESPACE,
        metricName: name,
        metricValue: '1',
        defaultValue: 0,
      });
      return new cloudwatch.Metric({
        namespace: APP_METRICS_NAMESPACE,
        metricName: name,
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });
    };

    // From the request log (one JSON line per request) and the error lines.
    const http5xx = countFromLogs('Http5xx', logs.FilterPattern.numberValue('$.statusCode', '>=', 500));
    const clientErrors = countFromLogs('ClientErrors', logs.FilterPattern.stringValue('$.message', '=', 'client error'));
    // ADR-014: a damaged save or a broken rule of the game is always a bug.
    const gameLogProblems = countFromLogs(
      'GameLogProblems',
      logs.FilterPattern.any(
        logs.FilterPattern.stringValue('$.context', '=', 'play:salvaged'),
        logs.FilterPattern.stringValue('$.context', '=', 'play:invariant'),
      ),
    );

    const alarm = (name: string, options: cloudwatch.AlarmProps) => {
      const created = new cloudwatch.Alarm(this, name, {
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        ...options,
      });
      created.addAlarmAction(notify);
      created.addOkAction(notify);
      return created;
    };

    // Rollback trigger: any function errors on the alias during the canary.
    const errors = new cloudwatch.Alarm(this, 'Errors', {
      metric: live.metricErrors({ period: cdk.Duration.minutes(1), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Errors on the live alias; CodeDeploy rolls back while this is in alarm.',
    });
    errors.addAlarmAction(notify);
    errors.addOkAction(notify);

    // A handled 500 is not a Lambda error (the function still returned), so the
    // canary also watches the app's own request log.
    const serverErrors = alarm('ServerErrors', {
      metric: http5xx,
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'The app answered with a 5xx. CodeDeploy rolls back while this is in alarm.',
    });

    new codedeploy.LambdaDeploymentGroup(this, 'Deploy', {
      alias: live,
      deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
      alarms: [errors, serverErrors],
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

    const throttles = alarm('Throttles', {
      metric: live.metricThrottles({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Lambda refused requests because of its concurrency limit.',
    });

    const slow = alarm('Slow', {
      metric: live.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p95' }),
      threshold: 5000,
      evaluationPeriods: 2,
      alarmDescription: 'Slowest 5% of requests took over 5 s for 10 minutes (the timeout is 15 s).',
    });

    // CloudFront publishes its metrics in us-east-1 with Region=Global.
    const edge5xxRate = new cloudwatch.Metric({
      namespace: 'AWS/CloudFront',
      metricName: '5xxErrorRate',
      dimensionsMap: { DistributionId: distribution.distributionId, Region: 'Global' },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });
    const edgeErrors = alarm('EdgeErrors', {
      metric: edge5xxRate,
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'Over 5% of responses from CloudFront were 5xx errors.',
    });

    const browserErrors = alarm('BrowserErrors', {
      metric: clientErrors.with({ period: cdk.Duration.minutes(5) }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'More than 10 error reports from visitors\' browsers in 5 minutes.',
    });

    const gameLog = alarm('GameLogProblems', {
      metric: gameLogProblems.with({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'A saved game was damaged or broke a rule of the game (ADR-014). Replay the logged eventLog.',
    });

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${cdk.Stack.of(this).stackName}-health`,
      defaultInterval: cdk.Duration.hours(3),
    });
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarms',
        width: 24,
        alarms: [errors, serverErrors, throttles, slow, edgeErrors, browserErrors, gameLog],
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Requests',
        width: 12,
        left: [live.metricInvocations({ statistic: 'Sum' })],
        right: [edge5xxRate],
      }),
      new cloudwatch.GraphWidget({
        title: 'Latency (ms)',
        width: 12,
        left: [live.metricDuration({ statistic: 'p50' }), live.metricDuration({ statistic: 'p95' })],
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Errors',
        width: 12,
        left: [live.metricErrors({ statistic: 'Sum' }), http5xx, live.metricThrottles({ statistic: 'Sum' })],
      }),
      new cloudwatch.GraphWidget({
        title: 'Browser reports and game log problems',
        width: 12,
        left: [clientErrors, gameLogProblems],
      }),
    );

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${dashboard.dashboardName}`,
    });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: topic.topicArn });
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'HealthUrl', { value: `https://${distribution.distributionDomainName}/api/health` });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: url.url });
  }
}
