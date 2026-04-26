/**
 * User preferences. Holds:
 *   1. Daily macro targets (Postgres `user_settings` table) — used by
 *      the dashboard "Today's Macros" rings.
 *   2. Insulin parameters (browser `localStorage` key "glev_settings") —
 *      ICR, CF and the target-BG midpoint used by the deterministic
 *      evaluator and the dose recommender. Mirror of the Settings page
 *      UI; both reads and writes use the same key so the values stay
 *      in lock-step.
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

/** Track whether we already warned about defaults this session, to keep
 *  the console quiet on hot paths (lifecycleFor runs once per row). */
let warnedDefaultsThisSession = false;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Read the user's insulin parameters from localStorage. Server-side
 * (no `window`) returns DEFAULT_INSULIN_SETTINGS without a warning —
 * the warning fires only when running in a browser with no saved values.
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
    if (!warnedDefaultsThisSession) {
      // eslint-disable-next-line no-console
      console.warn("[glev] No saved insulin settings found — using defaults (ICR=15, CF=50, Target=110). Configure in Settings.");
      warnedDefaultsThisSession = true;
    }
    return DEFAULT_INSULIN_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const icr = isFiniteNumber(parsed.icr) && parsed.icr > 0 ? parsed.icr : DEFAULT_INSULIN_SETTINGS.icr;
    const cf  = isFiniteNumber(parsed.cf)  && parsed.cf  > 0 ? parsed.cf  : DEFAULT_INSULIN_SETTINGS.cf;
    const tMin = isFiniteNumber(parsed.targetMin) ? parsed.targetMin : null;
    const tMax = isFiniteNumber(parsed.targetMax) ? parsed.targetMax : null;
    const targetBg = tMin != null && tMax != null && tMax > tMin
      ? Math.round((tMin + tMax) / 2)
      : DEFAULT_INSULIN_SETTINGS.targetBg;
    return { icr, cf, targetBg };
  } catch {
    return DEFAULT_INSULIN_SETTINGS;
  }
}
