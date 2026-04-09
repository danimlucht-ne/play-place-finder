# Play Place Finder

**Single project checklist:** [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) (deploy, Play Store, roadmap, site & compliance).

This folder contains both the app and backend:

- **`compose-app/`**: Kotlin Multiplatform + Jetpack Compose client (Android/Desktop/iOS)
- **`server/`**: Node.js + Express backend (MongoDB + Google Cloud integrations)

## Run the backend

See `server/README.md`.

## Run the app

**API URL / device networking** (emulator vs Wi‑Fi vs USB, optional debug override): see **`compose-app/BUILD_CONFIG_INSTRUCTIONS.md`**.

Open `compose-app/` in Android Studio / IntelliJ and run:

- **Android**: `androidApp`
- **Desktop**: `desktopApp`

If you prefer CLI:

```bash
cd compose-app
gradlew.bat :androidApp:assembleDebug
gradlew.bat :desktopApp:run
```

