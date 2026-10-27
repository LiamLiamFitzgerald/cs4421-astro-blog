import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as path from 'node:path';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
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
  /**
   * ADR-016: deploy a release that fails on purpose, to prove the canary rolls
   * it back. Only the rollback drill sets this.
   */
  readonly rollbackDrill?: boolean;
  /**
   * ADR-019: the most copies of the app that may run at once, which caps the
   * worst-case bill. Undefined leaves it uncapped (an account whose total limit
   * is 10 cannot reserve any; AWS needs 10 left unreserved).
   */
  readonly maxConcurrency?: number;
  /** ADR-019: monthly spend, in US dollars, at which the kill switch turns the site off. */
  readonly budgetUsd?: number;
  /**
   * ADR-022: serve the site on this domain too (for example catan.liamfitzgerald.space).
   * Needs `certificateArn`: an ACM certificate for it, validated, in us-east-1.
   * DNS stays with the domain's registrar; point a CNAME at the distribution.
   */
  readonly domainName?: string;
  readonly certificateArn?: string;
}

/** DynamoDB's always-free allowance is 25 read and 25 write units per account; rooms use part of it. */
export const ROOMS_READ_CAPACITY = 10;
export const ROOMS_WRITE_CAPACITY = 5;

/**
 * Runs when the budget is spent (ADR-019): sets the app's concurrency to 0, so
 * every request is refused and nothing more is billed, then says so. The AWS
 * SDK is part of the Lambda Node.js runtime, so this needs no bundling.
 */
export const KILL_SWITCH_CODE = `
const { LambdaClient, PutFunctionConcurrencyCommand } = require('@aws-sdk/client-lambda');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
exports.handler = async (event) => {
  await new LambdaClient({}).send(new PutFunctionConcurrencyCommand({
    FunctionName: process.env.APP_FUNCTION,
    ReservedConcurrentExecutions: 0,
  }));
  await new SNSClient({}).send(new PublishCommand({
    TopicArn: process.env.ALERT_TOPIC,
    Subject: 'Catan Tracker: budget reached, site turned off',
    Message: 'The monthly budget was reached, so the kill switch set the app function concurrency to 0. ' +
      'Every request is now refused and nothing more is billed. To turn the site back on, run the App ' +
      'Environment workflow with action revive (see docs/runbook.md).',
  }));
  return { stopped: process.env.APP_FUNCTION, records: (event.Records || []).length };
};
`;

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

    // ADR-019: rooms and their event logs. Provisioned inside the free allowance,
    // so heavy use is throttled rather than billed; TTL deletes old rooms.
    const rooms = new dynamodb.Table(this, 'Rooms', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: ROOMS_READ_CAPACITY,
      writeCapacity: ROOMS_WRITE_CAPACITY,
      timeToLiveAttribute: 'expiresAt',
      // Rooms are disposable (48 hours) and hold no account data.
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
        // readiness endpoint (ADR-013) before sending traffic.
        AWS_LWA_PORT: '4321',
        AWS_LWA_READINESS_CHECK_PATH: '/api/ready',
        ...(props.rollbackDrill ? { ROLLBACK_DRILL: 'fail-requests' } : {}),
        ROOMS_TABLE: rooms.tableName,
      },
      ...(props.maxConcurrency === undefined ? {} : { reservedConcurrentExecutions: props.maxConcurrency }),
    });

    rooms.grantReadWriteData(fn);

    // ADR-019 push: screens hold a WebSocket per room; after a move the app posts
    // a "changed" notice to each. The handler only records who is connected.
    const connections = new lambda.Function(this, 'PushConnections', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'push-connections')),
      timeout: cdk.Duration.seconds(10),
      description: 'Records which screens are connected to which room',
      environment: { ROOMS_TABLE: rooms.tableName },
    });
    rooms.grantReadWriteData(connections);
    const pushApi = new apigwv2.WebSocketApi(this, 'Push', {
      description: 'Room change notices for the Catan screens (ADR-019)',
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('Connect', connections) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('Disconnect', connections) },
    });
    const pushStage = new apigwv2.WebSocketStage(this, 'PushStage', {
      webSocketApi: pushApi,
      stageName: 'live',
      autoDeploy: true,
      // A ceiling on connects and messages, so a flood is refused rather than billed.
      throttle: { rateLimit: 50, burstLimit: 100 },
    });
    fn.addEnvironment('WS_URL', pushStage.url);
    fn.addEnvironment('WS_CALLBACK_URL', pushStage.callbackUrl);
    pushStage.grantManagementApiAccess(fn);

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

    const deployment = new codedeploy.LambdaDeploymentGroup(this, 'Deploy', {
      alias: live,
      deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
      alarms: [errors, serverErrors],
      autoRollback: { failedDeployment: true, deploymentInAlarm: true },
    });

    const url = live.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    if ((props.domainName === undefined) !== (props.certificateArn === undefined)) {
      throw new Error('A custom domain needs both domainName and certificateArn (ADR-022).');
    }
    const custom = props.domainName && props.certificateArn
      ? {
          domainNames: [props.domainName],
          certificate: acm.Certificate.fromCertificateArn(this, 'SiteCertificate', props.certificateArn),
        }
      : {};
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      ...custom,
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

    const roomsThrottled = alarm('RoomsThrottled', {
      metric: new cloudwatch.MathExpression({
        expression: 'reads + writes',
        usingMetrics: {
          reads: rooms.metric('ReadThrottleEvents', { statistic: 'Sum', period: cdk.Duration.minutes(5) }),
          writes: rooms.metric('WriteThrottleEvents', { statistic: 'Sum', period: cdk.Duration.minutes(5) }),
        },
        label: 'Throttled room reads and writes',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'The rooms table hit its free capacity (ADR-019): requests were throttled, not billed.',
    });

    // ADR-019 kill switch: the budget tells this topic, the function turns the site off.
    if (props.budgetUsd !== undefined) {
      const budgetTopic = new sns.Topic(this, 'BudgetReached', { displayName: 'Catan Tracker budget reached' });
      budgetTopic.addToResourcePolicy(
        new iam.PolicyStatement({
          principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
          actions: ['sns:Publish'],
          resources: [budgetTopic.topicArn],
        }),
      );
      const killSwitch = new lambda.Function(this, 'KillSwitch', {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(KILL_SWITCH_CODE),
        timeout: cdk.Duration.seconds(30),
        description: 'Turns the app off (concurrency 0) when the monthly budget is reached',
        environment: { APP_FUNCTION: fn.functionName, ALERT_TOPIC: topic.topicArn },
      });
      killSwitch.addToRolePolicy(
        new iam.PolicyStatement({ actions: ['lambda:PutFunctionConcurrency'], resources: [fn.functionArn] }),
      );
      topic.grantPublish(killSwitch);
      budgetTopic.addSubscription(new subscriptions.LambdaSubscription(killSwitch));
      new budgets.CfnBudget(this, 'Budget', {
        budget: {
          budgetName: `${cdk.Stack.of(this).stackName}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'SNS', address: budgetTopic.topicArn }],
          },
        ],
      });
    }

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${cdk.Stack.of(this).stackName}-health`,
      defaultInterval: cdk.Duration.hours(3),
    });
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarms',
        width: 24,
        alarms: [errors, serverErrors, throttles, slow, edgeErrors, browserErrors, gameLog, roomsThrottled],
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
    // Used by the rollback drill to check which release is live and what CodeDeploy did.
    new cdk.CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new cdk.CfnOutput(this, 'RoomsTable', { value: rooms.tableName });
    new cdk.CfnOutput(this, 'PushUrl', { value: pushStage.url });
    new cdk.CfnOutput(this, 'DeployApplication', { value: deployment.application.applicationName });
    new cdk.CfnOutput(this, 'DeploymentGroupName', { value: deployment.deploymentGroupName });
    // With a custom domain (ADR-022) the site's address is that domain; the cloudfront.net one keeps working.
    const siteHost = props.domainName ?? distribution.distributionDomainName;
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${siteHost}` });
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'Point the custom domain at this with a CNAME record',
    });
    new cdk.CfnOutput(this, 'HealthUrl', { value: `https://${distribution.distributionDomainName}/api/health` });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: url.url });
  }
}
