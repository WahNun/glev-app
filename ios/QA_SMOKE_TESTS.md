# iOS QA — Smoke Tests

Manual smoke-test procedures for the Capacitor iOS shell. The shell loads
`https://glev.app` in a WKWebView, so the only things worth exercising
natively are the bridges that the web bundle cannot reach on its own
(HealthKit, push, deep links).

Mirror the structure of `android/SIGNING_SETUP.md` §6.3 — each section is
self-contained and ends with a clear pass/fail signal.

## 1. Apple Health daily steps end-to-end (Task #338)

This validates the full wire:

```
HealthKit (simulator) →
  @capgo/capacitor-health.readSamples({ dataType: "stepCount" }) →
    lib/cgm/appleHealthClient.ts → syncRecentSteps() →
      POST /api/health/steps/sync →
        daily_activity_summary (Supabase) →
          Insights "Daily Steps" card
```

The unit suite (`tests/unit/healthSteps*.test.ts`) covers normalisation
and the migration, but the bridge + route + render path is only
exercised by hand. Run this checklist before each TestFlight build that
touches `lib/cgm/appleHealthClient.ts`, `app/api/health/steps/**`, or
the Daily Steps insights card in `app/(protected)/insights/page.tsx`.

### 1.1 Prerequisites (one-time, on macOS)

- Xcode 16+ with an iOS 17.4+ simulator runtime
  (HealthKit is only writable in the simulator from iOS 17 onward).
- Local checkout with `npm run ios:sync` working
  (`npx cap sync ios` from the repo root).
- A test account on `https://glev.app` whose CGM source is set to
  Apple Health (Settings → CGM source → Apple Health). The provider
  short-circuits if the source is anything else
  (`components/CgmAutoFillProvider.tsx` §`fetchCurrentSource`).
- Safari → Settings → Advanced → "Show Develop menu" enabled so you
  can attach DevTools to the simulator WebView.

### 1.2 Seed step data into the simulator's HealthKit

The iOS Simulator ships a real Health app. Manually adding steps is the
fastest way to get deterministic data:

1. Boot the simulator and launch **Health**.
2. **Browse → Activity → Steps → Add Data**.
3. Add at least three entries spanning the last 3 days, using
   memorable values you can grep for later, e.g.:
   - Yesterday 09:00 → `4242` steps
   - Today 08:00 → `1111` steps
   - Today 12:00 → `2222` steps (today's running total should be 3333)
4. Note the device-local date for "today" — the sync buckets by
   `YYYY-MM-DD` in the simulator's local timezone
   (`appleHealthClient.ts` §`syncRecentSteps`).

Scripted alternative (CI / repeatable):

```bash
# From repo root, with the target simulator already booted.
xcrun simctl list devices booted
xcrun simctl health add-sample <UDID> \
  --type HKQuantityTypeIdentifierStepCount \
  --value 2222 --unit count \
  --start "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" \
  --end "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

(`simctl health` lands in Xcode 15.4+; if it errors with "unknown
subcommand" fall back to the manual Health app entry above.)

### 1.3 Install and launch the shell

```bash
npm run ios:sync
npx cap open ios            # opens ios/App in Xcode
```

In Xcode: pick the same booted simulator → **Run**. On first launch:

- Accept the HealthKit prompt. It asks for **Blood Glucose**,
  **Steps**, and **Active Energy** in a single sheet
  (`appleHealthClient.ts` §`requestAuthorization`). All three must be
  toggled **on** — Apple does not distinguish "denied" from "not
  granted" on read, so a missed toggle silently returns zero samples.
- Log in with the Apple Health test account.

### 1.4 Trigger and verify the sync

`CgmAutoFillProvider` runs `syncRecentSteps()` 1.5 s after auth and on
every `visibilitychange` → `visible` event. The cheapest manual
trigger is to background and foreground the app once.

In Safari (macOS):

1. **Develop → Simulator → glev.app** (the WebView title).
2. In the DevTools **Console**:

   ```js
   // Force a fresh sync window
   localStorage.removeItem("glev:apple-health:last-steps-sync-iso");
   // Drive the provider's visibility hook
   document.dispatchEvent(new Event("visibilitychange"));
   ```

3. Switch to the **Network** tab and confirm a
   `POST /api/health/steps/sync` returns **200** with a body like
   `{ "upserted": 2, "skipped": 0 }` (one row per device-local day
   present in the seed).
4. In **Console** again, confirm no red errors from
   `appleHealthClient` (the module swallows on purpose, but a thrown
   plugin-missing error shows up as a `console.warn`).

### 1.5 Verify the Insights card renders

1. In the shell, navigate to **Insights**.
2. Locate the **Daily Steps** card (`daily-steps` id, rendered around
   `app/(protected)/insights/page.tsx` L2937). The card only appears
   when there is at least one row in `daily_activity_summary` for the
   user, so its presence alone proves the round-trip worked.
3. Assert the **Today** value matches the sum of today's seeded
   entries, formatted with the locale's thousands separator
   (e.g. `3.333` in `de`, `3,333` in `en`).
4. Assert the **7-day average** is roughly `(yesterday + today) / 7`
   (other days are zero).
5. Long-press / tap the info icon to flip the card. The back side
   ("Was bedeutet das?") must render — proves the i18n keys
   `daily_steps_back_*` are present in both locales.

### 1.6 Recording the result

Drop a one-line entry into the QA log section below with date, build
number, simulator runtime, and pass/fail. If it failed, link the
DevTools network/console screenshot.

```
2026-05-18 · build 1.2.3 (47) · iOS 17.5 · PASS  · @your-handle
2026-05-18 · build 1.2.3 (48) · iOS 17.5 · FAIL  · POST returned 500, see screenshots/2026-05-18-steps-500.png
```

### 1.7 Common failure modes

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| `POST` never fires | CGM source is not `apple_health` | Settings → CGM source; `fetchCurrentSource()` in `components/CgmAutoFillProvider.tsx` |
| `POST` 401 | WebView lost the Supabase cookie | re-login; check `authenticate()` in `app/api/cgm/_helpers.ts` |
| `POST` 200 with `upserted: 0` | HealthKit returned zero samples | re-check the seed in the Health app; HealthKit permission toggle off |
| Card missing on Insights | row landed under a different `user_id` | Supabase SQL: `select * from daily_activity_summary where user_id = '<uid>' order by date desc;` |
| Card "Today" shows yesterday's count | sync ran before the seed window | re-run §1.4 after seeding |

## QA Log

Two kinds of entries are recorded here:

- **Static verification** — what can be reproduced in the Replit/Linux
  dev environment without a Mac: unit tests for the sync route's
  normalisation + the migration shape, plus a code-path read of
  `appleHealthClient.ts` / `CgmAutoFillProvider.tsx` /
  `app/(protected)/insights/page.tsx`. This confirms the
  contract/shape layers but cannot exercise the native bridge.
- **Simulator run** — the full §1.1–1.5 walkthrough on macOS. Required
  before each TestFlight build that touches the steps flow; this
  environment cannot execute it (no Xcode / no booted simulator).

| Date | Build | iOS | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-18 | main @ task-338 | n/a (static) | PASS | `npx playwright test tests/unit/healthStepsSync tests/unit/healthStepsMigrations` → 8/8 pass. Sync-route normalisation + `daily_activity_summary` migration shape verified. Simulator walkthrough deferred to next macOS TestFlight build (see §1). |
| _yyyy-mm-dd_ | _x.y.z (n)_ | _17.x_ | PASS/FAIL | first real simulator run goes here |
