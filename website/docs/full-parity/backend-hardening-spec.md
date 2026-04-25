# Backend Hardening Spec for Big-Bang Web Parity

## Objective
Validate and harden server readiness for full-role website traffic and feature parity.

## Core Server References
- `server/src/index.js`
- `server/src/services/authService.js`
- `server/src/middleware/adRateLimiter.js`
- `server/src/routes/`

## Hardening Checklist

### Auth and Role Contracts
- Confirm all protected routes consistently enforce bearer token validation.
- Confirm all `/admin/*` routes enforce admin claim logic.
- Resolve contract drift between client expectations and route implementations (especially social login flows).

### Route Reachability
- Verify production proxy/edge routing includes both:
  - `/api/*`
  - `/admin/*`
- Confirm no route shadowing or mount-order side effects on payment/admin paths.

### Rate Limits and Proxy Trust
- Validate `TRUST_PROXY` behavior in production.
- Re-tune ad-serving and ad-event limits for web traffic shape if needed.
- Add observability on 429 rates by endpoint.

### Stripe and Payments
- Preserve raw body handling on webhook endpoint.
- Validate idempotency and reconciliation paths.
- Confirm discount and free-checkout behavior under heavy concurrency.

### Uploads and Media
- Align edge upload size limits with server `multer` file cap.
- Add explicit user-facing error mapping for 413/415 failures.

### Operational Readiness
- Endpoint inventory with auth mode, SLO, and on-call owner.
- Error taxonomy for expected user-facing failures.

## Acceptance Criteria
- No parity-critical endpoint has unresolved contract ambiguity.
- Admin and advertiser payment workflows pass load and failure-injection tests.
- Auth, rate-limit, and webhook behaviors are documented and verified in staging.
