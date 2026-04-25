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
