# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system. The **Next.js 15 App Router** (`src/`) is the primary production frontend running on port 5000. Authentication and data storage are handled by **Supabase**.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Production frontend**: Next.js 15 App Router (`src/`) — port 5000
- **Database + Auth**: Supabase (PostgreSQL + Auth)
- **AI**: OpenAI GPT-5 via Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **API server (dev support)**: Express 5 (`artifacts/api-server`)
- **Design sandbox**: React + Vite (`artifacts/mockup-sandbox`)

## Authentication

- Supabase Auth (email + password)
- Client: `src/lib/supabase.ts` using `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Session stored in Supabase cookies; `src/middleware.ts` protects all `/(protected)` routes
- `src/lib/auth.ts` — `signIn`, `signUp`, `signOut`, `getCurrentUser`

## Database: Supabase `meals` Table

Required columns:
```sql
id           uuid DEFAULT gen_random_uuid() PRIMARY KEY
user_id      uuid REFERENCES auth.users(id)
input_text   text
parsed_json  jsonb  -- array of {name, grams, carbs, protein, fat, fiber}
glucose_before integer
glucose_after  integer        -- NEW: add if missing
carbs_grams  integer
insulin_units decimal(5,2)
meal_type    text             -- NEW: FAST_CARBS | HIGH_PROTEIN | HIGH_FAT | BALANCED
evaluation   text             -- GOOD | LOW | HIGH | SPIKE
created_at   timestamptz DEFAULT now()
```

**Migration SQL** (run once in Supabase SQL editor):
```sql
ALTER TABLE meals ADD COLUMN IF NOT EXISTS glucose_after INTEGER;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS meal_type TEXT;
```

(glucose_before, carbs_grams, insulin_units, evaluation were added in an earlier migration)

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
