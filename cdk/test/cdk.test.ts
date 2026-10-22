import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppServiceStack } from '../lib/app-service-stack';
import { AppLambdaStack } from '../lib/app-lambda-stack';

describe('Feature: container service stack (ADR-001)', () => {
  const app = new cdk.App();
  const stack = new AppServiceStack(app, 'TestAppServiceStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('given the stack, runs one small Fargate task on the app port', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '256',
      Memory: '512',
      RequiresCompatibilities: ['FARGATE'],
      ContainerDefinitions: [Match.objectLike({ PortMappings: [Match.objectLike({ ContainerPort: 4321 })] })],
    });
    template.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1, LaunchType: 'FARGATE' });
  });

  it('given a bad release, the circuit breaker rolls the deployment back', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it('given the load balancer, health-checks /api/health expecting 200', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/health',
      Matcher: { HttpCode: '200' },
    });
  });

  it('given visitors, CloudFront redirects to HTTPS and does not cache dynamic pages', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  it('given cost limits, creates no NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });
});

describe('Feature: Lambda app stack (ADR-010)', () => {
  const app = new cdk.App();
  const stack = new AppLambdaStack(app, 'TestAppLambdaStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  it('given the stack, runs the container image as a Lambda function behind the Web Adapter', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      PackageType: 'Image',
      MemorySize: 512,
      Environment: {
        Variables: { AWS_LWA_PORT: '4321', AWS_LWA_READINESS_CHECK_PATH: '/api/ready' },
      },
    });
  });

  it('given traffic, it goes through a live alias with a public function URL', () => {
    template.hasResourceProperties('AWS::Lambda::Alias', { Name: 'live' });
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('given a deploy, CodeDeploy shifts traffic as a canary and rolls back on alarm', () => {
    template.hasResourceProperties('AWS::CodeDeploy::DeploymentGroup', {
      DeploymentConfigName: 'CodeDeployDefault.LambdaCanary10Percent5Minutes',
      AutoRollbackConfiguration: Match.objectLike({ Enabled: true }),
      AlarmConfiguration: Match.objectLike({ Enabled: true }),
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Threshold: 1,
    });
  });

  it('given CloudFront, it does not cache server-rendered pages', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          // Managed CachingDisabled policy.
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  it('given idle time, nothing billable runs: no load balancer, no VPC, no ECS service', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    template.resourceCountIs('AWS::EC2::VPC', 0);
    template.resourceCountIs('AWS::ECS::Service', 0);
  });

  it('given the image, it is built from the Dockerfile lambda stage (with the Web Adapter)', () => {
    const assets = JSON.parse(
      require('node:fs').readFileSync(require('node:path').join(app.outdir, 'TestAppLambdaStack.assets.json'), 'utf8'),
    );
    const images = Object.values(assets.dockerImages ?? {}) as { source: { dockerBuildTarget?: string } }[];
    expect(images.map((i) => i.source.dockerBuildTarget)).toContain('lambda');
  });

  it('given logs, they are kept for a week and removed with the stack', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });
});

describe('Feature: alarms, notifications and dashboard (ADR-015)', () => {
  const build = (alarmEmail?: string) =>
    Template.fromStack(
      new AppLambdaStack(new cdk.App(), 'TestAlarms', {
        env: { account: '111111111111', region: 'us-east-1' },
        alarmEmail,
      }),
    );
  const template = build('ops@example.com');
  const alarmNamed = (metricName: string) =>
    Object.values(template.findResources('AWS::CloudWatch::Alarm')).find(
      (r) => (r as { Properties: { MetricName?: string } }).Properties.MetricName === metricName,
    ) as { Properties: Record<string, unknown> } | undefined;

  it('given an alarm email, the alarm topic emails it', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
  });

  it('given no alarm email, the topic exists with no subscriber and nothing is committed', () => {
    const quiet = build(undefined);
    quiet.resourceCountIs('AWS::SNS::Topic', 1);
    quiet.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  it.each([
    ['Errors', 1],
    ['Http5xx', 1],
    ['Throttles', 1],
    ['Duration', 5000],
    ['5xxErrorRate', 5],
    ['ClientErrors', 10],
    ['GameLogProblems', 1],
  ])('given %s, an alarm watches it with threshold %d and notifies the topic', (metricName, threshold) => {
    const found = alarmNamed(metricName);
    expect(found).toBeDefined();
    expect(found?.Properties['Threshold']).toBe(threshold);
    expect(found?.Properties['TreatMissingData']).toBe('notBreaching');
    expect((found?.Properties['AlarmActions'] as unknown[]).length).toBe(1);
    expect((found?.Properties['OKActions'] as unknown[]).length).toBe(1);
  });

  it('given latency, the alarm uses the slowest 5% over two periods', () => {
    expect(alarmNamed('Duration')?.Properties).toMatchObject({ ExtendedStatistic: 'p95', EvaluationPeriods: 2 });
  });

  it('given CloudFront, the edge alarm reads the global 5xx rate for this distribution', () => {
    const dims = alarmNamed('5xxErrorRate')?.Properties['Dimensions'] as { Name: string; Value: unknown }[];
    expect(dims.map((d) => d.Name).sort()).toEqual(['DistributionId', 'Region']);
    expect(dims.find((d) => d.Name === 'Region')?.Value).toBe('Global');
  });

  it('given a canary, it rolls back on handled 5xx responses as well as Lambda errors', () => {
    const group = Object.values(template.findResources('AWS::CodeDeploy::DeploymentGroup'))[0] as {
      Properties: { AlarmConfiguration: { Alarms: unknown[] } };
    };
    expect(group.Properties.AlarmConfiguration.Alarms).toHaveLength(2);
  });

  it.each([
    ['Http5xx', '{ $.statusCode >= 500 }'],
    ['ClientErrors', '{ $.message = "client error" }'],
    ['GameLogProblems', '{ ($.context = "play:salvaged") || ($.context = "play:invariant") }'],
  ])('given the JSON logs, %s is counted from lines matching %s', (metricName, pattern) => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: pattern,
      MetricTransformations: [Match.objectLike({ MetricName: metricName, MetricNamespace: 'CatanTracker', DefaultValue: 0 })],
    });
  });

  it('given the dashboard, it shows alarm status and the four graphs', () => {
    const dashboards = Object.values(template.findResources('AWS::CloudWatch::Dashboard'));
    expect(dashboards).toHaveLength(1);
    const body = JSON.stringify((dashboards[0] as { Properties: { DashboardBody: unknown } }).Properties.DashboardBody);
    for (const title of ['Alarms', 'Requests', 'Latency (ms)', 'Errors', 'Browser reports and game log problems']) {
      expect(body).toContain(title);
    }
  });

  it('given a deploy, outputs the dashboard link and the topic', () => {
    template.hasOutput('DashboardUrl', {});
    template.hasOutput('AlarmTopicArn', {});
  });
});

describe('Feature: rollback drill (ADR-016)', () => {
  const build = (rollbackDrill?: boolean) =>
    Template.fromStack(
      new AppLambdaStack(new cdk.App(), 'TestDrill', { env: { account: '111111111111', region: 'us-east-1' }, rollbackDrill }),
    );
  const variables = (template: Template) =>
    (
      Object.values(template.findResources('AWS::Lambda::Function'))[0] as {
        Properties: { Environment: { Variables: Record<string, string> } };
      }
    ).Properties.Environment.Variables;

  it('given a normal deploy, the release does not fail on purpose', () => {
    expect(variables(build())).not.toHaveProperty('ROLLBACK_DRILL');
    expect(variables(build(false))).not.toHaveProperty('ROLLBACK_DRILL');
  });

  it('given the drill, the release fails requests on purpose', () => {
    expect(variables(build(true))).toMatchObject({ ROLLBACK_DRILL: 'fail-requests' });
  });

  it('given the drill, outputs what it needs to check the rollback', () => {
    const template = build();
    for (const name of ['FunctionName', 'DeployApplication', 'DeploymentGroupName']) template.hasOutput(name, {});
  });
});

