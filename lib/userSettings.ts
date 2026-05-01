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

    const tMin = isFiniteNumber(parsed.targetMin) ? parsed.targetMin : null;
    const tMax = isFiniteNumber(parsed.targetMax) ? parsed.targetMax : null;
    let targetBg: number;
    if (tMin != null && tMax != null && tMax > tMin) targetBg = Math.round((tMin + tMax) / 2);
    else { warnFieldDefault("targetBg", DEFAULT_INSULIN_SETTINGS.targetBg); targetBg = DEFAULT_INSULIN_SETTINGS.targetBg; }

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

/* ── Last appointment date ─────────────────────────────────────────── */

/** YYYY-MM-DD calendar date matching what `<input type="date">` emits and
 *  what Postgres stores in a `date` column. We deliberately keep this as
 *  a plain string (not Date) because the value has no time-of-day or
 *  timezone meaning — it's a calendar date the user selected. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE_RE.test(v);
}

/**
 * Read the user's saved "last appointment" date (a YYYY-MM-DD calendar
 * date) from the `user_settings` table. Returns `null` when no row /
 * column value exists, the user is signed out, or Supabase is
 * unreachable — every caller treats `null` as "no preset chip,
 * nothing to surface", so the fallback is a clean no-op rather than a
 * misleading default.
 *
 * Used by both the Settings sheet (to show the current value in the
 * date input) and the Export panel (to decide whether to render the
 * "Seit letztem Arzttermin" preset chip).
 */
export async function fetchLastAppointment(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_settings")
    .select("last_appointment_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return null;
  // Postgres returns `date` columns as ISO `YYYY-MM-DD` strings via
  // PostgREST. Defensive isValidIsoDate guards against an unexpected
  // server-side coercion (e.g. timestamptz cast) that would otherwise
  // produce an unparseable value downstream.
  return isValidIsoDate(data.last_appointment_at) ? data.last_appointment_at : null;
}

/**
 * Upsert the user's "last appointment" date. Pass `null` to clear the
 * value (which hides the preset chip from the Export panel). Throws
 * on auth or DB error so the Settings sheet can show an inline error
 * and keep the user's input visible. The input MUST be a YYYY-MM-DD
 * string (the format `<input type="date">` emits) — anything else
 * throws synchronously instead of silently writing garbage.
 */
export async function saveLastAppointment(value: string | null): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  if (value !== null && !isValidIsoDate(value)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${value}`);
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id: user.id,
      last_appointment_at: value,
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}
