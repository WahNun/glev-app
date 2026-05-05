# Android Signing & Play Store Build

This document describes how to produce a signed Android App Bundle (AAB) of the
Glev app and upload it to Google Play Internal Testing. The Capacitor shell
loads the live `https://glev.app` web build, so this is a one-time native
packaging job; web releases ship through Vercel as usual.

The Gradle build itself runs on macOS (or any machine with Java 17+ and the
Android SDK installed) — Replit does not have Java, so only the project
preparation and `npx cap sync android` happen here.

## 1. Generate the upload keystore (one time)

On your Mac, create an RSA-2048 keystore that is valid for ~27 years (Play
requires the upload key to outlive any reasonable release schedule):

```bash
keytool -genkey -v \
  -keystore ~/glev-release.keystore \
  -alias glev \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

`keytool` will prompt for:

- A keystore password
- A key password (use the same value as the keystore password to keep things
  simple — Android Studio expects this)
- Your name, organizational unit, organization, city, state, country code

**Write all of these down** in your password manager. If you lose the keystore
or its passwords you cannot publish updates to the same app — Google does not
let you re-upload under a new key without going through key reset, which
requires Play App Signing enrollment and support tickets.

Recommended backups:

- Primary: 1Password / Bitwarden / iCloud Keychain (the `.keystore` file plus
  passwords)
- Secondary: encrypted USB stick stored offline

**Never commit the keystore.** `*.keystore` and `*.jks` are in the repo
`.gitignore`, but double-check before pushing if you copied the file into the
project tree.

## 2. Export the signing environment variables

Before running a release build, export the four variables the Gradle
`signingConfigs.release` block reads. Add them to your shell profile
(`~/.zshrc`) or a local `.envrc` that you source manually — never check them
into git.

```bash
export KEYSTORE_PATH="$HOME/glev-release.keystore"
export KEYSTORE_PASSWORD="…"
export KEY_ALIAS="glev"
export KEY_PASSWORD="…"
```

If any of these are missing the release build will fail at signing time with a
clear Gradle error. Debug builds (`./gradlew assembleDebug`) are unaffected and
use the auto-generated debug keystore.

## 3. Bump the version

Play Console requires `versionCode` to strictly increase between uploads.
`versionName` is the human-readable string shown in the store listing.

```bash
npm run android:version           # show current versionName + versionCode
npm run android:bump:build        # increment versionCode by 1
node scripts/bump-android-version.mjs marketing patch   # 1.0 -> 1.0.1
node scripts/bump-android-version.mjs release minor     # bump versionName + reset versionCode to 1
```

Both fields live in `android/app/build.gradle` and the script edits them
in-place.

## 4. Build the AAB

From the repo root:

```bash
npm run android:sync               # mirrors www/ + capacitor.config into android/
cd android
./gradlew bundleRelease
```

The signed bundle is written to:

```
android/app/build/outputs/bundle/release/app-release.aab
```

If you need a quick install on a connected device for smoke-testing instead of
a Play upload:

```bash
npm run android:build:debug        # produces android/app/build/outputs/apk/debug/app-debug.apk
```

## 5. Upload to Google Play Internal Testing

1. Open <https://play.google.com/console> and select the Glev app.
2. **Testing → Internal testing → Create new release**.
3. Upload `app-release.aab`. The first time, Play will offer to enroll you in
   Play App Signing — accept it; Google then re-signs your bundle with their
   managed app-signing key, and your local keystore becomes the *upload* key.
4. Add release notes (English + German if both locales are configured).
5. **Save → Review release → Start rollout to Internal testing**.
6. Add internal testers via **Testers** tab (email list or Google Group). They
   install through the opt-in URL Play generates.

Subsequent uploads only need a new `versionCode` (bump it via
`npm run android:bump:build`) and rebuilt AAB.
