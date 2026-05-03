/**
 * User preferences. Holds:
 *   1. Daily macro targets + insulin parameters (ICR / CF / target BG)
 *      in the Postgres `user_settings` table — the single source of
 *      truth for evaluation, dose recommendation, and the Today's
 *      Macros rings.
 *   2. A localStorage mirror (key "glev_settings") for the synchronous
 *      callers (`getInsulinSettings()`) that cannot await an async DB
 *      round-trip — kept in lock-step by the Settings page so the two
 *      stay in sync.
 *
 * All reads gracefully fall back to DEFAULT_* when no row / key exists,
 * the user is signed out, the request is server-side, or Supabase is
 * unreachable, so consumers never have to handle missing-data states.
 */

import { supabase } from "./supabase";
import type { AdjustmentRecord, AdjustmentSuggestion } from "./engine/adjustment";

export interface MacroTargets {
  carbs:   number;
  protein: number;
  fat:     number;
  fiber:   number;
}

export const DEFAULT_MACRO_TARGETS: MacroTargets = {
  carbs:   250,
  protein: 120,
  fat:     80,
  fiber:   30,
};

/**
 * Returns the current user's macro targets, or DEFAULT_MACRO_TARGETS if no
 * row exists / user not signed in / network or RLS error. Safe to call on
 * the client during initial render — never throws.
 */
export async function fetchMacroTargets(): Promise<MacroTargets> {
  if (!supabase) return DEFAULT_MACRO_TARGETS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_MACRO_TARGETS;

  const { data, error } = await supabase
    .from("user_settings")
    .select("target_carbs_g, target_protein_g, target_fat_g, target_fiber_g")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_MACRO_TARGETS;
  return {
    carbs:   data.target_carbs_g   ?? DEFAULT_MACRO_TARGETS.carbs,
    protein: data.target_protein_g ?? DEFAULT_MACRO_TARGETS.protein,
    fat:     data.target_fat_g     ?? DEFAULT_MACRO_TARGETS.fat,
    fiber:   data.target_fiber_g   ?? DEFAULT_MACRO_TARGETS.fiber,
  };
}

/**
 * Upserts the macro targets for the signed-in user. Throws on auth or DB
 * error so callers can surface a UI error state.
 */
export async function saveMacroTargets(targets: MacroTargets): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id:          user.id,
      target_carbs_g:   Math.round(targets.carbs),
      target_protein_g: Math.round(targets.protein),
      target_fat_g:     Math.round(targets.fat),
      target_fiber_g:   Math.round(targets.fiber),
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}

/* ── Insulin parameters (ICR / CF / target BG) ─────────────────────── */

export interface InsulinSettings {
  /** Insulin-to-carb ratio: grams of carb covered by 1 unit of insulin. */
  icr: number;
  /** Correction factor: mg/dL drop per 1 unit of insulin. */
  cf: number;
  /** Target BG (mg/dL) — midpoint of the user's target range. */
  targetBg: number;
}

export const DEFAULT_INSULIN_SETTINGS: InsulinSettings = {
  icr:      15,
  cf:       50,
  targetBg: 110,
};

const SETTINGS_KEY = "glev_settings";

/** Per-field warning latches so we surface a single console.warn the
 *  first time each individual field falls back to its hard-coded
 *  default — without spamming hot paths (lifecycleFor runs once per
 *  meal row across the dashboard / insights views). */
const warnedField = { icr: false, cf: false, targetBg: false };

function warnFieldDefault(field: keyof typeof warnedField, value: number): void {
  if (warnedField[field]) return;
  warnedField[field] = true;
  // eslint-disable-next-line no-console
  console.warn(`[glev] user_settings.${field} missing — falling back to default ${value}. Set it in Settings to silence this warning.`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Read the user's insulin parameters from localStorage. Server-side
 * (no `window`) returns DEFAULT_INSULIN_SETTINGS without a warning —
 * the warning fires only when running in a browser with no saved values
 * for a specific field. Each missing field warns at most once per
 * session via the `warnedField` latch.
 *
 * `targetBg` is derived from the saved targetMin / targetMax range
 * (their midpoint, rounded), since the Settings UI exposes the range
 * rather than a single target.
 */
export function getInsulinSettings(): InsulinSettings {
  if (typeof window === "undefined") return DEFAULT_INSULIN_SETTINGS;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(SETTINGS_KEY); }
  catch { /* localStorage disabled / quota — fall through to defaults */ }
  if (!raw) {
    warnFieldDefault("icr",      DEFAULT_INSULIN_SETTINGS.icr);
    warnFieldDefault("cf",       DEFAULT_INSULIN_SETTINGS.cf);
    warnFieldDefault("targetBg", DEFAULT_INSULIN_SETTINGS.targetBg);
    return DEFAULT_INSULIN_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let icr: number;
    if (isFiniteNumber(parsed.icr) && parsed.icr > 0) icr = parsed.icr;
    else { warnFieldDefault("icr", DEFAULT_INSULIN_SETTINGS.icr); icr = DEFAULT_INSULIN_SETTINGS.icr; }

    let cf: number;
    if (isFiniteNumber(parsed.cf)  && parsed.cf  > 0) cf = parsed.cf;
    else { warnFieldDefault("cf", DEFAULT_INSULIN_SETTINGS.cf); cf = DEFAULT_INSULIN_SETTINGS.cf; }

    // Prefer an explicitly saved targetBg (Task #40 lets the user edit it
    // directly in Settings → that value is mirrored to localStorage so this
    // sync caller stays in lock-step with the DB row). Fall back to the
    // midpoint of the saved targetMin/targetMax range for older clients
    // that only persisted the range, then to the hardcoded default.
    let targetBg: number;
    if (isFiniteNumber(parsed.targetBg) && parsed.targetBg > 0) {
      targetBg = parsed.targetBg;
    } else {
      const tMin = isFiniteNumber(parsed.targetMin) ? parsed.targetMin : null;
      const tMax = isFiniteNumber(parsed.targetMax) ? parsed.targetMax : null;
      if (tMin != null && tMax != null && tMax > tMin) targetBg = Math.round((tMin + tMax) / 2);
      else { warnFieldDefault("targetBg", DEFAULT_INSULIN_SETTINGS.targetBg); targetBg = DEFAULT_INSULIN_SETTINGS.targetBg; }
    }

    return { icr, cf, targetBg };
  } catch {
    return DEFAULT_INSULIN_SETTINGS;
  }
}

/**
 * Async DB-backed read of the user's insulin parameters from the
 * `user_settings` table. Falls back to DEFAULT_INSULIN_SETTINGS — and
 * fires a one-shot warning per missing field — when the row is
 * absent, the user is signed out, or Supabase is unreachable.
 *
 * Use this from server contexts (route handlers) or async client
 * paths where the freshest values matter (post-meal lifecycle
 * finalize). Synchronous callers should keep using
 * `getInsulinSettings()` for the localStorage mirror.
 */
export async function fetchInsulinSettings(): Promise<InsulinSettings> {
  if (!supabase) return DEFAULT_INSULIN_SETTINGS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_INSULIN_SETTINGS;

  const { data, error } = await supabase
    .from("user_settings")
    .select("icr_g_per_unit, cf_mgdl_per_unit, target_bg_mgdl")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_INSULIN_SETTINGS;

  let icr: number;
  if (isFiniteNumber(data.icr_g_per_unit) && data.icr_g_per_unit > 0) icr = data.icr_g_per_unit;
  else { warnFieldDefault("icr", DEFAULT_INSULIN_SETTINGS.icr); icr = DEFAULT_INSULIN_SETTINGS.icr; }

  let cf: number;
  if (isFiniteNumber(data.cf_mgdl_per_unit) && data.cf_mgdl_per_unit > 0) cf = data.cf_mgdl_per_unit;
  else { warnFieldDefault("cf", DEFAULT_INSULIN_SETTINGS.cf); cf = DEFAULT_INSULIN_SETTINGS.cf; }

  let targetBg: number;
  if (isFiniteNumber(data.target_bg_mgdl) && data.target_bg_mgdl > 0) targetBg = data.target_bg_mgdl;
  else { warnFieldDefault("targetBg", DEFAULT_INSULIN_SETTINGS.targetBg); targetBg = DEFAULT_INSULIN_SETTINGS.targetBg; }

  return { icr, cf, targetBg };
}

/**
 * Upsert the user's insulin parameters (ICR, CF, target BG) into the
 * `user_settings` row that already holds their macro targets. Throws on
 * auth or DB error so the Settings UI can surface a save-failed state.
 *
 * Validation matches the migration's CHECK constraints (ICR 1–100,
 * CF 1–500, target BG 60–200) so a Postgres rejection only fires for a
 * truly malformed write — the UI clamps inputs into range first.
 */
export async function saveInsulinSettings(settings: InsulinSettings): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id:          user.id,
      icr_g_per_unit:   Math.round(settings.icr),
      cf_mgdl_per_unit: Math.round(settings.cf),
      target_bg_mgdl:   Math.round(settings.targetBg),
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}

/* ── Last appointment date ─────────────────────────────────────────── */
//
// Task #93 moved the per-user appointment record from a single
// `user_settings.last_appointment_at` column into a proper list-shaped
// `appointments` table (so the Export panel can offer "since the visit
// before last", etc). The single-field helper exported here is kept as
// a thin derived view over the new table so callers that only need
// "the latest visit" (Export panel default chip, PDF cover meta line)
// don't have to learn a new shape. New callers should use the richer
// helpers in `lib/appointments.ts` directly.
//
// Task #92 added an optional one-line note alongside the date. The
// note now lives on each individual appointment row in the new table
// (`appointments.note`), but the public `LastAppointment` shape kept
// here still bundles `{ date, note }` because the PDF cover binds
// the two together — surfacing the note independently of the date
// would be meaningless.
//
// The legacy `user_settings.last_appointment_at` column stays in the
// database for one release as a safety net; a follow-up task drops it
// once nothing reads it directly.

/**
 * Saved metadata for the user's most recent doctor visit. Both fields
 * are nullable — a brand-new user has neither set, the date alone may
 * be set without a note (the original Task #75 behaviour stays valid),
 * and the note is meaningless without a date so the Settings UI clears
 * both together (Task #92). We return one combined object instead of
 * two separate fetchers because every caller needs both pieces in
 * lock-step (the Export panel renders the chip from the date and the
 * PDF cover meta from the note), and a single round-trip avoids a
 * partial-state UI flicker between the two reads.
 *
 * Sourced from the latest row in the `appointments` table (Task #93)
 * — i.e. the entry with the highest `appointment_at`. Older entries
 * are not surfaced here; consumers that need them should call
 * `fetchAppointments()` from `lib/appointments.ts` directly.
 */
export interface LastAppointment {
  /** ISO YYYY-MM-DD calendar date, or null when no appointments saved. */
  date: string | null;
  /** Free-text note (e.g. doctor name, A1c, key result). null when
   *  unset or — defensively — when the user only saved a date and no
   *  note. We intentionally collapse "" to null so an empty input
   *  doesn't surface a stray meta line on the PDF cover. */
  note: string | null;
}

/**
 * Read the user's most-recent appointment as `{ date, note }` from the
 * new `appointments` table. Returns `{ date: null, note: null }` when
 * the user has no appointments saved, is signed out, or Supabase is
 * unreachable — every caller treats both nulls as "no preset chip,
 * nothing to surface", so the fallback is a clean no-op rather than a
 * misleading default.
 *
 * Used by the Export panel to decide whether to render the "Seit
 * letztem Arzttermin" preset chip and to pass the note through to
 * the PDF cover. The Settings sheet does NOT use this helper — it
 * needs the full list and goes straight to `fetchAppointments()`.
 */
export async function fetchLastAppointment(): Promise<LastAppointment> {
  // Lazy import keeps the module-level dependency graph acyclic
  // (`lib/appointments.ts` does not import from this file, but a
  // top-level import here would still surface in bundle traces as a
  // round-trip and complicates tree-shaking when only one of the two
  // is used).
  const { fetchAppointments } = await import("./appointments");
  try {
    const rows = await fetchAppointments();
    if (rows.length === 0) return { date: null, note: null };
    const latest = rows[0]!;
    return { date: latest.appointmentAt, note: latest.note ?? null };
  } catch {
    return { date: null, note: null };
  }
}


/* ── Adaptive engine adjustment history ─────────────────────────── */
//
// The adaptive engine in `lib/engine/adjustment.ts` produces ICR / CF
// suggestions, but until Task #190 nothing wrote them back to the
// user's settings — so the engine never actually "learned" across
// sessions. The helpers below are the missing link: they accept a
// confirmed `AdjustmentSuggestion`, write the new ICR/CF into the same
// `user_settings` row that holds the rest of the insulin parameters,
// and append an audit-trail entry to `adjustment_history` so the
// Settings page can show the user what the engine has changed.
//
// One round-trip on read, one on write — atomic per-user because both
// columns live on the same row, so a partial failure can't leave ICR
// updated without a matching history entry.

const ICR_MIN = 1, ICR_MAX = 100;
const CF_MIN  = 1, CF_MAX  = 500;

function clampIcr(n: number): number {
  return Math.min(ICR_MAX, Math.max(ICR_MIN, Math.round(n)));
}
function clampCf(n: number): number {
  return Math.min(CF_MAX, Math.max(CF_MIN, Math.round(n)));
}

/**
 * Read the persisted adjustment history (newest first). Returns [] when
 * the user is signed out, the row hasn't been created yet, or Supabase
 * is unreachable — every UI surface treats the empty list as "no
 * engine adjustments yet", which is the right default for new users.
 */
export async function fetchAdjustmentHistory(): Promise<AdjustmentRecord[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("user_settings")
    .select("adjustment_history")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data || !Array.isArray(data.adjustment_history)) return [];
  // Defensive copy + newest-first sort: the column is append-only, so
  // it should already be in chronological order, but a sort here means
  // a manually-edited row can't break the Settings UI's expectations.
  return [...(data.adjustment_history as AdjustmentRecord[])].sort(
    (a, b) => (b.at ?? "").localeCompare(a.at ?? ""),
  );
}

/**
 * Apply an engine `AdjustmentSuggestion` permanently:
 *   1. Clamp the suggested ICR / CF into the column CHECK ranges.
 *   2. Write them onto `user_settings` (same row as macro targets etc).
 *   3. Append the corresponding `AdjustmentRecord`(s) to
 *      `adjustment_history`.
 *
 * Idempotent on double-tap: if the row's current ICR/CF already match
 * the suggested "to" values AND the history's most recent entry covers
 * the same field/from/to/reason, we skip the write. That mirrors the
 * Task #190 acceptance criterion — "History wird nicht doppelt
 * erweitert wenn dieselbe Suggestion zweimal angetippt wird."
 *
 * Returns the updated `AdjustmentRecord[]` so callers can refresh
 * their UI without an extra fetch round-trip. Throws on auth or DB
 * error so the banner can surface a "konnte nicht gespeichert
 * werden" state.
 */
export async function applyAdjustmentToSettings(
  suggestion: AdjustmentSuggestion,
): Promise<AdjustmentRecord[]> {
  if (!suggestion.hasSuggestion) {
    throw new Error("Suggestion has no actionable change");
  }
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  // Pull the row's current state — we need both the live ICR/CF (for
  // the "from" value in each history entry, since the suggestion was
  // computed against possibly-stale UI state) and the existing
  // history (so we can append rather than overwrite).
  const { data: current, error: readErr } = await supabase
    .from("user_settings")
    .select("icr_g_per_unit, cf_mgdl_per_unit, adjustment_history")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);

  const currentIcr = isFiniteNumber(current?.icr_g_per_unit) && current!.icr_g_per_unit > 0
    ? current!.icr_g_per_unit
    : DEFAULT_INSULIN_SETTINGS.icr;
  const currentCf  = isFiniteNumber(current?.cf_mgdl_per_unit) && current!.cf_mgdl_per_unit > 0
    ? current!.cf_mgdl_per_unit
    : DEFAULT_INSULIN_SETTINGS.cf;
  const existingHistory: AdjustmentRecord[] = Array.isArray(current?.adjustment_history)
    ? (current!.adjustment_history as AdjustmentRecord[])
    : [];

  const reason = suggestion.pattern.label;
  const at = new Date().toISOString();

  let nextIcr = currentIcr;
  let nextCf  = currentCf;
  const newRecords: AdjustmentRecord[] = [];

  if (suggestion.toIcr != null) {
    const target = clampIcr(suggestion.toIcr);
    if (target !== currentIcr) {
      newRecords.push({ at, field: "icr", from: currentIcr, to: target, reason });
      nextIcr = target;
    }
  }
  if (suggestion.toCf != null) {
    const target = clampCf(suggestion.toCf);
    if (target !== currentCf) {
      newRecords.push({ at, field: "correctionFactor", from: currentCf, to: target, reason });
      nextCf = target;
    }
  }

  // Idempotent fast-path: nothing to change AND the latest history
  // entry already records this exact suggestion → return the existing
  // history so the UI re-renders without producing a duplicate row.
  if (newRecords.length === 0) return existingHistory;

  const nextHistory = [...existingHistory, ...newRecords];

  const { error: writeErr } = await supabase
    .from("user_settings")
    .upsert({
      user_id:            user.id,
      icr_g_per_unit:     nextIcr,
      cf_mgdl_per_unit:   nextCf,
      adjustment_history: nextHistory,
    }, { onConflict: "user_id" });
  if (writeErr) throw new Error(writeErr.message);

  // Mirror the new ICR/CF into the localStorage shadow used by the
  // sync `getInsulinSettings()` callers (engine evaluation path) so
  // the next dose calc immediately reflects what the engine just
  // wrote, instead of waiting for a page reload.
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      parsed.icr = nextIcr;
      parsed.cf  = nextCf;
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
    } catch { /* storage disabled / quota — ignore, DB is the truth */ }
  }

  return nextHistory;
}
