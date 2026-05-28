# Fastlane — iOS & Android release pipelines

This directory turns the old "open Xcode / Android Studio, click Archive / Generate
Signed Bundle, click Upload" dance into a single command per platform. It's the
canonical way to ship a TestFlight build of the Capacitor iOS shell and a Play
Store build of the Capacitor Android shell.

---

## iOS

### TL;DR

```bash
# One-time, on a Mac with Xcode 15+ installed:
gem install bundler            # if you don't have it
bundle install
bundle exec fastlane install_plugins

# One-time, in your shell (or ~/.fastlane/.env):
export APP_STORE_CONNECT_API_KEY_ID=ABCD1234EF
export APP_STORE_CONNECT_API_ISSUER_ID=00000000-0000-0000-0000-000000000000
export APP_STORE_CONNECT_API_KEY_BASE64="$(base64 -i AuthKey_ABCD1234EF.p8)"
export FASTLANE_TEAM_ID=XXXXXXXXXX        # Apple Developer team id

# Every release, from a clean checkout:
bundle exec fastlane ios beta             # bumps build, archives, uploads
```

### iOS Lanes

| Lane | What it does |
| --- | --- |
| `fastlane ios versions` | Print the committed `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`. |
| `fastlane ios bump` | Increment `CURRENT_PROJECT_VERSION` only (no build). |
| `fastlane ios bump type:marketing kind:patch` | Bump `MARKETING_VERSION` (patch/minor/major), reset build to 1. |
| `fastlane ios beta` | Auto-bump build number, `npx cap sync ios`, archive, upload to TestFlight. |
| `fastlane ios beta bump:patch` | Same, but also bump `MARKETING_VERSION` (patch/minor/major). |
| `fastlane ios beta skip_bump:true` | Build + upload using whatever versions are already committed. |
| `fastlane ios release` | Promote the latest TestFlight build to App Store production (no rebuild). |

### iOS Versioning

Both `MARKETING_VERSION` (user-visible "1.2.0") and `CURRENT_PROJECT_VERSION`
(the integer build number TestFlight uniqueness-checks against) live in
`ios/App/App.xcodeproj/project.pbxproj` and **must match across the Debug and
Release build configurations**.

The bump logic is implemented in pure Node at
[`scripts/bump-ios-version.mjs`](../scripts/bump-ios-version.mjs) so it works
on Linux/Replit (where Xcode is unavailable) too. Fastlane just shells out to
it. You can drive it directly:

```bash
node scripts/bump-ios-version.mjs show
node scripts/bump-ios-version.mjs build              # +1
node scripts/bump-ios-version.mjs build --set 42
node scripts/bump-ios-version.mjs marketing patch
node scripts/bump-ios-version.mjs release minor      # bump marketing + reset build
```

### iOS Authentication

We use the **App Store Connect API key** (not Apple ID + password + 2FA), so
the pipeline is non-interactive on CI:

1. App Store Connect → Users and Access → Integrations → App Store Connect API
2. Create a key with the `App Manager` role.
3. Download the `.p8` once (Apple won't show it again).
4. Export three env vars (or put them in `~/.fastlane/.env`):
   - `APP_STORE_CONNECT_API_KEY_ID` — the 10-char key id
   - `APP_STORE_CONNECT_API_ISSUER_ID` — the issuer UUID at the top of the page
   - `APP_STORE_CONNECT_API_KEY_BASE64` — `base64 -i AuthKey_<id>.p8`
     (or use `APP_STORE_CONNECT_API_KEY_PATH=/abs/path/AuthKey_<id>.p8`)

For GitHub Actions, store the same three values as repository secrets — the
provided workflow wires them up automatically.

### iOS Code Signing

Code signing is handled by **[fastlane match](https://docs.fastlane.tools/actions/match/)**.
Match stores the Distribution certificate and App Store provisioning profile in a
private git repo, encrypted with a shared passphrase. Any developer or CI runner
can fetch them in seconds without manual Xcode interactions.

### One-time setup (run once by a team member with Apple Developer admin access)

1. **Create a private `glev-certificates` repository** on GitHub (or GitLab,
   Bitbucket, etc.). This repo will hold the encrypted certs and profiles.

2. **Initialise match** — run from the repo root on a Mac enrolled in the Apple
   Developer team:

   ```bash
   export MATCH_GIT_URL=git@github.com:<org>/glev-certificates.git
   export MATCH_PASSWORD=<choose-a-strong-passphrase>
   export FASTLANE_TEAM_ID=XXXXXXXXXX
   bundle exec fastlane match init        # writes Matchfile (already committed)
   bundle exec fastlane match appstore    # generates + uploads cert + profile
   ```

   Save `MATCH_PASSWORD` somewhere safe (1Password, etc.) — it cannot be
   recovered from the repo.

3. **Add GitHub Actions secrets** (repo settings → Secrets and variables →
   Actions):

   | Secret | Value |
   | --- | --- |
   | `MATCH_GIT_URL` | SSH or HTTPS URL of `glev-certificates` |
   | `MATCH_PASSWORD` | The passphrase chosen above |
   | `MATCH_GIT_PRIVATE_KEY` | **(SSH only)** The private key half of a deploy key added to `glev-certificates`. Leave empty if you use an HTTPS URL with a deploy token embedded in `MATCH_GIT_URL` instead: `https://<token>@github.com/<org>/glev-certificates.git` |

   The four existing App Store Connect secrets
   (`APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`,
   `APP_STORE_CONNECT_API_KEY_BASE64`, `FASTLANE_TEAM_ID`) are also still
   required.

### How it works in the `beta` lane

The `beta` lane calls `match(type: "appstore", readonly: is_ci)` before
`build_app` whenever `MATCH_GIT_URL` is set:

- **On CI (GitHub Actions):** `is_ci` is `true` → match runs in read-only mode,
  installs the cert and profile, then `build_app` is called with
  `CODE_SIGN_STYLE=Manual`.
- **On a developer Mac with `MATCH_GIT_URL` set:** `is_ci` is `false` → match
  can also *write* (e.g. rotate an expiring cert). Same result otherwise.
- **On a developer Mac without `MATCH_GIT_URL`:** the match step is skipped
  entirely and Xcode automatic signing is used as before. This is the
  zero-config path for contributors who don't need to publish to TestFlight.

### Renewing or rotating certificates

When a Distribution certificate is about to expire (< 30 days), run this on a
Mac with Apple Developer admin access:

```bash
export MATCH_GIT_URL=git@github.com:<org>/glev-certificates.git
export MATCH_PASSWORD=<passphrase>
export FASTLANE_TEAM_ID=XXXXXXXXXX
bundle exec fastlane match appstore --force   # revoke old, generate new, push
```

CI runners will automatically pick up the rotated cert on their next run.

### Adding a new team member's Mac

Each developer who needs to build locally just needs:

```bash
export MATCH_GIT_URL=git@github.com:<org>/glev-certificates.git
export MATCH_PASSWORD=<passphrase>    # share via 1Password
export FASTLANE_TEAM_ID=XXXXXXXXXX
bundle exec fastlane match appstore   # fetches + installs cert + profile
```

Their Xcode project can then stay on automatic signing; match takes over when
`MATCH_GIT_URL` is present.

---

## Android

### TL;DR

```bash
# One-time, on any machine with JDK 17, Node 20, and Android SDK:
gem install bundler            # if you don't have it
bundle install
bundle exec fastlane install_plugins

# One-time, in your shell (or ~/.fastlane/.env):
export KEYSTORE_PATH=/abs/path/to/glev-release.keystore
export KEYSTORE_PASSWORD=your-keystore-password
export KEY_ALIAS=glev
export KEY_PASSWORD=your-key-password
export PLAY_STORE_JSON_KEY_DATA="$(base64 -i service-account.json)"

# Every release, from a clean checkout:
bundle exec fastlane android beta    # bumps versionCode, builds AAB, uploads to internal track
```

### Android Lanes

| Lane | What it does |
| --- | --- |
| `fastlane android versions` | Print the committed `versionName` / `versionCode`. |
| `fastlane android bump` | Increment `versionCode` only (no build). |
| `fastlane android bump type:marketing kind:patch` | Bump `versionName` (patch/minor/major), reset `versionCode` to 1. |
| `fastlane android beta` | Bump `versionCode`, `npx cap sync android`, build signed AAB, upload to internal track. |
| `fastlane android beta bump:patch` | Same, but also bump `versionName` (patch/minor/major). |
| `fastlane android beta skip_bump:true` | Build + upload using whatever versions are already committed. |
| `fastlane android release` | Promote current internal-track build to production (no rebuild). |

### Android Versioning

Both `versionName` (user-visible "1.2.0") and `versionCode` (the integer the
Play Store uniqueness-checks against) live in `android/app/build.gradle`.
`versionCode` **must strictly increase** across every Play Store upload.

The bump logic is implemented in pure Node at
[`scripts/bump-android-version.mjs`](../scripts/bump-android-version.mjs) so it
works on Linux/Replit (where no Android SDK is needed). Fastlane just shells
out to it. You can drive it directly:

```bash
node scripts/bump-android-version.mjs show
node scripts/bump-android-version.mjs build              # versionCode +1
node scripts/bump-android-version.mjs build --set 42
node scripts/bump-android-version.mjs marketing patch
node scripts/bump-android-version.mjs release minor      # bump versionName + reset versionCode
```

### Android Authentication

#### Play Store (upload)

We use a **Google Play service account** with the "Release manager" role (no
personal Google account prompts):

1. Google Play Console → Setup → API access → Link to a Google Cloud project
2. Create a service account, grant it "Release manager" role in Play Console.
3. Download the JSON key (one-time — Google won't show it again).
4. Base64-encode it and store as the `PLAY_STORE_JSON_KEY_DATA` env var:
   ```bash
   export PLAY_STORE_JSON_KEY_DATA="$(base64 -i service-account.json)"
   ```
   Alternatively, point `PLAY_STORE_JSON_KEY_PATH` at the raw JSON file.

For GitHub Actions, store the base64 value as the `PLAY_STORE_JSON_KEY_DATA`
repository secret — the provided workflow wires it up automatically.

#### Release signing (keystore)

The `android/app/build.gradle` `signingConfigs.release` block reads four env vars
at Gradle build time — no Fastfile changes needed:

```
KEYSTORE_PATH      absolute path to the .keystore file
KEYSTORE_PASSWORD  keystore password
KEY_ALIAS          key alias inside the keystore
KEY_PASSWORD       key password
```

For local builds, export those four vars before running `fastlane android beta`.
For GitHub Actions, store the keystore as `ANDROID_KEYSTORE_BASE64` (base64 of
the file) — the workflow decodes it to `/tmp/glev-release.keystore` at runtime
and sets `KEYSTORE_PATH` accordingly.

See `android/SIGNING_SETUP.md` for the one-time keystore generation steps.

### Android CI Workflow

`.github/workflows/android-release.yml` mirrors the iOS workflow:

- **Trigger:** `workflow_dispatch` (pick bump + lane in the GitHub UI) **or** push a tag `android-v*`.
- **Runner:** `ubuntu-latest` with JDK 17 (`temurin`), Node 20, Ruby 3.2.
- **Steps:** decode keystore + google-services.json from secrets → `bundle exec fastlane android beta/release` → commit version bump back to branch → upload AAB as artifact.
- **Required secrets:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_GOOGLE_SERVICES_BASE64`, `PLAY_STORE_JSON_KEY_DATA`.
