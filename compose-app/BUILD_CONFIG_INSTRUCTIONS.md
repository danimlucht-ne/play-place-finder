# Android build configuration (`local.properties`)

Values are read from `compose-app/local.properties` (not committed) and injected into **`BuildConfig`**, which **`AppConfig`** exposes to shared Kotlin code.

## Required / common keys

```properties
# API (debug default is emulator → host machine)
SERVER_BASE_URL=https://your-api.example.com

# Google Sign-In (Web client ID from Firebase / Google Cloud)
GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com

# Maps (Android manifest placeholder)
GOOGLE_MAPS_API_KEY=your_maps_key
```

## Stripe — test vs live

Both **debug** and **release** builds use the same property name:

```properties
STRIPE_PUBLISHABLE_KEY=pk_test_...
# or, when you are ready for real charges (e.g. internal APK sideload — not Play Store required):
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

- **`pk_test…`** — use Stripe [test cards](https://docs.stripe.com/testing); no real money.
- **`pk_live…`** — **real charges**. The app shows a red **“Live payments”** banner on the ad checkout screen so this is obvious.
- Your **server** must use the matching **`sk_test_` / `sk_live_`** secret and (for webhooks) the correct signing secret for that mode.

You can ship a **release APK/AAB** signed locally and install it without the Play Store while you wait on DUNS; point **`SERVER_BASE_URL`** at production and set **`pk_live`** when you intend to run real payments.

## Dev networking: emulator, Wi‑Fi phone, USB + adb reverse

Set **`SERVER_BASE_URL`** in **`compose-app/local.properties`** (merged with `composeApp/local.properties` if present). See also comments in **`compose-app/gradle.properties`**.

| Setup | Typical `SERVER_BASE_URL` | Notes |
|--------|-------------------------|--------|
| **Android emulator** | `http://10.0.2.2:8000` | Emulator loopback to host (debug default in `build.gradle.kts` if unset). |
| **Physical phone, same Wi‑Fi as PC** | `http://<PC_LAN_IP>:8000` | e.g. `192.168.x.x`. Allow the API port in the **Windows firewall** for Private networks. Server should listen on **`0.0.0.0`**. |
| **USB + port reverse** | `http://127.0.0.1:8000` | Run `adb reverse tcp:8000 tcp:8000` (can be used while Wi‑Fi is on). Traffic goes to the host machine. |

### Debug: switch URL without rebuilding (**Dev API URL**)

On **debug** builds only, **Admin Hub → Ads → Dev API URL** saves an optional override in app settings. If empty, the app uses **`BuildConfig.SERVER_BASE_URL`** from `local.properties`. If set, that value is used instead—handy for flipping between a LAN IP and `http://127.0.0.1:8000` without editing Gradle. **Release builds ignore this override.**

## Legacy Gradle note

Older docs referred to `build.gradle.kts` `project.findProperty` — the project now uses **`localProperties`** in `composeApp/build.gradle.kts` for `SERVER_BASE_URL`, `STRIPE_PUBLISHABLE_KEY`, and `GOOGLE_WEB_CLIENT_ID`.
