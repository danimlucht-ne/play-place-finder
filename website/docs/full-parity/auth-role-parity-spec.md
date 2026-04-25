# Auth and Role Parity Spec

## Objective
Unify website authentication/session behavior to match app role logic and Firebase-backed token contract.

## Current Files
- `website/app/components/hubClientUtils.js`
- `website/app/components/HubAuthPanel.js`
- `website/app/components/NavSessionLinks.js`
- `website/app/account/page.js`
- `website/app/login/page.js`

## Target Architecture
1. **Single auth source of truth**
   - Create `AuthProvider` for token, claims, refresh, and sign-out.
   - Replace direct per-component local storage reads with provider hooks.
2. **Firebase web auth parity**
   - Email/password remains.
   - Add Google sign-in on web.
   - Keep server contract: `Authorization: Bearer <idToken>`.
3. **Verification UX**
   - Account-level verification status indicator.
   - Resend verification action parity.
4. **Role guards**
   - User required: consumer-auth routes and advertiser routes.
   - Admin required: admin routes and modules.
   - Guest-only: login/register/reset pages.
5. **Session lifecycle**
   - Clear expired token handling with redirect and recoverable message.
   - Shared sign-in destination logic for advertiser vs admin.

## Route Policy
- Guest-only: `/login`, auth forms.
- Auth required: `/account`, `/favorites`, `/lists`, `/contribute`, `/support`, `/advertiser-hub`.
- Admin required: `/admin-hub` and all future admin modules.

## API Touchpoints
- `/api/users/login`
- `/api/users/register`
- `/api/users/reset-password`
- `/api/users/resend-verification`
- All protected `/api/*` and `/admin/*` routes with bearer token.

## Acceptance Criteria
- Token and claims managed in one place.
- Google sign-in works end-to-end with backend bearer auth.
- Admin pages are inaccessible without admin claim.
- Login/account split is removed as a user confusion point.
