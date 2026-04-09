# PlayPlace Finder — Launch Checklist

## Phase 1: Deploy Server to GCP

1. SSH into your Compute Engine VM
2. Install Node.js 18+ if not already there:
   ```
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Clone or upload your server code to the VM
4. `cd playground-app/server && npm install`
5. Create `.env` file on the VM:
   ```
   MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/playplacefinder
   GOOGLE_MAPS_API_KEY=your_maps_key
   GEMINI_API_KEY=your_gemini_key
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   SERVER_BASE_URL=http://YOUR_VM_EXTERNAL_IP:8000
   STRIPE_SECRET_KEY=sk_test_your_key_here
   STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
   ```
6. Install pm2 globally: `sudo npm install -g pm2`
7. Start the server: `pm2 start src/index.js --name playplace`
8. Set pm2 to restart on reboot: `pm2 startup` (follow the printed command), then `pm2 save`
9. Open port 8000 in GCP firewall:
   - GCP Console → VPC Network → Firewall → Create Firewall Rule
   - Name: `allow-playplace-8000`
   - Direction: Ingress
   - Targets: All instances (or specific tag)
   - Source IP ranges: `0.0.0.0/0`
   - Protocols/ports: TCP 8000
10. Test: visit `http://YOUR_VM_EXTERNAL_IP:8000/api/health` in a browser — you should see the health JSON

## Phase 2: Stripe Setup

1. Go to https://dashboard.stripe.com/register
2. Create account under "Lucht Applications LLC"
3. Complete business verification (EIN, bank account)
4. While in TEST MODE (toggle at top of dashboard):
   a. Go to Developers → API keys
   b. Copy the Publishable key (`pk_test_...`) → put in `composeApp/local.properties` as `STRIPE_PUBLISHABLE_KEY`
   c. Copy the Secret key (`sk_test_...`) → put in server `.env` as `STRIPE_SECRET_KEY`
5. Set up webhook:
   a. Developers → Webhooks → Add endpoint
   b. Endpoint URL: `http://YOUR_VM_EXTERNAL_IP:8000/api/ads/payments/webhook`
   c. Events to listen for: `payment_intent.succeeded`, `payment_intent.payment_failed`
   d. Copy the Signing secret (`whsec_...`) → put in server `.env` as `STRIPE_WEBHOOK_SECRET`
6. Restart server: `pm2 restart playplace`
7. Test with Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC, any zip

## Phase 3: Build the Android App

1. Update `composeApp/local.properties`:
   ```
   SERVER_BASE_URL=http://YOUR_VM_EXTERNAL_IP:8000
   STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
   GOOGLE_WEB_CLIENT_ID=your_existing_client_id
   GOOGLE_MAPS_API_KEY=your_maps_key
   ```
2. In Android Studio: Build → Generate Signed Bundle / APK
3. Choose "Android App Bundle" (AAB)
4. Create a new keystore if you don't have one:
   - Key store path: pick a safe location (back this up — you need it for every future update)
   - Set passwords, alias, fill in org info (Lucht Applications LLC)
5. Select "release" build type
6. Click Finish — the AAB will be in `composeApp/build/outputs/bundle/release/`

## Phase 4: Google Play Console Setup

1. Go to https://play.google.com/console
2. Pay the $25 one-time developer registration fee
3. Create a new app:
   - App name: PlayPlace Finder
   - Default language: English (US)
   - App or game: App
   - Free or paid: Free
4. Fill in the Store listing (required before you can upload):
   - Short description (80 chars): "Find kid-friendly play places, parks, and activities near you"
   - Full description: describe the app features
   - App icon: 512x512 PNG (use your adaptive_icon_foreground_v2.png on teal background)
   - Feature graphic: 1024x500 PNG (create in Canva or similar)
   - Screenshots: at least 2 phone screenshots (take from your emulator or device)
   - Category: Parenting (or Maps & Navigation)
   - Contact email: your business email
5. Fill in Content rating questionnaire (required):
   - Go to Policy → App content → Content rating → Start questionnaire
   - Answer honestly — your app is family-friendly, no violence, no ads for mature content
6. Fill in Data safety section (required):
   - Your app collects: location, email, name (for account)
   - Data is encrypted in transit (HTTPS)
   - Users can request deletion (you have the delete account feature)
7. Set up Target audience:
   - NOT a "Designed for children" app (that triggers COPPA requirements)
   - Target audience: General / Everyone

## Phase 5: Internal Testing Release

1. In Play Console → your app → Testing → Internal testing
2. Click "Create new release"
3. Upload the AAB file from Phase 3
4. Add release notes: "Initial beta release"
5. Click "Review release" → "Start rollout to Internal testing"
6. Go to the "Testers" tab:
   - Create a new email list (e.g., "Beta Testers")
   - Add Gmail addresses of your testers
7. Copy the opt-in URL that Google provides
8. Share that URL with your testers — they click it, opt in, then install from the Play Store
9. Testers can install within minutes (no Google review for internal testing)

## Phase 6: UptimeRobot Setup

1. Go to https://uptimerobot.com and create a free account
2. Click "Add New Monitor"
3. Monitor type: HTTP(s)
4. Friendly name: "PlayPlace Finder API"
5. URL: `http://YOUR_VM_EXTERNAL_IP:8000/api/health`
6. Monitoring interval: 5 minutes
7. Alert contacts: add your email
8. Save
9. Add a second monitor for just the root (optional):
   - URL: `http://YOUR_VM_EXTERNAL_IP:8000/api/playgrounds`
   - This checks that the API actually responds to real requests

## Phase 7: MongoDB Atlas Alerts

1. Log into Atlas → your project
2. Go to Project → Alerts → Create Alert
3. Alert 1 — Disk usage:
   - Target: Cluster
   - Condition: Disk Usage % is above 80%
   - Notification: Email
4. Alert 2 — Connections:
   - Condition: Connections is above 400 (free tier limit is 500)
   - Notification: Email
5. Check your current data size: Cluster → Collections → see total size

## Going Live (When Ready)

When you're done beta testing and ready for real payments:

1. In Stripe dashboard, toggle from Test to Live mode
2. Get live API keys (`pk_live_...`, `sk_live_...`)
3. Update server `.env` with live keys
4. Create a new webhook endpoint with your production URL (use HTTPS by then)
5. Update `local.properties` with `pk_live_...`
6. Build a new AAB and upload to Play Console
7. Move from Internal testing → Production release (this triggers Google review, takes 1-7 days)

## Quick Reference

| Service | URL |
|---------|-----|
| GCP Console | https://console.cloud.google.com |
| Stripe Dashboard | https://dashboard.stripe.com |
| Google Play Console | https://play.google.com/console |
| MongoDB Atlas | https://cloud.mongodb.com |
| UptimeRobot | https://uptimerobot.com |
| Firebase Console | https://console.firebase.google.com |
| Health Check | http://YOUR_VM_IP:8000/api/health |

---

## Roadmap: Beta Phase Items

### Ad Distance Display — Optional Business Address (During Beta)
- Estimated effort: 1-2 days
- Optional business address field on BusinessInfoScreen (Google Places autocomplete, geocoded to lat/lng)
- Toggle on CreativeContentScreen: "Show distance to your business on your ad?"
- Server stores businessLat/businessLng/businessAddress on advertiser + showDistance flag on campaign
- Ad serving includes coordinates when showDistance=true
- FeaturedAdCard and SponsoredListingCard show "📍 X.X mi" when coordinates present
- Fully optional — ads without an address just don't show distance

### Remove Ads — One-Time In-App Purchase (During Beta)
- Estimated effort: 2-3 days
- "Remove Ads" button in profile/settings screen
- Use Google Play Billing Library for one-time IAP (~$2.99)
- Purchase happens inside the app via Google's payment sheet (not Stripe)
- Create product in Google Play Console, add BillingClient wrapper in Kotlin
- Server endpoint verifies purchase token with Google's API, sets `adFree: true`
- Ad serving already checks `adFree` flag — no changes needed there
- Two paths to ad-free: contribute enough to earn it (leaderboard perk) or pay the one-time fee
- Play Store listing tags: "Free", "Contains ads", "In-app purchases"
- Google takes 15% cut (small developer program) but handles refunds, family sharing, cross-device

### Saved Filters — Phase 1: Remember Last Filters (During Beta)
- Estimated effort: 0.5 day
- Persist current filter state to Android DataStore/SharedPreferences after each search
- On filter panel open, pre-fill with last-used filters
- No server changes, no UI changes beyond auto-restoring state
- Covers 80% of the use case with minimal work

### Saved Filters — Phase 2: Named Saved Searches (Post-Beta)
- Estimated effort: 1-2 days
- "Save this search" button in filter panel, user names the preset
- "Saved Searches" section on home screen or filter panel
- Store locally (DataStore) or server-side (new `savedFilters` collection)
- Tap a saved search → applies filters and runs search
- Edit/delete saved searches

### Automated Testing Suite (Post-Beta)
- Estimated effort: 3-5 days
- Server: Jest tests for pricing calculations, payment flows, campaign lifecycle, ad serving
- Kotlin: Basic UI tests with Compose Testing for critical flows (login, search, ad submission)
- Focus on regression prevention for the most-changed code paths
- Not required for Play Store but good insurance as the codebase grows

### Email Verification (During Beta)
- Estimated effort: 0.5-1 day
- Spec: .kiro/specs/email-verification/
- Steps:
  1. Add sendEmailVerification() call after email/password registration in LoginScreen
  2. Add verification banner to HomeScreen for unverified users
  3. Add write-action gating dialog
  4. Optional: add server-side email_verified check middleware
  5. Test with email/password signup flow

### Additional Login Providers (During Beta)
- Estimated effort: 4-5 days
- Spec: .kiro/specs/additional-login-providers/
- Steps:
  1. Enable Facebook and Apple providers in Firebase Console
  2. Create Facebook App at developers.facebook.com, get App ID and Secret
  3. Add Facebook Login SDK to Android dependencies
  4. Configure Apple Sign-In in Apple Developer account
  5. Add Facebook and Apple sign-in buttons to LoginScreen
  6. Implement account linking for existing users
  7. Test all sign-in flows end-to-end

## Roadmap: Pre-Production Items

### Website Phase 1 — Landing Page (Before Go-Live)
- Estimated effort: 1-2 days
- Spec: .kiro/specs/website-launch/
- Steps:
  1. Create Next.js or static site project
  2. Build landing page with app info, screenshots, download links
  3. Build "Advertise With Us" page with package info
  4. Write and host Privacy Policy at play-place-finder.com/privacy
  5. Write and host Terms of Service at play-place-finder.com/terms
  6. Write and host Advertiser Agreement at play-place-finder.com/advertiser-agreement
  7. Deploy to Vercel (free tier), configure DNS for play-place-finder.com
  8. Submit privacy policy URL to Google Play Console

### iOS Port (After Android Stable)
- Estimated effort: 10-14 days
- Spec: .kiro/specs/ios-port/
- Steps:
  1. Add iOS targets to build.gradle.kts (iosX64, iosArm64, iosSimulatorArm64)
  2. Create Xcode project wrapping the KMP Compose framework
  3. Refactor EventDateUtils.kt to use expect/actual (remove java.time)
  4. Implement Apple MapKit via UIKitView interop
  5. Add Firebase iOS SDK, configure GoogleService-Info.plist
  6. Implement Sign in with Apple (required by App Store)
  7. Add Stripe iOS SDK, wire PaymentSheet
  8. Implement CLLocationManager wrapper
  9. Implement PHPickerViewController for image picking
  10. Test on iOS simulator and physical device
  11. Enroll in Apple Developer Program ($99/year)
  12. Create App Store listing (screenshots, description, icon)
  13. Submit to TestFlight for beta testing
  14. Submit to App Store for review

### Website Phase 2 — Admin Portal (After Go-Live)
- Estimated effort: 1-2 weeks
- Spec: .kiro/specs/website-launch/ (Phase 2)
- Steps:
  1. Add Firebase Auth web SDK for admin login
  2. Build admin dashboard pages (campaigns, regions, analytics, discounts)
  3. Connect to same server API as mobile app
  4. Deploy alongside Phase 1 site

### Website Phase 3 — Full Web App (Growth Phase)
- Estimated effort: 2-4 weeks
- Spec: .kiro/specs/website-launch/ (Phase 3)
- Steps:
  1. Build search + map experience with Google Maps JS API
  2. Create SEO-friendly place detail pages with SSR
  3. Add user accounts, favorites, lists
  4. Add Stripe.js for web payments
  5. Add structured data for Google rich results

## Implementation Priority Order

1. ✅ Android beta testing (current — deploy server, upload to Play Console)
2. Email verification for email/password signups (during beta)
3. Additional login providers — Facebook + Apple (during beta)
4. Website Phase 1 — landing page + legal pages (before go-live)
5. Stripe live keys + production release (go-live)
6. iOS port via KMP (after Android stable)
7. Website Phase 2 — admin portal (after go-live)
8. Website Phase 3 — full web app (growth phase)
