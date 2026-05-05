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

## 6. Push Notifications via Firebase (FCM)

Android push notifications go through **Firebase Cloud Messaging** (FCM)
— the same way iOS goes through APNs. The Capacitor shell already has
the wiring (`@capacitor/push-notifications` plugin + the
`com.google.gms.google-services` Gradle Try/Catch in
`android/app/build.gradle`), but it stays disabled until a real
`google-services.json` is dropped into `android/app/`.

The file is **gitignored** (`android/.gitignore` → `app/google-services.json`)
because it contains the project's Firebase API key and project number.
A committed sibling `android/app/google-services.json.example` documents
the expected shape so you can sanity-check what Firebase gives you.

### 6.1 Create the Firebase project (one time)

1. Open <https://console.firebase.google.com/> with the Google account
   that should own Glev push.
2. **Add project** → name `Glev` (or `Glev Production`). Disable Google
   Analytics — we don't use it for push and it adds extra setup.
3. Inside the new project, **Project settings → General → Your apps →
   Add app → Android**.
4. Fill in:
   - **Android package name**: `app.glev` (must match
     `android/app/build.gradle` → `applicationId` exactly)
   - **App nickname**: `Glev Android`
   - **Debug signing certificate SHA-1**: optional for FCM-only setup;
     skip unless you also need Dynamic Links / Google Sign-In.
5. **Download `google-services.json`** when Firebase offers it. Save it
   to `android/app/google-services.json` in this repo. The Gradle
   Try/Catch picks it up automatically on the next build — you do not
   need to edit any `.gradle` file.
6. Skip the "Add Firebase SDK" and "Verify installation" wizard steps —
   they describe the native Java SDK, but we use the Capacitor plugin
   which already pulls FCM in transitively via the
   `com.google.gms.google-services` plugin.

### 6.2 Verify the build picks up the file

After dropping `google-services.json` into `android/app/`:

```bash
npm run android:sync
cd android
./gradlew assembleDebug
```

You should see a Gradle log line like
`> Task :app:processDebugGoogleServices` (proving the plugin is now
applied). If you see `google-services.json not found, google-services
plugin not applied. Push Notifications won't work` instead, the file
is in the wrong directory or empty.

### 6.3 Smoke-test from the Firebase Console

1. Install the freshly-built debug APK on an Android device
   (`adb install android/app/build/outputs/apk/debug/app-debug.apk`)
   or roll out an Internal Testing AAB and install via the Play tester
   link.
2. Open the app once so the Capacitor `PushNotificationsProvider`
   (`components/PushNotificationsProvider.tsx`) runs, requests the
   POST_NOTIFICATIONS permission, and registers an FCM token. Grant
   the prompt.
3. The token is stored in the WebView's `localStorage` under
   `glev_push_token` — you can read it via `chrome://inspect` →
   "Inspect" on the device → DevTools Console:
   ```js
   localStorage.getItem("glev_push_token");
   ```
4. In the Firebase Console: **Engage → Messaging → Create your first
   campaign → Firebase Notification messages → Send test message**.
   Paste the FCM token and **Test**.
5. The test push should arrive within a few seconds. If the app is in
   the foreground it lands in the system tray; if backgrounded it also
   wakes the device. Either is a passing smoke test.

### 6.4 Production checklist

- `google-services.json` is **per-project**, not per-build-variant.
  Same file works for debug and release as long as the
  `applicationId` matches.
- For Play Store distribution, no extra Play Console wiring is
  required — FCM uses the package name + Firebase project, not the
  Play upload key.
- If you ever rotate the Firebase project (e.g. moving from a personal
  to an org-owned account), download the new `google-services.json`,
  drop it in place, and rebuild. Old tokens stop working immediately;
  the next app launch re-registers and gets a fresh token.
