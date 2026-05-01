# Fastlane — iOS release pipeline

This directory turns the old "open Xcode, click Archive, click Upload" dance
into a single command. It's the canonical way to ship a TestFlight build of
the Capacitor iOS shell at `ios/`.

## TL;DR

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

That's it. The same lane runs on a developer Mac and on the GitHub Actions
macOS runner (`.github/workflows/ios-release.yml`) — pushing the workflow's
"Run" button gives you a TestFlight build with zero local Xcode interaction.

## Lanes

| Lane | What it does |
| --- | --- |
| `fastlane ios versions` | Print the committed `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`. |
| `fastlane ios bump` | Increment `CURRENT_PROJECT_VERSION` only (no build). |
| `fastlane ios bump type:marketing kind:patch` | Bump `MARKETING_VERSION` (patch/minor/major), reset build to 1. |
| `fastlane ios beta` | Auto-bump the build number to one above TestFlight's latest, `npx cap sync ios`, archive, upload to TestFlight. |
| `fastlane ios beta bump:patch` | Same, but also bump `MARKETING_VERSION` (patch/minor/major). |
| `fastlane ios beta skip_bump:true` | Build + upload using whatever versions are already committed. |
| `fastlane ios release` | Promote the latest TestFlight build to App Store production (no rebuild, does not auto-submit for review). |

## Versioning

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

## Authentication

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

## Code signing

The Xcode project is configured for **automatic signing**
(`CODE_SIGN_STYLE = Automatic`). On a developer Mac that's already signed
into the Apple Developer team in Xcode, `fastlane ios beta` works out of the
box.

For a fresh CI macOS runner you'll want to switch to
[`fastlane match`](https://docs.fastlane.tools/actions/match/) so certs and
provisioning profiles get fetched from a private repo deterministically. That
setup is intentionally **not** baked into this Fastfile because it requires a
team-specific git URL and passphrase — add it when you wire the GitHub Action
to a real Apple Developer team.
