# Infra and Runtime Readiness Spec

## Objective
Prepare website runtime, deployment, and environment configuration for full app-equivalent workload.

## Current Reference Points
- `website/next.config.js`
- `website/app/components/hubClientUtils.js`
- `server/src/index.js`

## Decisions Required
1. **Rendering/runtime mode**
   - Reassess static export-only strategy for dynamic parity routes and SEO requirements.
2. **Origin and gateway topology**
   - Website origin
   - API origin
   - Proxy path forwarding for `/api/*` and `/admin/*`
3. **Session and security**
   - Token handling strategy and storage hardening
   - CORS and header forwarding

## Environment Matrix

### Development
- Local API base
- Firebase dev project
- Stripe test keys
- Map keys (restricted)

### Staging
- Staging API with production-like data shape
- Staging Firebase and Stripe
- Alerting and log collection enabled

### Production
- Production API base
- Production Firebase and Stripe
- Strong cache policy segregation for auth vs public pages

## Deployment Readiness Checklist
- Proxy forwards all required paths and headers.
- Stripe webhook endpoint receives raw body unchanged.
- Upload size limits consistent across edge and server.
- Health and error monitoring dashboards active before cutover.

## Acceptance Criteria
- End-to-end user/advertiser/admin flows run in staging with production-like topology.
- No infrastructure-level blocker remains for big-bang launch.
