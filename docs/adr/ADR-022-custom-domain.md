# ADR-022: Serve the site on a custom domain, with DNS kept at the registrar

- **Status:** Proposed (2026-10-27)
- **Deciders:** Liam Fitzgerald
- **Issue:** #149

## Context

The server-rendered site is reached at a generated `d….cloudfront.net` address.
The domain `liamfitzgerald.space` was bought at Namecheap, which also serves its
DNS. CloudFront can answer for a custom name if it has a certificate for it, and
the name points at the distribution.

## Decision

1. **The site lives at `catan.liamfitzgerald.space`.** A subdomain can point at
   CloudFront with a plain CNAME at any registrar; the bare domain cannot (it
   would need an ALIAS/ANAME record), and leaving it free keeps room for other
   uses such as `static.` for the static site.
2. **The certificate is created by hand in ACM (us-east-1, the region CloudFront
   requires) and validated with a DNS record at Namecheap.** Its ARN and the
   domain reach CDK through the `SITE_CERT_ARN` and `SITE_DOMAIN` repository
   variables. CDK does not create the certificate, because with DNS outside AWS
   a deploy would hang until someone added the validation record.
3. **DNS stays at Namecheap.** No Route 53 hosted zone, so no monthly charge; one
   CNAME points the subdomain at the distribution's `cloudfront.net` name, which
   the deploy prints as `CloudFrontDomain`.
4. **Optional and all-or-nothing.** Without both variables the stack is exactly
   as before; with only one, the build refuses with a clear message.
5. When set, the `SiteUrl` output is the custom domain, so the smoke test, the
   uptime check and the drill use the address people use.

## Consequences

- A memorable HTTPS address, at no AWS cost (ACM certificates for CloudFront are
  free and renew themselves while the validation record stays in DNS).
- **Do not delete the validation record**: ACM uses it to renew the certificate.
- The `cloudfront.net` address keeps working alongside the domain.
- The push WebSocket stays on its `execute-api` address; screens are told it by
  the API, so this does not matter to visitors.
- Destroying and recreating the stack gives the distribution a new
  `cloudfront.net` name, so the CNAME must be updated after a destroy.
