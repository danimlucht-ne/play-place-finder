# Advertiser End-to-End Parity Spec

## Objective
Deliver full web advertiser flow parity from first draft through payment, status, and campaign management.

## Source Parity References
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/BusinessInfoScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/PackageSelectionScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/CreativeContentScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/AdPreviewScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/TermsScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/PaymentScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/SubmissionStatusScreen.kt`
- `compose-app/composeApp/src/commonMain/kotlin/org/community/playgroundfinder/ui/screens/advertising/AdvertiserDashboardScreen.kt`

## Web Deliverables
1. **Guided multi-step booking flow**
   - Business info
   - Package selection
   - Creative entry
   - Preview
   - Terms
   - Payment
   - Submission status
2. **Package/placement copy parity**
   - Prime placement wording
   - Inline list wording
   - Event spotlight rules for calendar/inline and calendar/prime
3. **Creative parity**
   - Event body formatting (date/time/location readability)
   - Friendly image naming and preview framing behavior
4. **Payment parity**
   - Stripe web checkout for PaymentIntent flow
   - Discount validation and free checkout path
   - Payment failure retry and state recovery
5. **Dashboard parity**
   - Campaign detail deep-link, actions, analytics consistency
   - Email deep-link destination to website dashboard

## API Surface
- `/api/advertisers/me`
- `/api/ads/submissions*`
- `/api/ads/submissions/:id/assets`
- `/api/ads/campaigns/*`
- `/api/ads/analytics/*`
- `/api/ads/payments/*`
- `/api/ads/discounts/validate`

## Acceptance Criteria
- Full create-to-pay-to-track flow is available on web.
- No advertiser booking action requires mobile app.
- Campaign confirmation email copy contains website dashboard link and app/web sign-in guidance.
