# Website Full-Parity Implementation Spec (Big-Bang)

## Scope
Build a single-launch website that matches app functionality for all roles:
- Consumer
- Advertiser
- Admin

Reference codebases:
- Mobile app shell and routing: `compose-app/composeApp/src/androidMain/kotlin/org/community/playgroundfinder/App.kt`
- Mobile screens: `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/`
- Website routes/components: `website/app/` and `website/app/components/`
- Server API/auth mount points: `server/src/index.js`

---

## 1) App-to-Web Parity Matrix (Role, Screen, API)

### Consumer
| App capability | Mobile source | Current website status | Required web deliverable | Primary APIs |
|---|---|---|---|---|
| Home discovery feed + sponsored cards | `ui/screens/home/HomeScreen.kt` | Missing | `/discover` page with feed modules, sponsored slots, and feature row parity | `/api/search/hybrid`, `/api/playgrounds`, `/api/ads`, `/api/ads/events` |
| All Sites + filtered search/list | `App.kt` list/search flows | Missing | `/sites` list route with filters/sorts + inline ad cadence parity | `/api/playgrounds`, `/api/regions/*`, `/api/ads`, `/api/ads/events` |
| Map browse and detail | `ui/screens/map/MapScreen.kt` | Missing | `/map` route with viewport search + map/list sync | `/api/search/hybrid`, `/api/playgrounds/:id` |
| Place detail + report entry points | `ui/screens/details/PlaygroundDetailScreen.kt` | Missing | `/playground/[id]` detail with metadata, gallery, directions, report/support CTA | `/api/playgrounds/:id`, `/api/reports`, `/api/support/tickets` |
| Favorites | `ui/screens/favorites/FavoritesScreen.kt` | Missing | `/favorites` with CRUD parity | `/api/favorites*` (`userRoutes`) |
| Playlists | `ui/screens/lists/*` | Missing | `/lists` and `/lists/[id]` CRUD/detail parity | `/api/lists*` (`userRoutes`) |
| Events calendar | `ui/screens/events/NearbyEventsCalendarScreen.kt` | Missing | `/events` with calendar/list, event spotlight parity labels | `/api/ads` event payloads + region/playground APIs |
| Add/Edit place + submission history | `ui/screens/add/AddEditPlaygroundScreen.kt`, `ui/screens/me/MySubmissionsScreen.kt` | Missing | `/contribute` and `/my-submissions` parity | playground edit/create endpoints (`playgroundRoutes`), `/api/users/me/submissions` |
| User support tickets | `ui/screens/SupportTicketScreen.kt` | Missing | `/support` user ticket creation/status flow | `/api/support/tickets` |

### Auth / Account
| Capability | Mobile source | Current website status | Required web deliverable | APIs |
|---|---|---|---|---|
| Email/password auth | `App.kt` + auth screens | Partial (`/account`, `/login`) | Keep + unify into one account system | `/api/users/login`, `/api/users/register` |
| Password reset | auth flows | Present | Keep and align UX/copy with app | `/api/users/reset-password` |
| Email verification lifecycle | app auth state checks | Partial | Add verification state banner and resend flow in account | `/api/users/resend-verification` |
| Google sign-in | Android helper + Firebase auth | Missing on website | Add Firebase Web Google auth and token handoff | Firebase auth + `/api/*` bearer model |
| Role-based nav guards | `App.kt` screen guards | Partial | Middleware/client guards for user/advertiser/admin routes | JWT claims + `/admin/*` guards |

### Advertiser
| Capability | Mobile source | Current website status | Required web deliverable | APIs |
|---|---|---|---|---|
| Business onboarding | `advertising/BusinessInfoScreen.kt` | Present in hub | Keep and align validation/messages | `/api/ads/submissions` |
| Package selection + copy variants | `advertising/PackageSelectionScreen.kt` | Partial | Add parity package selector with event placement wording rules | `/api/ads/submissions/:id` |
| Creative content + image handling | `advertising/CreativeContentScreen.kt` | Partial | Add parity form validation, image naming, event fields, preview fidelity | `/api/ads/submissions/:id`, `/assets` |
| Ad preview | `advertising/AdPreviewScreen.kt` | Partial | Match Prime/Inline/Event layout and copy behavior | creative endpoints |
| Terms acceptance | `advertising/TermsScreen.kt` | Missing | Add terms step before payment | submission update APIs |
| Payment/checkout | `advertising/PaymentScreen.kt` | Missing | Full Stripe web checkout parity with discounts/free flow | `/api/ads/payments/*`, `/api/ads/discounts/validate` |
| Submission status | `advertising/SubmissionStatusScreen.kt` | Missing | Post-payment status page with retry/error states | payments/submission APIs |
| Dashboard campaigns + analytics | `advertising/AdvertiserDashboardScreen.kt` | Present | Keep, tighten parity for campaign detail/deeplink behavior | `/api/ads/analytics/*`, `/api/ads/campaigns/*` |

### Admin
| Capability | Mobile source | Current website status | Required web deliverable | APIs |
|---|---|---|---|---|
| Ad review queue/detail | `advertising/AdReviewQueueScreen.kt`, `AdSubmissionDetailScreen.kt` | Present (subset) | Keep, align actions and state transitions | `/admin/ads/submissions*` |
| Moderation queue/detail | `admin/AdminQueueScreen.kt`, `AdminDetailScreen.kt` | Present (subset) | Keep and align reason/status UX | `/admin/moderation*` |
| Support queue/detail | `admin/SupportQueueScreen.kt`, `SupportDetailScreen.kt` | Present (subset) | Keep + suggestion approval parity | `/admin/support-tickets*` |
| Analytics hub | `admin/AdminAnalyticsScreen.kt` | Missing | Add analytics module page | `/admin/*` analytics endpoints |
| Region/city phase tools | `admin/AdminRegionSwitcherScreen.kt`, `AdminCityPhaseScreen.kt`, `AdminRegionMaintenanceScreen.kt` | Missing | Add parity region and pricing controls | `/admin/*` region/phase endpoints |
| Discount hub | `admin/AdminDiscountHubScreen.kt` | Missing | Add discount code management UI | `/admin/ads/discounts*` |
| Leaderboard + bulk tools | `admin/AdminLeaderboardScreen.kt`, `AdminBulkToolsScreen.kt` | Missing | Add parity utility modules | corresponding `/admin/*` endpoints |

---

## 2) Consumer Parity Spec and Web Module Map

Target route map to add under `website/app/`:
- `discover/page.js`
- `sites/page.js`
- `map/page.js`
- `playground/[id]/page.js`
- `favorites/page.js`
- `lists/page.js`
- `lists/[id]/page.js`
- `events/page.js`
- `contribute/page.js`
- `my-submissions/page.js`
- `support/page.js`

Core implementation notes:
- Use one shared typed API layer on top of `hubFetch` in `website/app/components/hubClientUtils.js` (split by domain modules).
- Keep ad rendering behavior consistent with app card rules (Prime/Inline/Event wording, spacing, badges).
- For map, use a browser map SDK and viewport-driven requests mapped to `/api/search/hybrid`.
- For lists/favorites, normalize optimistic update behavior and retry handling to reduce friction on large lists.

---

## 3) Auth/Session/Role Parity Spec

Current state uses browser local storage and bearer token forwarding (`hubClientUtils.js`).
Required end-state:
- Introduce centralized auth/session service for:
  - Firebase web login/logout/token refresh
  - Google provider login
  - Email verification status polling and resend CTA
  - Shared auth context across `/account`, `/advertiser-hub`, `/admin-hub`, and new consumer routes
- Add route-guard strategy:
  - Guest-only routes: login/register
  - Auth-required routes: account, favorites, lists, contribute, support, advertiser hub
  - Admin-required routes: admin hub and admin submodules
- Keep server auth contract unchanged: bearer ID token (`Authorization: Bearer ...`) expected by `server/src/services/authService.js`.

Implementation tasks:
- Consolidate `/login` and `/account` behavior into one clear flow.
- Add standardized unauthorized/session-expired handling and redirect policy.
- Add explicit admin claim checks before loading admin modules to avoid heavy failed fetch loops.

---

## 4) Advertiser End-to-End Parity Spec

Target web flow:
1. Business info
2. Package selection
3. Creative content
4. Preview
5. Terms acceptance
6. Payment
7. Submission status
8. Dashboard deep-links (campaign-specific)

Required parity details:
- Event Spotlight wording logic must match app rules for:
  - 7 vs 14 days
  - Calendar/Inline vs Calendar/Prime placement labels
- Creative preview must follow app layout semantics and image fit/copy behavior.
- Payment flow must support:
  - Stripe PaymentIntent path
  - 100 percent discount/free checkout path
  - Failure retries with actionable status messaging
- Campaign email deep-links should always target website dashboard routes and mention app/web sign-in compatibility.

API contracts to fully exercise:
- `/api/ads/submissions*`
- `/api/ads/payments/*`
- `/api/ads/discounts/validate`
- `/api/ads/analytics/*`
- `/api/ads/campaigns/*`

---

## 5) Admin Parity Spec

Expand current `AdminHubClient` into modular pages/components:
- `admin-hub/ads`
- `admin-hub/moderation`
- `admin-hub/support`
- `admin-hub/analytics`
- `admin-hub/regions`
- `admin-hub/city-phase`
- `admin-hub/discounts`
- `admin-hub/leaderboard`
- `admin-hub/bulk-tools`

Design requirements:
- Preserve existing actions already in `AdminHubClient.js`.
- Add missing app-equivalent tools from `compose-app` admin screens.
- Keep shared audit/history details visible where destructive actions occur.
- Add role and environment safety affordances (clear prod indicators, confirmation dialogs, action reason inputs).

---

## 6) Backend Hardening and API Readiness

Server readiness checks before big-bang:
- Auth and role checks
  - Verify all protected routes behave consistently with `verifyToken` and `verifyAdminToken`.
  - Resolve auth drift risks (for example, google-signin contract mismatches between clients/tests/routes).
- Routing/proxy
  - Ensure both `/api/*` and `/admin/*` are reachable behind edge/proxy config.
- Rate limiting and trust proxy
  - Validate `TRUST_PROXY` and ad limiters for expected production traffic shape.
- Stripe webhook
  - Preserve raw-body route behavior for `/api/ads/payments/webhook`.
- Upload limits
  - Align edge upload size with server multer limits.

Hardening outputs:
- Endpoint readiness matrix (owner, expected load, auth mode, failure mode).
- Explicit list of contract changes required (if any) with migration fallback.

---

## 7) Infra and Runtime Readiness

Website runtime decisions:
- Re-evaluate `next.config.js` static export strategy for full dynamic app workloads and SEO route requirements.
- Define canonical deployment topology:
  - Website origin
  - API origin
  - Proxy/edge behavior for auth headers, CORS, cache bypass for auth routes
- Environment matrix (dev/stage/prod):
  - API base URL
  - Firebase config
  - Stripe public key
  - Maps key
  - Marketing base URL and legal links

Operational readiness:
- Logging, tracing, and alerting for user, advertiser, and admin critical paths.
- Production runbook with known failure classes and first-response actions.

---

## 8) Quality Gates and Launch Checklist

### Test pyramid
- Unit tests
  - API client modules, auth/session utilities, business-rule formatters.
- Integration tests
  - Consumer core: discover/search/detail/favorites/lists.
  - Advertiser: draft-through-payment-through-dashboard.
  - Admin: review/moderation/support and campaign actions.
- End-to-end tests
  - Cross-role smoke on production-like environment.
  - Session/role transition coverage.

### Non-functional checks
- Load tests for ad-serving and ad-event endpoints.
- Latency/error budgets for discover/map/detail.
- Accessibility audit on key routes.
- Security checks on token storage/rotation and admin route access.

### Big-bang launch gates (all must pass)
- Gate A: Consumer parity route set complete.
- Gate B: Auth/role parity complete and verified.
- Gate C: Advertiser e2e (including payment/status) complete.
- Gate D: Admin parity modules complete.
- Gate E: Backend hardening checklist complete.
- Gate F: Infra/runtime readiness complete.
- Gate G: End-to-end regression suite green.

### Rollback requirements
- Feature flags or route-level kill switches for new high-risk modules.
- Verified ability to route users back to legacy minimal website pages.
- Incident communication templates for advertiser/admin-impacting failures.

---

## Recommended Build Order (Parallelized)

1. Foundation: auth/session layer + typed API client + route guard primitives.
2. Consumer core routes (discover/sites/map/detail) and favorites/lists.
3. Advertiser missing stages (terms/payment/status) and parity copy logic.
4. Admin missing modules and operational safeguards.
5. Infra hardening, performance, regression suite, launch rehearsal.

This preserves big-bang launch intent while reducing integration risk by forcing shared primitives first.
