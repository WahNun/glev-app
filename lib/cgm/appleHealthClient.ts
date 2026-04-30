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
    await plugin.requestAuthorization({ read: ["bloodGlucose"] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
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
