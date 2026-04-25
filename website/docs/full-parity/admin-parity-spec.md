# Admin Parity Spec

## Objective
Expand website admin tooling to match app admin capabilities with safe operational controls.

## Source References
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/admin/`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/AdReviewQueueScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/AdSubmissionDetailScreen.kt`
- `website/app/components/AdminHubClient.js`

## Current Coverage
Already present in web hub:
- Ad submission review subset
- Campaign list/actions subset
- Moderation queue subset
- Support ticket queue subset
- Playground debug/detail subset

## Missing Modules to Add
- Admin analytics dashboard
- Region switcher + region maintenance
- City phase/pricing controls
- Discount management hub
- Leaderboard tooling
- Bulk ops tools

## Proposed Information Architecture
- `/admin-hub` overview
- `/admin-hub/ads`
- `/admin-hub/moderation`
- `/admin-hub/support`
- `/admin-hub/analytics`
- `/admin-hub/regions`
- `/admin-hub/city-phase`
- `/admin-hub/discounts`
- `/admin-hub/leaderboard`
- `/admin-hub/bulk-tools`

## UX Safety Requirements
- Role-gated route access and data fetches.
- Explicit confirmation dialogs for destructive actions.
- Mandatory reason fields for reject/cancel/refund classes.
- Persistent action logs/audit visibility in details panes.

## Acceptance Criteria
- All app admin destinations have a web equivalent.
- Existing admin actions remain available with no regression.
- High-risk actions include guardrails and clear operator context.
