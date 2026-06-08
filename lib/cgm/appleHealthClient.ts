/**
 * Apple Health (HealthKit) on-device sync client.
 *
 * This module ONLY runs inside the Capacitor iOS shell (capacitor.config.ts
 * → server.url = https://glev.app). The native bridge is the only way to
 * read HealthKit — Apple does not expose it server-side. The same Vercel
 * web bundle is also loaded in regular browsers, so every plugin import
 * MUST be a dynamic `await import(...)` inside an `isNativePlatform()`
 * guard; a static import would crash the web build at module-load time.
 *
 * Sync strategy:
 *   - First sync of a session: pull the last 24 h of blood-glucose
 *     samples from HealthKit. This catches anything the user backfilled
 *     while the app was closed.
 *   - Subsequent syncs: pull the last ~3 h to keep the request small.
 *     The backend's UNIQUE INDEX on (user_id, source_uuid) makes the
 *     overlap idempotent — re-pushing samples is a no-op.
 *   - We POST `{ samples: [{ uuid, startDate, value, unit }] }` and
 *     let the server normalise mmol/L → mg/dL so the conversion
 *     constant lives in one place (app/api/cgm/apple-health/sync/route.ts).
 *
 * `last sync at` is persisted to localStorage so each foreground sync
 * only sends the delta; we never trust HealthKit's anchor cursor across
 * sessions because the plugin re-issues a fresh anchor per process.
 *
 * Error handling: every public function is non-throwing — failures are
 * swallowed and reported via the returned status object so the calling
 * UI can stay simple. The Settings card surfaces the last-sync time;
 * silent failure is preferable to popping a red toast every 5 min if
 * the user is offline.
 *
 * Background delivery (iOS-only, native shell):
 *   The Capacitor shell ALSO registers an `HKObserverQuery` +
 *   `enableBackgroundDelivery(.immediate)` for blood glucose in
 *   `ios/App/App/AppDelegate.swift` (see `HealthKitGlucoseBackgroundSync`).
 *   When a new sample is written to HealthKit while Glev is closed,
 *   iOS silently wakes the app process, runs an anchored query, and
 *   POSTs the delta to `/api/cgm/apple-health/sync` using cookies
 *   bridged from `WKWebsiteDataStore`. That keeps the server cache
 *   fresh for the post-meal CGM follow-up worker without requiring
 *   the user to open the app — the foreground sync below remains the
 *   user-visible "last sync" status and the safety net for the first
 *   24 h after install (before the observer has been armed).
 */

const LAST_SYNC_KEY = "glev:apple-health:last-sync-iso";
const FIRST_SYNC_HOURS = 24;
const INCREMENTAL_SYNC_HOURS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export interface SyncResult {
  ok: boolean;
  reason?:
    | "not-native"
    | "no-permission"
    | "plugin-missing"
    | "fetch-failed"
    | "no-samples";
  inserted?: number;
  skipped?: number;
  fetched?: number;
  error?: string;
}

/**
 * Derive a Dexcom-style trend string from an ordered array of HealthKit
 * readings (newest first) using the same slope thresholds as the
 * server-side deriveTrend() in lib/cgm/appleHealth.ts.
 *
 * Used by the Capacitor bridge before POSTing samples — this lets the
 * client-side display show a trend arrow immediately without waiting for
 * a server round-trip.
 */
export function calculateTrendDirection(
  readings: Array<{ value_mg_dl: number; timestamp: string }>
): string {
  const TREND_MIN_GAP_MS = 5 * 60 * 1000;
  const TREND_MAX_GAP_MS = 20 * 60 * 1000;
  const TREND_FLAT_MAX = 1;
  const TREND_QUICK_MIN = 2;
  if (readings.length < 2) return "stable";
  const cur = readings[0];
  const tCur = Date.parse(cur.timestamp);
  if (Number.isNaN(tCur)) return "stable";
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i];
    const tPrev = Date.parse(prev.timestamp);
    if (Number.isNaN(tPrev)) continue;
    const gap = tCur - tPrev;
    if (gap < TREND_MIN_GAP_MS) continue;
    if (gap > TREND_MAX_GAP_MS) return "stable";
    const rate = (cur.value_mg_dl - prev.value_mg_dl) / (gap / 60_000);
    const abs = Math.abs(rate);
    if (abs < TREND_FLAT_MAX) return "stable";
    return rate > 0
      ? abs >= TREND_QUICK_MIN ? "risingQuickly" : "rising"
      : abs >= TREND_QUICK_MIN ? "fallingQuickly" : "falling";
  }
  return "stable";
}

/**
 * Returns false if the user has revoked HealthKit permission or if we
 * are not running inside the Capacitor iOS shell. Called before each
 * sync attempt — if false and the user has apple_health selected, the
 * Settings card shows the permission-revoked banner.
 */
export async function isAppleHealthAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const mod = (await import("@capacitor/core")) as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (!mod.Capacitor?.isNativePlatform?.()) return false;
    const plugin = await loadPlugin();
    return !!plugin;
  } catch {
    return false;
  }
}

/** Cheap synchronous platform check — used by the React provider so it
 *  doesn't even mount the interval on the web. */
export async function isNative(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const mod = (await import("@capacitor/core")) as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    return !!mod.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * Request HealthKit read permission for blood glucose. iOS only prompts
 * once per install — after that the call resolves immediately whether
 * the user granted or denied. The plugin also can't reliably tell
 * "denied" apart from "granted" on iOS (Apple's privacy design), so we
 * just attempt the request and rely on subsequent reads succeeding /
 * returning empty as the real signal.
 */
export async function requestAuthorization(): Promise<{ ok: boolean; error?: string }> {
  if (!(await isNative())) return { ok: false, error: "not-native" };
  try {
    const plugin = await loadPlugin();
    if (!plugin) return { ok: false, error: "plugin-missing" };
    // Task #183: also request stepCount + activeEnergyBurned so the
    // engine's "daily activity" context signal can read them without a
    // second permission round-trip. iOS only prompts once per install,
    // so bundling the asks is strictly better UX than two prompts.
    // Also request `workouts` so syncRecentWorkouts() can read
    // HKWorkout sessions without a second permission round-trip.
    await plugin.requestAuthorization({
      read: ["bloodGlucose", "stepCount", "activeEnergyBurned", "workouts"],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Task #183: foreground sync for daily HealthKit step counts. Mirrors
 * `syncRecent()` for blood-glucose:
 *   - dynamic plugin load (web build never imports @capgo/capacitor-health)
 *   - first sync pulls 30 days, subsequent syncs pull last 3 days +
 *     overlap so today's growing partial count keeps overwriting
 *     yesterday's now-stable value
 *   - aggregates samples by device-local YYYY-MM-DD and POSTs to
 *     /api/health/steps/sync, which upserts by (user_id, date, source)
 */
const LAST_STEPS_SYNC_KEY = "glev:apple-health:last-steps-sync-iso";
const STEPS_FIRST_SYNC_DAYS = 30;
const STEPS_INCREMENTAL_DAYS = 3;

export interface StepsSyncResult {
  ok: boolean;
  reason?:
    | "not-native"
    | "no-permission"
    | "plugin-missing"
    | "fetch-failed"
    | "no-samples";
  upserted?: number;
  skipped?: number;
  days?: number;
  error?: string;
}

export async function syncRecentSteps(): Promise<StepsSyncResult> {
  if (!(await isNative())) return { ok: false, reason: "not-native" };
  const plugin = await loadPlugin();
  if (!plugin) return { ok: false, reason: "plugin-missing" };

  const now = Date.now();
  const lastSyncIso =
    typeof window !== "undefined"
      ? safeRead(LAST_STEPS_SYNC_KEY)
      : null;
  const sinceDays = (() => {
    if (!lastSyncIso) return STEPS_FIRST_SYNC_DAYS;
    const lastMs = Date.parse(lastSyncIso);
    if (!Number.isFinite(lastMs)) return STEPS_FIRST_SYNC_DAYS;
    const days = (now - lastMs) / 86_400_000;
    if (days >= STEPS_FIRST_SYNC_DAYS) return STEPS_FIRST_SYNC_DAYS;
    return Math.max(STEPS_INCREMENTAL_DAYS, Math.ceil(days) + 1);
  })();

  const startDate = new Date(now - sinceDays * 86_400_000).toISOString();
  const endDate = new Date(now).toISOString();

  let samples: PluginSample[] = [];
  try {
    const res = await plugin.readSamples({
      dataType: "stepCount",
      startDate,
      endDate,
      limit: 5000,
      ascending: true,
    });
    samples = Array.isArray(res?.samples) ? res.samples : [];
  } catch (e) {
    return {
      ok: false,
      reason: "no-permission",
      error: e instanceof Error ? e.message : "unknown",
    };
  }

  // Bucket per device-local calendar day. HealthKit returns one sample
  // per source app per ~hourly window — we sum them.
  const byDate = new Map<string, number>();
  for (const s of samples) {
    if (typeof s.value !== "number" || !Number.isFinite(s.value)) continue;
    const t = s.startDate ? new Date(s.startDate) : null;
    if (!t || Number.isNaN(t.getTime())) continue;
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    byDate.set(key, (byDate.get(key) ?? 0) + s.value);
  }

  if (byDate.size === 0) {
    safeWrite(LAST_STEPS_SYNC_KEY, new Date(now).toISOString());
    return { ok: true, reason: "no-samples", days: 0 };
  }

  const payload = [...byDate.entries()].map(([date, steps]) => ({
    date,
    steps: Math.round(steps),
  }));

  try {
    const res = await fetchWithTimeout("/api/health/steps/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples: payload }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "fetch-failed",
        error: `http ${res.status}`,
        days: payload.length,
      };
    }
    const j = (await res.json().catch(() => ({}))) as {
      upserted?: number;
      skipped?: number;
    };
    safeWrite(LAST_STEPS_SYNC_KEY, new Date(now).toISOString());
    return {
      ok: true,
      upserted: j.upserted ?? 0,
      skipped: j.skipped ?? 0,
      days: payload.length,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "fetch-failed",
      error: e instanceof Error ? e.message : "unknown",
      days: payload.length,
    };
  }
}

/**
 * Foreground sync for Apple Health workout sessions (HKWorkout).
 *
 * Mirrors `syncRecentSteps()`:
 *   - dynamic plugin load (web build never imports @capgo/capacitor-health)
 *   - first sync pulls 30 days, subsequent syncs pull at most 7 days
 *     with a small overlap so a workout written late by the watch
 *     gets picked up on the next tick
 *   - POSTs the raw HealthKit-shaped payload to
 *     /api/health/workouts/sync, which dedupes by (user_id, source,
 *     external_id) — re-sending the same uuid is a no-op.
 *
 * Throws never — returns a structured result so the Settings card
 * can render a unified "last sync" status alongside steps + glucose.
 */
const LAST_WORKOUTS_SYNC_KEY = "glev:apple-health:last-workouts-sync-iso";
const WORKOUTS_FIRST_SYNC_DAYS = 30;
const WORKOUTS_INCREMENTAL_DAYS = 7;
const WORKOUTS_OVERLAP_HOURS = 6;

export interface WorkoutsSyncResult {
  ok: boolean;
  reason?:
    | "not-native"
    | "no-permission"
    | "plugin-missing"
    | "fetch-failed"
    | "no-samples";
  inserted?: number;
  skipped?: number;
  fetched?: number;
  error?: string;
}

interface PluginWorkout {
  workoutType: string;
  startDate: string;
  endDate: string;
  platformId?: string;
  sourceId?: string;
  metadata?: Record<string, string | number | undefined>;
}

interface HealthKitWorkoutsPlugin {
  queryWorkouts(opts: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }): Promise<{ workouts: PluginWorkout[] }>;
}

export async function syncRecentWorkouts(): Promise<WorkoutsSyncResult> {
  if (!(await isNative())) return { ok: false, reason: "not-native" };
  const plugin = (await loadPlugin()) as
    | (HealthKitPlugin & Partial<HealthKitWorkoutsPlugin>)
    | null;
  if (!plugin || typeof plugin.queryWorkouts !== "function") {
    return { ok: false, reason: "plugin-missing" };
  }

  const now = Date.now();
  const lastSyncIso =
    typeof window !== "undefined" ? safeRead(LAST_WORKOUTS_SYNC_KEY) : null;
  const sinceDays = (() => {
    if (!lastSyncIso) return WORKOUTS_FIRST_SYNC_DAYS;
    const lastMs = Date.parse(lastSyncIso);
    if (!Number.isFinite(lastMs)) return WORKOUTS_FIRST_SYNC_DAYS;
    const days = (now - lastMs) / 86_400_000;
    if (days >= WORKOUTS_FIRST_SYNC_DAYS) return WORKOUTS_FIRST_SYNC_DAYS;
    // Small overlap so a workout the Watch wrote retroactively (it
    // sometimes back-dates by a few minutes) gets picked up on the
    // next tick instead of being permanently skipped.
    const withOverlap = days + WORKOUTS_OVERLAP_HOURS / 24;
    return Math.max(WORKOUTS_INCREMENTAL_DAYS, Math.ceil(withOverlap));
  })();

  const startDate = new Date(now - sinceDays * 86_400_000).toISOString();
  const endDate = new Date(now).toISOString();

  let raw: PluginWorkout[] = [];
  try {
    const res = await plugin.queryWorkouts({
      startDate,
      endDate,
      limit: 500,
      ascending: true,
    });
    raw = Array.isArray(res?.workouts) ? res.workouts : [];
  } catch (e) {
    return {
      ok: false,
      reason: "no-permission",
      error: e instanceof Error ? e.message : "unknown",
    };
  }

  if (raw.length === 0) {
    safeWrite(LAST_WORKOUTS_SYNC_KEY, new Date(now).toISOString());
    return { ok: true, reason: "no-samples", fetched: 0 };
  }

  const payload = raw
    .map((w) => {
      const uuid = w.platformId;
      if (!uuid) return null;
      if (!w.workoutType || !w.startDate || !w.endDate) return null;
      const meta = w.metadata || {};
      const avgHr = readNum(meta.averageHeartRate ?? meta.avgHeartRate);
      const maxHr = readNum(meta.maxHeartRate);
      return {
        uuid,
        workoutType: w.workoutType,
        startDate: w.startDate,
        endDate: w.endDate,
        ...(avgHr != null ? { avgHeartRate: avgHr } : {}),
        ...(maxHr != null ? { maxHeartRate: maxHr } : {}),
      };
    })
    .filter((x): x is {
      uuid: string;
      workoutType: string;
      startDate: string;
      endDate: string;
      avgHeartRate?: number;
      maxHeartRate?: number;
    } => x !== null);

  if (payload.length === 0) {
    safeWrite(LAST_WORKOUTS_SYNC_KEY, new Date(now).toISOString());
    return { ok: true, reason: "no-samples", fetched: 0 };
  }

  try {
    const res = await fetchWithTimeout("/api/health/workouts/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workouts: payload }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "fetch-failed",
        error: `http ${res.status}`,
        fetched: payload.length,
      };
    }
    const j = (await res.json().catch(() => ({}))) as {
      inserted?: number;
      skipped?: number;
    };
    safeWrite(LAST_WORKOUTS_SYNC_KEY, new Date(now).toISOString());
    return {
      ok: true,
      inserted: j.inserted ?? 0,
      skipped: j.skipped ?? 0,
      fetched: payload.length,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "fetch-failed",
      error: e instanceof Error ? e.message : "unknown",
      fetched: payload.length,
    };
  }
}

/**
 * One-shot deeper backfill for Apple Health workouts.
 *
 * `syncRecentWorkouts()` only reaches ~30 days back on the first pull
 * (and 7 days on subsequent ticks). Users with years of Apple Watch
 * history benefit from a deeper baseline so the engine + Insights
 * have richer pattern data from day one. This function pages
 * backwards in `BACKFILL_CHUNK_DAYS` windows until either:
 *   - it hits `BACKFILL_MAX_DAYS` (5-year hard safety cap), or
 *   - it encounters `BACKFILL_EMPTY_CHUNK_STOP` consecutive empty
 *     90-day windows (history exhausted, allowing for ~1.5 years of
 *     legitimate off-period inside it), or
 *   - the optional `signal` is aborted.
 *
 * Re-runs are safe: the server dedupes by (user_id, source, external_id),
 * so a second backfill is a no-op on the database side and only costs
 * the HealthKit reads.
 *
 * Reports per-chunk progress via the optional callback so the UI can
 * show a live "Synced X workouts (Y days back)" line.
 */
const BACKFILL_CHUNK_DAYS = 90;
const BACKFILL_MAX_DAYS = 365 * 5; // 5 years — hard safety cap
// Stop after this many consecutive empty 90-day windows — i.e. ~1.5
// years of zero workouts. Big enough to absorb realistic off-periods
// (injury, pregnancy, post-partum, long sabbatical) without giving
// up early, small enough that a fresh-install user with only the
// last few months of history finishes the backfill quickly instead
// of grinding through 5 years of empty queries.
const BACKFILL_EMPTY_CHUNK_STOP = 6;
// Must stay <= HEALTH_WORKOUTS_MAX_BATCH in lib/healthWorkoutsNormalise.ts
// (the /api/health/workouts/sync route returns 413 for larger batches).
// Kept as a local literal so this client module stays free of server-only
// imports.
const BACKFILL_POST_BATCH = 200;
const BACKFILL_DONE_KEY = "glev:apple-health:workouts-backfill-done-iso";

export interface BackfillProgress {
  chunkStartIso: string;
  chunkEndIso: string;
  daysBack: number;
  insertedThisChunk: number;
  fetchedThisChunk: number;
  totalInserted: number;
  totalFetched: number;
}

export interface BackfillWorkoutsResult {
  ok: boolean;
  reason?:
    | "not-native"
    | "no-permission"
    | "plugin-missing"
    | "fetch-failed";
  inserted: number;
  fetched: number;
  chunks: number;
  daysCovered: number;
  error?: string;
}

export async function backfillWorkouts(opts?: {
  onProgress?: (p: BackfillProgress) => void;
  signal?: AbortSignal;
}): Promise<BackfillWorkoutsResult> {
  if (!(await isNative())) {
    return { ok: false, reason: "not-native", inserted: 0, fetched: 0, chunks: 0, daysCovered: 0 };
  }
  const plugin = (await loadPlugin()) as
    | (HealthKitPlugin & Partial<HealthKitWorkoutsPlugin>)
    | null;
  if (!plugin || typeof plugin.queryWorkouts !== "function") {
    return { ok: false, reason: "plugin-missing", inserted: 0, fetched: 0, chunks: 0, daysCovered: 0 };
  }

  const now = Date.now();
  let totalInserted = 0;
  let totalFetched = 0;
  let chunks = 0;
  let emptyStreak = 0;
  let daysBack = 0;

  // Walk backwards through 90-day windows. Stop only when we've seen
  // BACKFILL_EMPTY_CHUNK_STOP consecutive empty windows (i.e. the
  // user's HealthKit history has truly been exhausted, with a wide
  // enough tolerance to skip over realistic off-periods) or when we
  // hit the absolute 5-year safety cap.
  while (daysBack < BACKFILL_MAX_DAYS) {
    if (opts?.signal?.aborted) break;
    const chunkEndMs = now - daysBack * 86_400_000;
    const nextDaysBack = Math.min(daysBack + BACKFILL_CHUNK_DAYS, BACKFILL_MAX_DAYS);
    const chunkStartMs = now - nextDaysBack * 86_400_000;
    const chunkStartIso = new Date(chunkStartMs).toISOString();
    const chunkEndIso = new Date(chunkEndMs).toISOString();

    let raw: PluginWorkout[] = [];
    try {
      const res = await plugin.queryWorkouts({
        startDate: chunkStartIso,
        endDate: chunkEndIso,
        limit: 1000,
        ascending: true,
      });
      raw = Array.isArray(res?.workouts) ? res.workouts : [];
    } catch (e) {
      return {
        ok: false,
        reason: "no-permission",
        error: e instanceof Error ? e.message : "unknown",
        inserted: totalInserted,
        fetched: totalFetched,
        chunks,
        daysCovered: daysBack,
      };
    }

    const payload = raw
      .map((w) => {
        const uuid = w.platformId;
        if (!uuid) return null;
        if (!w.workoutType || !w.startDate || !w.endDate) return null;
        const meta = w.metadata || {};
        const avgHr = readNum(meta.averageHeartRate ?? meta.avgHeartRate);
        const maxHr = readNum(meta.maxHeartRate);
        return {
          uuid,
          workoutType: w.workoutType,
          startDate: w.startDate,
          endDate: w.endDate,
          ...(avgHr != null ? { avgHeartRate: avgHr } : {}),
          ...(maxHr != null ? { maxHeartRate: maxHr } : {}),
        };
      })
      .filter((x): x is {
        uuid: string;
        workoutType: string;
        startDate: string;
        endDate: string;
        avgHeartRate?: number;
        maxHeartRate?: number;
      } => x !== null);

    let insertedThisChunk = 0;
    const fetchedThisChunk = payload.length;
    // The ingest route caps each POST at HEALTH_WORKOUTS_MAX_BATCH (200)
    // and rejects oversized batches with 413. Split into sub-batches
    // so power users with hundreds of workouts in a single 90-day
    // window don't dead-end the entire backfill.
    for (let i = 0; i < payload.length; i += BACKFILL_POST_BATCH) {
      if (opts?.signal?.aborted) break;
      const slice = payload.slice(i, i + BACKFILL_POST_BATCH);
      try {
        const res = await fetchWithTimeout("/api/health/workouts/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workouts: slice }),
        });
        if (!res.ok) {
          return {
            ok: false,
            reason: "fetch-failed",
            error: `http ${res.status}`,
            inserted: totalInserted + insertedThisChunk,
            fetched: totalFetched + fetchedThisChunk,
            chunks,
            daysCovered: daysBack,
          };
        }
        const j = (await res.json().catch(() => ({}))) as { inserted?: number };
        insertedThisChunk += j.inserted ?? 0;
      } catch (e) {
        return {
          ok: false,
          reason: "fetch-failed",
          error: e instanceof Error ? e.message : "unknown",
          inserted: totalInserted + insertedThisChunk,
          fetched: totalFetched + fetchedThisChunk,
          chunks,
          daysCovered: daysBack,
        };
      }
    }

    totalInserted += insertedThisChunk;
    totalFetched += fetchedThisChunk;
    chunks++;
    daysBack = nextDaysBack;

    opts?.onProgress?.({
      chunkStartIso,
      chunkEndIso,
      daysBack,
      insertedThisChunk,
      fetchedThisChunk,
      totalInserted,
      totalFetched,
    });

    if (fetchedThisChunk === 0) {
      emptyStreak++;
      if (emptyStreak >= BACKFILL_EMPTY_CHUNK_STOP) break;
    } else {
      emptyStreak = 0;
    }

    if (daysBack >= BACKFILL_MAX_DAYS) break;
  }

  safeWrite(BACKFILL_DONE_KEY, new Date(now).toISOString());
  return {
    ok: true,
    inserted: totalInserted,
    fetched: totalFetched,
    chunks,
    daysCovered: daysBack,
  };
}

export function readBackfillDoneAt(): string | null {
  return safeRead(BACKFILL_DONE_KEY);
}

/**
 * One-shot deeper backfill for Apple Health daily step counts.
 *
 * Mirrors `backfillWorkouts()` but for `stepCount` samples. The
 * regular `syncRecentSteps()` only reaches 30 days back on the first
 * sync; users with years of iPhone step data benefit from a deeper
 * baseline so the engine's "daily activity" context signal has more
 * pattern recognition fuel.
 *
 * Strategy:
 *   - Walk backwards in `STEPS_BACKFILL_CHUNK_DAYS` (30-day) windows.
 *     Smaller than the workouts chunk because step samples are far
 *     more numerous (iPhone writes ~hourly, Watch on top of that).
 *   - For each window read samples from HealthKit, bucket per
 *     device-local calendar day, and POST the per-day totals to
 *     /api/health/steps/sync, which upserts by
 *     (user_id, date, source='apple_health') — re-runs are safe.
 *   - Stop when we hit `STEPS_BACKFILL_MAX_DAYS` (5-year hard cap),
 *     `STEPS_BACKFILL_EMPTY_CHUNK_STOP` consecutive empty windows
 *     (history exhausted), or the optional `signal` is aborted.
 */
const STEPS_BACKFILL_CHUNK_DAYS = 30;
const STEPS_BACKFILL_MAX_DAYS = 365 * 5; // 5 years — hard safety cap
// Stop after this many consecutive empty 30-day windows (~6 months
// of zero steps). Tight enough to wrap up quickly for fresh-install
// users with limited history, loose enough to skip over realistic
// off-periods (long hospitalisation, lost phone).
const STEPS_BACKFILL_EMPTY_CHUNK_STOP = 6;
// HEALTH_STEPS_MAX_BATCH in lib/healthStepsNormalise.ts is 400 — a
// 30-day window POSTs at most 30 daily rows, well within budget.
// Kept as a local literal so this client stays free of server-only imports.
const STEPS_BACKFILL_POST_BATCH = 400;
// HealthKit sample read cap per chunk query — generous enough to
// cover one 30-day window with multiple source apps (iPhone + Watch
// + third-party) writing hourly.
const STEPS_BACKFILL_READ_LIMIT = 10_000;
const STEPS_BACKFILL_DONE_KEY = "glev:apple-health:steps-backfill-done-iso";

export interface BackfillStepsProgress {
  chunkStartIso: string;
  chunkEndIso: string;
  daysBack: number;
  daysThisChunk: number;
  totalDays: number;
  totalUpserted: number;
}

export interface BackfillStepsResult {
  ok: boolean;
  reason?:
    | "not-native"
    | "no-permission"
    | "plugin-missing"
    | "fetch-failed";
  upserted: number;
  days: number;
  chunks: number;
  daysCovered: number;
  error?: string;
}

export async function backfillSteps(opts?: {
  onProgress?: (p: BackfillStepsProgress) => void;
  signal?: AbortSignal;
}): Promise<BackfillStepsResult> {
  if (!(await isNative())) {
    return { ok: false, reason: "not-native", upserted: 0, days: 0, chunks: 0, daysCovered: 0 };
  }
  const plugin = await loadPlugin();
  if (!plugin) {
    return { ok: false, reason: "plugin-missing", upserted: 0, days: 0, chunks: 0, daysCovered: 0 };
  }

  const now = Date.now();
  let totalUpserted = 0;
  let totalDays = 0;
  let chunks = 0;
  let emptyStreak = 0;
  let daysBack = 0;

  while (daysBack < STEPS_BACKFILL_MAX_DAYS) {
    if (opts?.signal?.aborted) break;
    const chunkEndMs = now - daysBack * 86_400_000;
    const nextDaysBack = Math.min(
      daysBack + STEPS_BACKFILL_CHUNK_DAYS,
      STEPS_BACKFILL_MAX_DAYS,
    );
    const chunkStartMs = now - nextDaysBack * 86_400_000;
    const chunkStartIso = new Date(chunkStartMs).toISOString();
    const chunkEndIso = new Date(chunkEndMs).toISOString();

    let samples: PluginSample[] = [];
    try {
      const res = await plugin.readSamples({
        dataType: "stepCount",
        startDate: chunkStartIso,
        endDate: chunkEndIso,
        limit: STEPS_BACKFILL_READ_LIMIT,
        ascending: true,
      });
      samples = Array.isArray(res?.samples) ? res.samples : [];
    } catch (e) {
      return {
        ok: false,
        reason: "no-permission",
        error: e instanceof Error ? e.message : "unknown",
        upserted: totalUpserted,
        days: totalDays,
        chunks,
        daysCovered: daysBack,
      };
    }

    // Bucket per device-local calendar day (same rule as syncRecentSteps).
    const byDate = new Map<string, number>();
    for (const s of samples) {
      if (typeof s.value !== "number" || !Number.isFinite(s.value)) continue;
      const t = s.startDate ? new Date(s.startDate) : null;
      if (!t || Number.isNaN(t.getTime())) continue;
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      byDate.set(key, (byDate.get(key) ?? 0) + s.value);
    }

    const payload = [...byDate.entries()].map(([date, steps]) => ({
      date,
      steps: Math.round(steps),
    }));
    const daysThisChunk = payload.length;

    let upsertedThisChunk = 0;
    for (let i = 0; i < payload.length; i += STEPS_BACKFILL_POST_BATCH) {
      if (opts?.signal?.aborted) break;
      const slice = payload.slice(i, i + STEPS_BACKFILL_POST_BATCH);
      try {
        const res = await fetchWithTimeout("/api/health/steps/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ samples: slice }),
        });
        if (!res.ok) {
          return {
            ok: false,
            reason: "fetch-failed",
            error: `http ${res.status}`,
            upserted: totalUpserted + upsertedThisChunk,
            days: totalDays + daysThisChunk,
            chunks,
            daysCovered: daysBack,
          };
        }
        const j = (await res.json().catch(() => ({}))) as { upserted?: number };
        upsertedThisChunk += j.upserted ?? 0;
      } catch (e) {
        return {
          ok: false,
          reason: "fetch-failed",
          error: e instanceof Error ? e.message : "unknown",
          upserted: totalUpserted + upsertedThisChunk,
          days: totalDays + daysThisChunk,
          chunks,
          daysCovered: daysBack,
        };
      }
    }

    totalUpserted += upsertedThisChunk;
    totalDays += daysThisChunk;
    chunks++;
    daysBack = nextDaysBack;

    opts?.onProgress?.({
      chunkStartIso,
      chunkEndIso,
      daysBack,
      daysThisChunk,
      totalDays,
      totalUpserted,
    });

    if (daysThisChunk === 0) {
      emptyStreak++;
      if (emptyStreak >= STEPS_BACKFILL_EMPTY_CHUNK_STOP) break;
    } else {
      emptyStreak = 0;
    }

    if (daysBack >= STEPS_BACKFILL_MAX_DAYS) break;
  }

  safeWrite(STEPS_BACKFILL_DONE_KEY, new Date(now).toISOString());
  return {
    ok: true,
    upserted: totalUpserted,
    days: totalDays,
    chunks,
    daysCovered: daysBack,
  };
}

export function readStepsBackfillDoneAt(): string | null {
  return safeRead(STEPS_BACKFILL_DONE_KEY);
}

function readNum(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function safeRead(key: string): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, val: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, val);
    }
  } catch {
    /* quota / disabled — next sync just re-pulls the wider window */
  }
}

/**
 * Read recent blood-glucose samples from HealthKit and POST them to the
 * backend. Idempotent — re-running it within the sync window is safe.
 * Returns a structured result so the caller can render a small "synced
 * N readings" status line.
 */
export async function syncRecent(): Promise<SyncResult> {
  if (!(await isNative())) return { ok: false, reason: "not-native" };

  const plugin = await loadPlugin();
  if (!plugin) return { ok: false, reason: "plugin-missing" };

  const now = Date.now();
  const lastSyncIso = readLastSync();
  // Pick the window: if we've never synced in this install, or the last
  // sync was > FIRST_SYNC_HOURS ago, do a full first-sync pull;
  // otherwise just fetch the incremental window. Using the larger of
  // the two windows keeps the math safe even if the user's clock jumped.
  const windowHours = (() => {
    if (!lastSyncIso) return FIRST_SYNC_HOURS;
    const lastMs = Date.parse(lastSyncIso);
    if (!Number.isFinite(lastMs)) return FIRST_SYNC_HOURS;
    const sinceHours = (now - lastMs) / 3_600_000;
    if (sinceHours >= FIRST_SYNC_HOURS) return FIRST_SYNC_HOURS;
    if (sinceHours <= 0) return INCREMENTAL_SYNC_HOURS;
    // Add a small overlap (15 min) to the incremental window to absorb
    // sensor write latency — HealthKit can backdate a sample's
    // startDate by minutes vs. when it actually appears in the store.
    return Math.max(INCREMENTAL_SYNC_HOURS, sinceHours + 0.25);
  })();

  const startDate = new Date(now - windowHours * 3_600_000).toISOString();
  const endDate = new Date(now).toISOString();

  let samples: PluginSample[] = [];
  try {
    const res = await plugin.readSamples({
      dataType: "bloodGlucose",
      startDate,
      endDate,
      limit: 500,
      ascending: true,
    });
    samples = Array.isArray(res?.samples) ? res.samples : [];
  } catch (e) {
    return {
      ok: false,
      reason: "no-permission",
      error: e instanceof Error ? e.message : "unknown",
    };
  }

  if (samples.length === 0) {
    // Still record the last-sync time so the next interval doesn't
    // re-pull the same empty window.
    writeLastSync(new Date(now).toISOString());
    return { ok: true, reason: "no-samples", fetched: 0 };
  }

  // Build the request body. Drop samples that are missing the bits we
  // need for the upsert key — defensive, the plugin should always
  // provide them but iOS plugin shims sometimes elide platformId.
  //
  // UUID strategy: prefer HealthKit's per-sample platformId (HKObject.uuid).
  // If the shim ever omits it we synthesize a deterministic key from
  // (sourceId|"unknown") + startDate + value — sample-scoped, not
  // app-scoped, so two real samples never collapse into one dedupe key.
  // Using sourceId on its own would be wrong (it's app/source-level
  // and would map every sample from e.g. the Libre app to one row).
  const payload = samples
    .map((s) => {
      const startIso = s.startDate;
      if (!startIso) return null;
      if (typeof s.value !== "number" || !Number.isFinite(s.value)) return null;
      const unit = s.unit;
      if (unit !== "mg/dL" && unit !== "mmol/L") return null;
      const uuid =
        s.platformId ??
        `synthetic:${s.sourceId ?? "unknown"}:${startIso}:${s.value}`;
      return { uuid, startDate: startIso, value: s.value, unit };
    })
    .filter((x): x is { uuid: string; startDate: string; value: number; unit: "mg/dL" | "mmol/L" } => x !== null);

  if (payload.length === 0) {
    writeLastSync(new Date(now).toISOString());
    return { ok: true, reason: "no-samples", fetched: 0 };
  }

  try {
    const res = await fetchWithTimeout("/api/cgm/apple-health/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ samples: payload }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: "fetch-failed",
        error: `http ${res.status}`,
        fetched: payload.length,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      inserted?: number;
      skipped?: number;
    };
    writeLastSync(new Date(now).toISOString());
    return {
      ok: true,
      inserted: json.inserted ?? 0,
      skipped: json.skipped ?? 0,
      fetched: payload.length,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "fetch-failed",
      error: e instanceof Error ? e.message : "unknown",
      fetched: payload.length,
    };
  }
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

interface PluginSample {
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  platformId?: string;
  sourceId?: string;
}

interface HealthKitPlugin {
  requestAuthorization(opts: { read: string[]; write?: string[] }): Promise<unknown>;
  readSamples(opts: {
    dataType: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }): Promise<{ samples: PluginSample[] }>;
}

async function loadPlugin(): Promise<HealthKitPlugin | null> {
  try {
    // Dynamic import is mandatory — a static import would force the
    // plugin's native-bridge bindings into the Vercel web bundle and
    // crash on first load in any non-Capacitor browser.
    const mod = (await import("@capgo/capacitor-health")) as unknown as {
      Health?: HealthKitPlugin;
    };
    return mod.Health ?? null;
  } catch {
    return null;
  }
}

function readLastSync(): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(LAST_SYNC_KEY)
      : null;
  } catch {
    return null;
  }
}

function writeLastSync(iso: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SYNC_KEY, iso);
    }
  } catch {
    // Quota / disabled storage — silent. Worst case the next sync
    // pulls the wider 24h window again.
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
