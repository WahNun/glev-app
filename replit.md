# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system. It aims to provide personalized insulin recommendations by analyzing historical meal data, glucose levels, and insulin dosages. The project integrates with Supabase for authentication and data storage, and leverages AI for meal parsing and recommendation logic. The primary goal is to empower users with better control over their diabetes management through data-driven insights and decision support.

## User Preferences

- I prefer simple language.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.

## System Architecture

**Frontend:**
- Built with Next.js 15 App Router, running on port 5000.
- UI/UX utilizes a theming system defined in `app/globals.css`, with both dark and light modes. Brand accents are constant.
- Mobile-first design with responsive layouts, including a sidebar navigation for desktop and bottom navigation for mobile.
- Specific pages are intentionally kept dark for fixed product mockups (e.g., `app/mockups/dark-cockpit/page.tsx`).

**Backend/API:**
- Supabase handles user authentication (email/password) and PostgreSQL database operations.
- `src/middleware.ts` protects all authenticated routes.
- An Express 5 API server (`artifacts/api-server`) is available for development support.

**Core Logic & Features:**
- **Meal Classification:** Meals are categorized into `FAST_CARBS`, `HIGH_PROTEIN`, `HIGH_FAT`, or `BALANCED` based on macro-nutrient content.
- **Dose Evaluation:** Insulin doses are evaluated as `GOOD`, `HIGH` (overdose), or `LOW` (underdose) using an ICR formula based on carbs and glucose levels.
- **Glev Engine:** Provides AI-driven insulin recommendations by finding similar historical meals and classifying confidence levels (HIGH, MEDIUM, LOW). The Engine page features a dynamic layout for chat interaction based on device size.
- **Data Seeding:** On dashboard load, `seedMealsIfEmpty` inserts realistic T1D meals for new users.
- **Localization:** Uses `next-intl` with `de` (default) and `en` locales. Locale resolution prioritizes cookies, then `Accept-Language` headers.
- **Insulin & Exercise Logging (v0.5):** New tables (`insulin_logs`, `exercise_logs`) and associated API routes and helper functions for recording and retrieving insulin dosages and exercise activities. The Engine now considers these logs for recommendations. Safety hooks provide warnings but do not alter dosage.
- **Native Shells (Capacitor):** iOS and Android apps are thin Capacitor 8.x webview shells loading the live web app (`https://glev.app`), enabling instant content updates without app store resubmission.

**Data Models:**
- `meals` table stores meal entries with details like `input_text`, `parsed_json` (food breakdown), `glucose_before`, `glucose_after`, `carbs_grams`, `insulin_units`, `meal_type`, and `evaluation`.
- `user_preferences` table stores per-user UI preferences, such as dashboard and insights card order.

## External Dependencies

- **Supabase:** PostgreSQL database and authentication service. Handles user authentication (email/password) and database operations. Includes a `user_preferences` table for per-user UI settings.
- **OpenAI GPT-5:** Used for AI functionalities like meal parsing, accessed via Replit AI Integrations.
- **Next.js 15:** Frontend framework (App Router) running on port 5000.
- **React:** UI library.
- **Vite:** Frontend tooling for design sandbox.
- **Express 5:** API server framework (`artifacts/api-server`) for development support.
- **next-intl:** Localization library supporting `de` (default) and `en` locales.
- **Playwright:** End-to-end and unit testing framework.
- **Capacitor 8.x:** Used for wrapping the web application into native iOS and Android shells for `https://glev.app`.
- **Web Speech API:** For voice input functionality.
- **HealthKit (iOS):** For background blood glucose synchronization.

## Database: Supabase `user_preferences` Table

Stores per-user UI preferences such as the long-press drag-and-drop card
order on the Dashboard and Insights pages.

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_card_order    JSONB NOT NULL DEFAULT '[]'::jsonb,
  insights_card_order     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences"
  ON user_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

API: `GET /api/preferences` returns the saved arrays (empty when none),
`POST /api/preferences` upserts either or both keys
(`dashboard_card_order`, `insights_card_order`).

## Frontend Routes

All protected routes live under `src/app/(protected)/` and require Supabase auth.

| Route | Page |
|-------|------|
| `/dashboard` | Dashboard — flip cards, glucose trend, outcome chart, recent entries, seed data trigger |
| `/log` | Voice-first meal logging — mic button, dual panel (raw + parsed), macros, insulin preview |
| `/entries` | Entries table — expandable rows with full food breakdown |
| `/insights` | Deep analytics — performance tiles, meal type analysis, time-of-day, pattern detection |
| `/engine` | Glev Engine — AI insulin recommendation from historical data |
| `/import` | Import Center — CSV paste, preview, bulk import |
| `/settings` | Account / Settings — profile overview, glucose targets, ICR, notification toggles |

## Key Source Files

- `src/lib/meals.ts` — Meal interface, ParsedFood, saveMeal, fetchMeals, seedMealsIfEmpty, classifyMeal, computeEvaluation
- `src/lib/supabase.ts` — Supabase browser client
- `src/lib/auth.ts` — signIn, signUp, signOut, getCurrentUser
- `src/middleware.ts` — Next.js route protection
- `src/components/Layout.tsx` — Sidebar nav (desktop) + bottom nav + FAB (mobile)
- `src/app/api/parse-food/route.ts` — AI meal parser (returns full macros per food)
- `src/app/(protected)/layout.tsx` — Protected layout wrapper
- `lib/time.ts` — `parseDbTs` / `parseDbDate` / `parseLluTs`. Defensive parsers for DB timestamps (handles both `timestamptz` and accidentally‑naive `timestamp` cols by appending "Z") and for LibreLinkUp's `M/D/YYYY h:mm:ss AM/PM` server‑UTC strings (decoded via `Date.UTC(...)` and rendered in the device TZ). All UI code reading `created_at`, `meal_time`, `bg_1h_at`, `bg_2h_at`, or LLU `Timestamp`/`history[].timestamp` MUST use these helpers — never raw `new Date(s)` / `Date.parse(s)`.
- `lib/emails/outbox.ts` — Durable email queue. Both Stripe webhooks (`app/api/webhooks/stripe/route.ts` for Beta and `app/api/pro/webhook/route.ts` for Pro) call `enqueueEmail()` instead of Resend directly so Resend outages or server crashes between Stripe-Ack and send don't drop the welcome mail. Supported templates: `"beta-welcome"`, `"pro-welcome"` — adding a new one requires extending the `EmailTemplate` union AND the `renderTemplate` switch (TS exhaustive check enforces this). The cron worker `app/api/cron/flush-outbox/route.ts` (Bearer-auth via `CRON_SECRET`) drains pending rows with exponential backoff (2/4/8/16 min) up to 5 attempts, then marks `dead` and logs an admin alarm. Table: `email_outbox` (migration `20260501_add_email_outbox.sql`). The cron is fired by `.github/workflows/flush-outbox.yml` every ~2 min — requires both a `CRON_SECRET` repo *secret* and (optionally) a `PROD_APP_URL` repo *variable* in GitHub repo settings, mirroring the same Replit Secret. On enqueue failure the webhook returns 500 so Stripe retries; the DB writes above the enqueue are idempotent (status guards, upsert) so re-running them is safe.

## Core Logic

### Meal Classification (`classifyMeal`)
- `FAST_CARBS`: carbs ≥ 45g
- `HIGH_PROTEIN`: protein ≥ 25g and dominant
- `HIGH_FAT`: fat ≥ 20g and dominant
- `BALANCED`: otherwise

### Dose Evaluation (`computeEvaluation`)
- ICR formula: `estimated = carbs/15 + max(0, (glucose-110)/50)`
- `GOOD`: ratio within 0.65–1.35
- `HIGH`: ratio > 1.35 (overdose)
- `LOW`: ratio < 0.65 (underdose)

### Glev Engine (`engine/page.tsx`)
- Finds historical meals with ±12g carbs + ±35 mg/dL glucose similarity
- 3+ GOOD matches → HIGH confidence (historical average)
- 1–2 matches → MEDIUM confidence (blended)
- 0 matches → LOW confidence (ICR formula only)
- Desktop wizard layout (>768px): 2-column grid with `minmax(0, 1fr) 400px`, wizard left + sticky `EngineChatPanel` sidebar right. Mobile (<=768px) keeps the chat stacked inside Step 1's body. Single `chatPanelNode` const is rendered in exactly one location based on `isMobile`. Covered by `tests/e2e/engine-chat-sidebar.spec.ts`.

### Seed Data (`seedMealsIfEmpty`)
- Called on dashboard load; inserts 31 realistic T1D meals if user has 0 entries
- Covers breakfast/lunch/dinner, varied meal types, realistic glucose/insulin values

## Design Tokens

The full theme contract lives in `app/globals.css` and is keyed off
`<html data-theme="dark|light">`. Always reference theme via CSS variables —
do not hard-code surface/text/border literals.

```
Theme variables (Dark / Light values defined in app/globals.css):
  --bg, --surface, --surface-alt, --surface-soft
  --input-bg
  --border, --border-soft, --border-strong
  --text, --text-strong, --text-body, --text-muted, --text-dim, --text-faint, --text-ghost
  --shadow-card, --overlay, --browser-theme, --on-accent

Brand accents (constant across themes — per brand spec):
  Accent / Brand Blue:  #4F6EF7
  Green:                #22D3A0
  Orange:               #FF9500
  Pink:                 #FF2D78
  Yellow:               #FFD60A
```

Pages that follow the theme: `/` (landing), `/login`, `/welcome`, `/brand`, all
`(protected)/*` routes, `Layout.tsx`. White text on brand-blue buttons stays
`#fff` intentionally — it is readable on the accent color in both modes.

Pages intentionally **kept dark** regardless of theme (documented in source):
- `app/mockups/dark-cockpit/page.tsx` — fixed product mockup
- `components/AppMockupPhone.tsx` — iPhone-frame demo on marketing pages

## Dev Commands

```bash
pnpm --filter @workspace/glev run dev          # Start Next.js app (port 5000, clears .next cache)
pnpm --filter @workspace/glev exec tsc --noEmit  # TypeScript check
pnpm --filter @workspace/api-server run dev    # Start Express API server
npm test                                        # Playwright e2e suite (auto-reuses dev server on :5000)
```

### One-shot maintenance scripts

```bash
# Re-run the unified `lifecycleFor` evaluator (lib/engine/lifecycle.ts)
# over every row in the `meals` table and rewrite `evaluation` so the
# Dashboard's Control Score / Good Rate / Spike Rate / Hypo Rate
# reflect the post-Task #15 logic across the user's full history.
# Idempotent — safe to re-run; prints a per-bucket old→new diff matrix.
# Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx \
  scripts/backfillMealEvaluations.ts            # apply
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx \
  scripts/backfillMealEvaluations.ts --dry-run  # preview only, no writes
```

## Testing

End-to-end tests live under `tests/e2e/` and pure-function unit suites
under `tests/unit/`. Both are driven by Playwright's runner via
`npm test` (the runner's default `testMatch` picks up `*.spec.ts` and
`*.test.ts`).

- `playwright.config.ts` reuses the running dev server on port 5000 (`reuseExistingServer: true`); if nothing is listening, it boots `npm run dev` itself.
- On Replit it points Chromium at the Nix-managed binary in `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (the playwright-bundled `chromium-headless-shell` is missing system libs).
- `tests/global-setup.ts` provisions a Supabase test user (`playwright-theme@glev.test`) using `SUPABASE_SERVICE_ROLE_KEY`, rotates its password each run, and writes the credentials to `tests/.cache/test-user.json` (gitignored).
- Specs sign in through the real `/login` form, so middleware + Supabase cookie storage are exercised end-to-end.

### Automated check pipeline

`npm test` is registered with the Replit agent as the `test` validation
command, so it runs automatically on every code change before a task can
be merged. A failing test blocks the change and surfaces in the agent UI
with the failed spec name and a link to the full Playwright log.

- The check runs in the same Replit environment the agent develops in, so
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `ENCRYPTION_KEY`, and `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` are
  already available as secrets — nothing extra is hard-coded in the repo.
- The same `tests/global-setup.ts` flow provisions the
  `playwright-theme@glev.test` Supabase user with a fresh per-run
  password, so we never check a real credential in.
- The check is wired in via a `[[workflows.workflow]]` block named
  `test` in `.replit` with `metadata.isValidation = true`. To re-register
  or change the command, edit that block (or call
  `setValidationCommand({ name: "test", command: "npm test" })` via the
  validation skill, which writes the same block).
- To run the same check locally / on demand outside the agent, just
  invoke `npm test` directly — it shells out to the same Playwright
  config.

## Localization (i18n)

- Library: `next-intl` with locales `de` (default) and `en`. Messages in `messages/de.json` and `messages/en.json`.
- Locale resolution (`i18n/request.ts`): NEXT_LOCALE cookie → Accept-Language header (q-value parsed) → `de`.
- `lib/locale.ts` `setLocale` writes the cookie and persists `profiles.language` in Supabase for logged-in users.
- The `marketing` namespace covers all unauthenticated copy: nav/hero/how-it-works/feature trio/feature deep dive/pricing/FAQ/footer for `app/page.tsx`, plus `app/welcome/page.tsx` (loading/verifying/valid/invalid) and `app/brand/page.tsx` hero subtitle/tagline.
- Landing components in `components/landing/` are client components using `useTranslations("marketing")`. Brand-page body labels (color roles, hex codes, design-system terms) are deliberately left as-is — they are technical references.

## Notes

- `dev` script runs `rm -rf .next && next dev --port 5000` to prevent stale cache crashes
- Voice input uses Web Speech API with `window as unknown as Record<string, unknown>` cast
- Settings (ICR, glucose targets, notifications) persist in `localStorage` under `glev_settings`
- ParsedFood now includes `carbs, protein, fat, fiber` macros (updated in v3)
- Backward-compatible evaluation display: handles both old values (OVERDOSE/UNDERDOSE) and new (HIGH/LOW)

## Insulin & Exercise Logging (v0.5)

- **Tables**: `insulin_logs` (bolus/basal + units + name + cgm_glucose_at_log) and
  `exercise_logs` (hypertrophy/cardio + duration + intensity + cgm_glucose_at_log).
  Migration: `supabase/migrations/20260425_add_insulin_exercise_logs.sql`. Apply
  via the Supabase SQL editor (matches existing project convention — no Drizzle).
- **Helpers**: `lib/insulin.ts`, `lib/exercise.ts` (CRUD: insert / fetch / fetchRecent / delete).
- **API routes**: `/api/insulin` + `/api/insulin/[id]`, `/api/exercise` + `/api/exercise/[id]`
  (auth via shared `app/api/insulin/_helpers.ts → authedClient`).
- **Engine page** has two tabs:
  - `engine` → existing recommendation flow (now reads recent insulin + exercise logs).
  - `log` → `<EngineLogTab/>` for standalone bolus / basal / hypertrophy / cardio
    entries; auto-pulls latest CGM on submit. **Pure documentation — no calculations.**
- **Insights**: two new sections (`insulin-stats`, `exercise-stats`), 4 + 3 tiles,
  sortable alongside existing cards.
- **Engine safety hooks** (in `lib/engine/recommendation.ts` + `lib/engine/evaluation.ts`):
  optional `recentInsulinLogs` / `recentExerciseLogs` produce stacking warnings
  (>2 bolus in 6h), basal-context notes (last 24h), and exercise-sensitivity hints
  in the reasoning string only — never mutate the dose.
- **Compliance**: kein Insulinrechner. Logging only. See `BACKLOG.md` for Whoop +
  Nike workout-library follow-ups (deliberately out of scope).

## Native (Capacitor) — iOS & Android shells for `https://glev.app`

The web app is shipped natively via **Capacitor 8.x** in `server.url` mode:
the iOS / Android binaries are thin webview shells that load the live
Vercel-hosted `https://glev.app` build. This means content updates roll
out the moment the web build deploys — no resubmission required for
day-to-day changes (only native API / plugin / icon changes need a new
binary).

### Files

- `capacitor.config.ts` — single source of truth. `appId: app.glev`,
  `appName: Glev`, `webDir: www`, `server.url: https://glev.app`,
  `androidScheme: https`, `ios.contentInset: always`.
- `www/index.html` — placeholder shown only if the remote URL fails
  before the webview loads it. Required because Capacitor's CLI
  insists on a `webDir` even when `server.url` is set.
- `ios/` — Xcode project skeleton (Swift Package Manager, no Pods).
  Note: `ios/App/App/AppDelegate.swift` registers an `HKObserverQuery`
  + `enableBackgroundDelivery(.immediate)` for blood glucose so iOS
  silently wakes the app whenever a new HealthKit sample is written
  (even with Glev fully closed) and POSTs the delta to
  `/api/cgm/apple-health/sync`. Cookies are bridged from
  `WKWebsiteDataStore` to share the WebView session. `Info.plist`
  includes `UIBackgroundModes: [fetch]` to give the wake handler its
  network budget.
- `android/` — Gradle project skeleton.
- `.gitignore` — excludes per-platform build outputs (`build/`,
  `.gradle/`, `DerivedData/`, `Pods/`, the regenerated synced
  `…/assets/public/` mirrors, etc.) but commits the native skeletons
  so a Mac/Java machine can build straight from clone.

### Native deps in `package.json`

`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`
all pinned at `^8.3.1`. They are NOT imported by the Next.js bundle —
they only run in the `npx cap …` CLI on a developer machine. Adding
them does not change the web build.

### Developer workflow

```bash
# After web changes that don't touch native config — usually nothing
# to do, since the shell loads https://glev.app live. If you DID touch
# capacitor.config.ts or native plugins:
npx cap sync                       # copy webDir + config into ios/android

# iOS (requires macOS + Xcode 15+):
npx cap open ios                   # opens ios/App/App.xcworkspace
# then in Xcode: select a team, build, run on device/simulator.

# Android (requires Android Studio + JDK 17+):
npx cap open android               # opens android/ in Android Studio
# then: Build > Generate Signed Bundle / APK.

# Diagnostic:
npx cap doctor                     # reports Capacitor + platform health
```

### Replit limitations

- `cap doctor` reports `Xcode is not installed` — expected, the Replit
  Linux container has no macOS toolchain. Xcode-only steps must be run
  on a Mac.
- `cap add android` works on Linux (just generates Gradle files), but
  actually **building** the APK requires JDK 17+ + Android SDK, which
  are not installed on Replit either. Build on Android Studio locally.

### What to do for App Store / Play Store

Out of scope for this commit — the project skeletons are in place but
the developer still has to: configure Apple Developer / Play Console
accounts, set bundle identifiers / signing certs, generate icons +
splash assets, fill in `Info.plist` privacy strings (mic, etc.) for
features the web app uses, and submit for review.

### iOS release pipeline (push-button TestFlight)

The old "open Xcode → bump versions → Product → Archive → Distribute App"
dance is gone. There are now three ways to ship an iOS build, all
non-interactive:

1. **From a Mac (Xcode 15+ installed, signed into the dev team):**
   ```bash
   bundle install                              # one-time
   bundle exec fastlane install_plugins        # one-time
   bundle exec fastlane ios beta               # bump build, archive, upload to TestFlight
   bundle exec fastlane ios beta bump:patch    # also bump MARKETING_VERSION x.y -> x.(y+1).0
   bundle exec fastlane ios release            # promote latest TestFlight build to App Store
   ```
   The `App Store Connect API key` env vars (`APP_STORE_CONNECT_API_KEY_ID`,
   `APP_STORE_CONNECT_API_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64`)
   live in `~/.fastlane/.env` — never commit them. Full setup docs are in
   [`fastlane/README.md`](fastlane/README.md).

2. **From GitHub (no Mac required):** Open the *Actions* tab, pick
   **iOS release**, click **Run workflow**, choose a bump strategy
   (`build` / `patch` / `minor` / `major` / `skip`) and a lane
   (`beta` / `release`). The workflow runs on a `macos-14` GitHub-hosted
   runner, executes the same Fastlane lanes, and pushes the bumped
   `project.pbxproj` back to the branch as `chore(ios): release X.Y.Z(N)
   [skip ci]`. Same secrets as above must exist in the repo's
   *Settings → Secrets and variables → Actions*.

3. **From a git push:** Push a tag matching `ios-v*` (e.g.
   `git tag ios-v1.2.0 && git push --tags`) and the same workflow
   triggers automatically with a build-number bump.

**Versioning.** Both `MARKETING_VERSION` (the user-visible `1.2.0`) and
`CURRENT_PROJECT_VERSION` (the integer build number TestFlight
uniqueness-checks against) live in `ios/App/App.xcodeproj/project.pbxproj`
and must match across the Debug + Release configs. Bumping is implemented
in pure Node at [`scripts/bump-ios-version.mjs`](scripts/bump-ios-version.mjs)
so the same logic runs on Replit (where Xcode is unavailable):

```bash
npm run ios:version          # show current versions
npm run ios:bump:build       # CURRENT_PROJECT_VERSION + 1
npm run ios:bump:patch       # MARKETING_VERSION patch + reset build to 1
node scripts/bump-ios-version.mjs build --set 42
node scripts/bump-ios-version.mjs marketing --set 2.0.0
```

The `fastlane ios beta` lane calls into this script and additionally
queries TestFlight via `latest_testflight_build_number` so it never
collides with an already-uploaded build for the current marketing version.

**Code signing.** The Xcode project uses automatic signing
(`CODE_SIGN_STYLE = Automatic`), which works out of the box on a developer
Mac that's signed into the team. For a fresh GitHub-hosted macOS runner,
add [`fastlane match`](https://docs.fastlane.tools/actions/match/) with a
private certificates repo + `MATCH_PASSWORD` secret — that step is
intentionally not committed because it requires team-specific config.

### Apple Health (HealthKit) — current state

The Capacitor side is fully wired and committed; releasing a HealthKit
binary to TestFlight is now a single `fastlane ios beta` (or one click in
GitHub Actions) — see *iOS release pipeline* above.

Already done in the repo:
- `@capgo/capacitor-health@8.4.x` installed and synced into
  `ios/App/CapApp-SPM/Package.swift` via `npx cap sync ios`.
- `ios/App/App/App.entitlements` declares
  `com.apple.developer.healthkit = true` and an empty
  `com.apple.developer.healthkit.access` array.
- `ios/App/App.xcodeproj/project.pbxproj` has
  `SystemCapabilities → com.apple.HealthKit = { enabled = 1 }` on the
  primary target, and both Debug + Release build configs reference
  `App/App.entitlements` via `CODE_SIGN_ENTITLEMENTS`.
- `ios/App/App/Info.plist` carries both
  `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`
  (German copy).

Releasing a HealthKit-capable binary to real iPhones is now:
1. `bundle exec fastlane ios beta` (locally on a Mac) **or** click
   *Run workflow* on the **iOS release** GitHub Action. Both bump
   versions, archive, and upload to TestFlight in one shot.
2. In App Store Connect → TestFlight: add the new build to a tester
   group, have a tester open Settings → Apple Health and confirm the
   permission prompt + glucose sync work.
3. `bundle exec fastlane ios release` (or run the GitHub Action with
   `lane = release`) to promote that build to App Store production
   and finish submission for review in App Store Connect.

See the *iOS release pipeline* section above for full setup details.
