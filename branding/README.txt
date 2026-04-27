Android launcher source of truth (full icon pack)

Place the contents of `app/src/main/res` from your Android icon export here as `android-launcher-res/`
(drawable, mipmap-*, mipmap-anydpi-v26, values).

Then from `playground-app/server` run:
  npm run apply:android-branding

That copies this tree into the Compose app `res/` folder and rebuilds website + Play Store PNGs.
