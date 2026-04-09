# PlayPlace Finder — iOS port specification (Compose Multiplatform)

This document is the working spec for adding an **iOS app** alongside the existing Android app. You can refine `commonMain` and Gradle on any machine; **building, signing, and Simulator testing require your Mac + Xcode**.

---

## 1. Goals

- Ship the **same product** as Android: shared UI and logic in `commonMain`, platform code in `androidMain` / `iosMain`.
- Prefer **native Apple stack** where it fits (MapKit, CoreLocation, Sign in with Apple) to reduce keys and review friction.
- Reuse the **existing backend** (same `PlaygroundService` endpoints, Stripe `clientSecret` flow, Firebase Auth tokens).

---

## 2. Current repository state (audit)

**Gradle (`composeApp/build.gradle.kts`):** only `androidTarget` is declared — **no `ios*` targets yet**.

**Already multiplatform-friendly:**

- `expect fun rememberLocationService(): suspend () -> LatLng?` in `commonMain` with `actual` in `androidMain` (`LocationService.android.kt`). **iOS needs `iosMain` `actual`.**
- Most models, `PlaygroundService`, Compose screens live in `commonMain`.

**Blocking issues in `commonMain` (must fix before iOS compiles):**

| Area | Files / notes |
|------|----------------|
| **Android `BuildConfig`** | `PlaygroundService.kt`, `WeatherService.kt`, `ConsentService.kt` import `org.community.playgroundfinder.BuildConfig`. iOS has no `BuildConfig`. **Replace with** `expect object AppConfig` / `actual` per platform (or `buildkonfig` / xcconfig + generated Kotlin). |
| **`java.time`** | `EventDateUtils.kt`, `PlaygroundDetailScreen.kt` (and tests). Kotlin/Native iOS does not use JVM `java.time`. **Migrate to** `kotlinx-datetime` or small `expect/actual` date helpers. |
| **`android.graphics.Color.parseColor`** | `HomeScreen.kt`, `PlaygroundItem.kt`, `PlaygroundDetailScreen.kt`. **Replace with** a small KMP helper (e.g. parse `#RRGGBB` / `#AARRGGBB` into `Color`) in `commonMain`. |
| **Android `Intent` / Maps deep link** | `PlaygroundDetailScreen.kt` opens Google Maps via `Intent`. **Replace with** `expect fun openMapsApp(lat, lng, label)` with iOS `actual` using `MKMapItem` or `http` Apple Maps URL. |
| **Erroneous Android import** | `PlaygroundItem.kt` imports `android.R.attr.fontWeight` — remove if unused; it will break non-Android compilation. |

**Android-only shell (not in `commonMain`, but iOS needs a parallel):**

- `App.kt` + `MainActivity.kt`: navigation, Firebase Auth, Stripe, image pickers, UCrop, back stack. **iOS entry** will be a separate `ComposeUIViewController` (or generated entry) + `App.ios.kt` (or shared `App` with platform hooks). Plan to **extract** token provider, navigation graph, and platform callbacks rather than copy-pasting 1000+ lines blindly.

**Android-only features to mirror on iOS:**

- **Ad creative image:** Android uses **UCrop** after pick. iOS spec: `PHPicker` + **TOCropViewController** (CocoaPods/SPM) or system crop if acceptable; then same upload API.
- **Google Sign-In + email auth:** Firebase iOS SDK + **Sign in with Apple** (required by App Store if Google sign-in exists).

---

## 3. Target layout

```
composeApp/src/
  commonMain/     ← UI + logic (must stay JVM/Android-free)
  androidMain/    ← Activity, Google Maps, Fused Location, Stripe Android, UCrop, Firebase Android
  iosMain/        ← ComposeUIViewController helpers, MapKit interop, CLLocationManager,
                    Stripe iOS, Firebase iOS, PHPicker/crop, AppConfig.actual
iosApp/           ← Xcode project (Swift host, embeds Kotlin framework — path TBD)
```

Official CMP pattern: Kotlin framework + thin Swift iOS app. Follow current [Compose Multiplatform iOS](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-ios.html) docs for your Kotlin/Compose versions.

---

## 4. Phase 0 — `commonMain` hygiene (do first)

1. Introduce **`expect object AppConfig`** (or equivalent) with `serverBaseUrl`, `stripePublishableKey`, `googleWebClientId` (if needed on iOS for Google), maps key only if using Google Maps on iOS.
2. **`androidMain` `actual`** reads from existing `BuildConfig`; **`iosMain` `actual`** reads from plist, `xcconfig`, or build setting injected into Kotlin (document the chosen approach in the PR).
3. Replace **`java.time`** usages with **`kotlinx-datetime`** in `EventDateUtils` and call sites.
4. Add **`parseHexColor(hex: String): Color?`** (or similar) and remove **`android.graphics.Color`** usage from shared UI.
5. Add **`expect fun openDirections(...)`** (or maps URL builder) and **`actual`** for Android `Intent` + iOS `MKMapItem` / universal URL.
6. Remove stray **`android.*`** imports from `commonMain`; run **`compileKotlinIosSimulatorArm64`** (once Phase 1 exists) to flush out remaining leaks.

**Exit criterion:** `commonMain` compiles for iOS targets with no Android/JVM-only APIs.

---

## 5. Phase 1 — Kotlin iOS targets + Xcode shell

### 5.1 Gradle (illustrative — align versions with project)

- Add targets: at minimum **`iosArm64()`** (device) and **`iosSimulatorArm64()`** (Apple Silicon Simulator). If you still use an **Intel Mac**, add **`iosX64()`** for Simulator.
- Register a **static framework** (name e.g. `ComposeApp`) for Compose iOS.
- **`iosMain` dependencies:** Ktor **`Darwin`** engine instead of CIO, e.g. `implementation(libs.ktor.client.darwin)` (add catalog entry if missing).
- Ensure **Compose Multiplatform** iOS support matches your plugin version (see Kotlin/Compose compatibility table).

### 5.2 Xcode

- Create **iOS App** target (Swift; bundle ID e.g. `org.community.playgroundfinder` — decide parity with Android `applicationId`).
- Embed/link the **compiled Kotlin framework** (CocoaPods `podspec` from Gradle, or manual framework embed — follow CMP template for your setup).
- **Minimum iOS version:** match Stripe/Firebase requirements (often **iOS 15+**; confirm before locking).

### 5.3 First runnable milestone

- **`Main.kt` / `MainViewController`**: show a single **Compose** screen (e.g. “Hello” or `MaterialTheme` + one shared composable).
- **Exit criterion:** app launches in **Simulator** from Xcode with Compose UI visible.

---

## 6. Phase 2 — Core platform features (recommended order)

1. **`rememberLocationService` `iosMain` `actual`** — `CLLocationManager`, permission strings in `Info.plist` (`NSLocationWhenInUseUsageDescription`, etc.).
2. **Maps** — **MapKit** inside **`UIKitView`** / interop; reuse `MapScreen` state (camera, markers). Alternative: Google Maps iOS SDK (extra API key + SDK weight).
3. **Firebase Auth** — add iOS app in Firebase Console; **`GoogleService-Info.plist`**; initialize in Swift `App` init; wire **ID token** into same `PlaygroundService` `tokenProvider` pattern as Android.
4. **Sign in with Apple** — capability + Firebase linkage; UI button on `LoginScreen` via platform callback.
5. **Stripe** — SPM `stripe-ios`; present **PaymentSheet** with same **`clientSecret`** flow as Android; bridge result back to Kotlin (`PaymentResult` equivalent).
6. **Image picking** — `PHPickerViewController` for playground photos + ad creative; optional crop library for ad banner parity with Android UCrop.
7. **Push (later)** — FCM + APNs; same server topics as Android when ready.

---

## 7. Configuration & secrets parity

| Secret / config | Android today | iOS approach |
|-----------------|---------------|--------------|
| API base URL | `BuildConfig.SERVER_BASE_URL` | `AppConfig` + `Info.plist` / xcconfig |
| Stripe publishable | `BuildConfig` | Same |
| Google Maps | manifest placeholder | Only if using Google Maps iOS |
| Firebase | `google-services.json` | `GoogleService-Info.plist` |
| Google Sign-In | Web client ID | iOS client ID + URL scheme in `Info.plist` |

Document **debug vs release** API hosts (mirror Android `local.properties` / build types).

---

## 8. App Store & compliance (snapshot)

- **Sign in with Apple** if **Google Sign-In** (or other third-party SSO) is offered.
- **Privacy manifest** / data collection declarations as required by current Apple rules.
- **Photo library** usage strings for picker; **location** strings for search/nearby.
- Screenshots, icon **1024×1024**, privacy policy URL (same as Android).

---

## 9. Effort estimate (rough)

| Phase | Calendar estimate | Notes |
|-------|-------------------|--------|
| Phase 0 — commonMain cleanup | 1–3 days | Depends on `BuildConfig` + `java.time` touch surface |
| Phase 1 — KMP + Xcode hello | 1–2 days | First green Compose frame |
| Location + MapKit | 2–4 days | Interop + polish |
| Auth + Sign in with Apple | 2–4 days | Console + entitlements |
| Stripe | 1–2 days | Parallel to Android flow |
| Pickers + ad crop | 1–2 days | |
| Full regression + TestFlight | 2–5 days | |
| **Total** | **~2–4 weeks** | One developer, part-time friendly |

---

## 10. Work on Windows vs Mac

| Task | Windows | Mac |
|------|---------|-----|
| Phase 0 refactors in `commonMain` | Yes | Yes |
| Add `iosMain` Kotlin source files (stubs) | Yes (won’t link) | Yes |
| Gradle `embedAndSign` / framework, Simulator | No | Yes |
| Xcode, signing, TestFlight | No | Yes |

**Suggested workflow:** complete **Phase 0** wherever you code; on your Mac, add **Phase 1** and turn on CI **`macos-latest`** for `compileKotlinIosSimulatorArm64` so regressions are caught early.

---

## 11. References

- [Compose Multiplatform — iOS](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-ios.html)
- [Ktor client engines — Darwin](https://ktor.io/docs/client-engines.html#darwin)
- [Firebase iOS setup](https://firebase.google.com/docs/ios/setup)
- [Stripe iOS Payment Sheet](https://stripe.com/docs/payments/accept-a-payment?platform=ios)

---

## 12. Changelog (spec only)

- **2026-04-01:** Expanded with repo-specific `commonMain` audit, phased plan, config parity table, and Windows/Mac split. Supersedes vague “refactoring needed” bullets with concrete file-level tasks.
- **2026-04-01:** **Phase 0 implemented in repo:** `expect object AppConfig` + Android `actual`; `kotlinx-datetime` in `EventDateUtils` / `PlaygroundDetailScreen`; `parseHexColor` in `commonMain`; `rememberOpenWalkingDirections` + Android `actual`; `PlaygroundService` / `WeatherService` / `ConsentService` use `AppConfig`; removed `java.time`, `android.graphics.Color`, and `Intent`/`Uri` from shared detail screen. **Placeholder images:** `expect fun playgroundPlaceholderPainter` in `commonMain`; Android `actual` maps types to `R.drawable` (no `android.R` in shared code). *Remaining before iOS target:* `iosMain` `actual` for placeholders + `App` shell / Firebase / Stripe on iOS.
