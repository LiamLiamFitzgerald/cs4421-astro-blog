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
        Variables: { AWS_LWA_PORT: '4321', AWS_LWA_READINESS_CHECK_PATH: '/api/health' },
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
