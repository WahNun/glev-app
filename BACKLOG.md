# Glev — Backlog

> Planned features that are explicitly **out of scope** for the current
> Insulin Logging / Exercise Logging / Engine "Log" tab release. Captured
> here so the spec doesn't drift back in.

## Whoop Integration
**Goal**: pull Whoop strain, recovery, sleep and HRV into the Engine context.
- OAuth 2.0 flow (Whoop developer account, redirect URI under `/api/whoop/callback`).
- Persist `whoop_tokens` per `user_id` (refresh handled server-side).
- Daily cron (`/api/cron/whoop-sync`) writes a `whoop_metrics` row:
  `recovery_pct`, `strain`, `sleep_minutes`, `resting_hr`, `hrv_ms`,
  `recorded_for` (date).
- Engine context: low recovery (< 33 %) → softer correction wording;
  high strain (> 18) → exercise sensitivity note in reasoning.
- UI: new "Recovery" tile in Engine + a Whoop card in Insights.
- Compliance: still **kein Insulinrechner** — Whoop data only annotates
  reasoning, never adjusts the dose number.

## Apple Health Daily Steps in Exercise Engine
**Goal**: pull HealthKit daily step counts (and optionally active energy)
into the Exercise Engine as a continuous activity context signal, alongside
the existing discrete `exercise_logs` workouts. Steps are a daily time
series, not a workout event, so they get their own table — manual workouts
and HealthKit data never double-count.

Scope (in):
- adult T1D on MDI/pen, iOS native shell only (Android / Google Fit out
  of scope); initial sync covers ~last 30 days (no multi-month backfill).

Scope (out):
- heart rate, sleep, VO2max, other HealthKit types.
- HealthKit **workout** sync into `exercise_logs` — the `source` /
  `external_id` columns landed in `20260518_extend_exercise_logs_apple_health.sql`
  as the fundament, but the actual HKWorkout import is a separate later
  task.
- ICR / bolus engine adjustments based on activity level (only annotates
  reasoning, never changes the dose).

Steps:
1. **Schema migration** — new table `daily_activity_summary(user_id,
   date, steps, active_minutes, source)` with `UNIQUE (user_id, date,
   source)` for idempotent per-day/source upserts; RLS + service-role
   ingest pattern mirrors `apple_health_readings`
   (`20260430_add_apple_health_cgm.sql`). The `exercise_logs.source` /
   `external_id` fundament already exists from
   `20260518_extend_exercise_logs_apple_health.sql` — no extra column
   work needed there.
2. **Engine query backwards-compat** — read paths on `exercise_logs`
   gain an optional `source` filter without changing existing behaviour
   (default = include all sources).
3. **Native HealthKit extension** — extend the existing `@capgo/capacitor-health`
   authorization call in `lib/cgm/appleHealthClient.ts` (currently `read:
   ["bloodGlucose"]`) to also request `stepCount` (and optionally
   `activeEnergyBurned`); add a foreground daily-aggregate query
   analogous to `syncRecent()`. Onboarding flow that surfaces the
   HealthKit permission needs the extra type added too.
4. **Sync endpoint** — new `POST /api/health/steps/sync` mirroring
   `app/api/cgm/apple-health/sync/route.ts`: auth via `authenticate(req)`,
   batch cap, upsert into `daily_activity_summary` with
   `onConflict: 'user_id,date,source', ignoreDuplicates: false` so a
   later-in-day re-sync overwrites the partial morning count.
5. **Engine integration** — make daily steps available as a context
   signal in `lib/exerciseEval.ts` / pattern recognition (read helper
   in `lib/dailyActivity.ts`); pure annotation, never alters dose math.
6. **UI** — Insights page: new `daily-steps` card (DE/EN) following
   the existing `card_{id}_title` / `swipe_ctx_{id}_{title,body}` /
   `swipe_dyn_{id}` i18n pattern; add `daily-steps` to
   `INSIGHTS_DEFAULT_ORDER` in `app/(protected)/insights/page.tsx`.
7. **Tests** — unit tests for the migration's defaults + unique index,
   the sync route's idempotency, and the engine's steps-as-context
   helper; manual QA path for the iOS permission re-prompt.

Compliance: same principle as everywhere else — keine direkten
Dosis-Anweisungen, Schritte rahmen die Reasoning-Texte, nie die Dosis.

## Nike Training Club / Sales-Style Workout Library
**Goal**: structured workout library so logging exercise becomes
"pick a session" instead of "type duration + intensity".
- Seed catalogue (`workouts` table): `id`, `name`, `category`
  (`hypertrophy | cardio | mobility | hiit`), `default_duration_minutes`,
  `default_intensity`, `tags[]`, `source` (NTC / Sales / custom).
- Engine Log tab: add a `<select>` populated from `/api/workouts` that
  pre-fills the duration + intensity fields when chosen.
- Stretch: per-user favourites + a "last 5 used" quick row.
- Stretch: ingest the Nike Training Club RSS / public catalogue once and
  cache it; never call NTC at request time.

---

## Done in this release (for reference, not a TODO)
- `insulin_logs` + `exercise_logs` tables + RLS.
- `lib/insulin.ts` + `lib/exercise.ts` CRUD helpers.
- `/api/insulin` + `/api/exercise` (GET / POST / DELETE) routes.
- Engine page tabs: **Engine** (recommendations) + **Log** (standalone
  insulin / exercise documentation, auto-pulls latest CGM on submit).
- Insights page: 4 insulin tiles + 3 exercise tiles, both sortable.
- Engine evaluation + recommendation: optional `recentInsulinLogs` /
  `recentExerciseLogs` produce stacking warnings, basal-context notes,
  and exercise-sensitivity hints in the reasoning string only.
