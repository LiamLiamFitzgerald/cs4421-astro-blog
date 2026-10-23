import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

/**
 * Pretty URLs on S3 (ADR-018): S3 has no directory indexes, so `/catan` and
 * `/catan/` are rewritten to `/catan/index.html` at the edge. Paths with a file
 * extension (assets) pass through unchanged.
 */
export const INDEX_REWRITE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (uri.split('/').pop().indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }
  return request;
}`;

export interface StaticSiteStackProps extends cdk.StackProps {
  /** Folder to publish. Defaults to the repository's dist/ from `npm run build:static`. */
  readonly siteDir?: string;
}

/**
 * The static site: the Catan app built as plain files (`npm run build:static`),
 * served from a private S3 bucket through CloudFront.
 */
export class StaticSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StaticSiteStackProps = {}) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    const rewrite = new cloudfront.Function(this, 'IndexRewrite', {
      code: cloudfront.FunctionCode.fromInline(INDEX_REWRITE),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Serve /page as /page/index.html (S3 has no directory indexes)',
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      defaultRootObject: 'index.html',
      // A missing key comes back from a private bucket as 403; show the site's 404 page.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: cdk.Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: cdk.Duration.minutes(1) },
      ],
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(props.siteDir ?? './../dist')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'], // Invalidate the CDN cache on every deploy.
    });

    new cdk.CfnOutput(this, 'StaticSiteUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
