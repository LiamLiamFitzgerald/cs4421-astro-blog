import * as cdk from 'aws-cdk-lib/core';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * ADR-001: the Astro Node server in a container on ECS Fargate, behind an
 * Application Load Balancer, with CloudFront in front.
 *
 * Kept small and cheap on purpose: one 0.25 vCPU task, public subnets (no NAT
 * gateway), and a deployment circuit breaker that rolls back a bad release.
 */
export class AppServiceStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      // Explicit zones avoid an AWS lookup at synth time, so CI can synth without credentials.
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'AppService', {
      vpc,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      assignPublicIp: true, // no NAT gateway, so tasks pull the image over the public subnet
      publicLoadBalancer: true,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100, // keep the old task serving until the new one is healthy
      maxHealthyPercent: 200,
      taskImageOptions: {
        // Built from the Dockerfile at the repo root and pushed to the CDK asset repository.
        image: ecs.ContainerImage.fromAsset('..'),
        containerPort: 4321,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'app',
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
      },
    });

    service.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
    });

    const distribution = new cloudfront.Distribution(this, 'AppDistribution', {
      defaultBehavior: {
        // The ALB speaks HTTP; CloudFront terminates TLS for visitors.
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });

    new cdk.CfnOutput(this, 'AppUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'HealthUrl', {
      value: `https://${distribution.distributionDomainName}/api/health`,
    });
  }
}
