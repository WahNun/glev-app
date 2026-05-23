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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdjustmentRecord, AdjustmentSuggestion } from "./engine/adjustment";

// Read the Supabase client from globalThis._supabase at call time rather
// than from the frozen module-level `supabase` const.  This matters in the
// Playwright unit-test runner (workers: 1, shared Node.js module cache):
// when an earlier test file has already loaded lib/supabase.ts, the cached
// `supabase` export holds the real client even after _fake-supabase.ts sets
// globalThis._supabase = fakeClient.  Reading from the global at call time
// lets the fake work correctly in both isolated and full-suite runs without
// any changes to the test fixtures or to lib/supabase.ts itself.
const _g = globalThis as typeof globalThis & { _supabase?: SupabaseClient | null };
function _liveSupabase(): SupabaseClient | null {
  return _g._supabase ?? supabase;
}

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
  /** Duration of insulin action in minutes. Used by all IOB calculations.
   *  `undefined` when the user has not explicitly set a value — all IOB
   *  call sites then pass this to `getDIAMinutes(insulinType, diaMinutes)`
   *  which falls back to the insulin-type default (rapid 180 / regular 300).
   *  Fiasp/Lyumjev ≈ 120–150 min, NovoRapid/Humalog ≈ 150–180 min,
   *  regular insulin ≈ 300 min. */
  diaMinutes?: number;
  /** User's primary rapid/bolus insulin brand name (e.g. "NovoRapid", "Fiasp").
   *  Displayed in the IOB footer and pre-fills the insulin log form.
   *  `undefined` / empty = not set. Max 40 chars enforced by UI + DB. */
  insulinBrandBolus?: string;
  /** Optional secondary bolus insulin brand (e.g. "Humalog" as backup).
   *  Some ICT users alternate between two rapid-acting insulins.
   *  `undefined` / empty = not set. Max 40 chars enforced by UI + DB. */
  insulinBrandBolus2?: string;
  /** User's basal insulin brand name (e.g. "Tresiba", "Lantus").
   *  Pre-fills the basal tab of the insulin log form.
   *  `undefined` / empty = not set. Max 40 chars enforced by UI + DB. */
  insulinBrandBasal?: string;
}

export const DEFAULT_INSULIN_SETTINGS: InsulinSettings = {
  icr:      15,
  cf:       50,
  targetBg: 110,
  // diaMinutes intentionally omitted — undefined triggers insulin-type
  // fallback in getDIAMinutes() (rapid 180 / regular 300).
};

/**
 * Pure helper: resolves the default value for the insulin name input in the
 * log form. Returns the trimmed brand string for the given insulin type, or
 * an empty string when none is configured.
 *
 * Extracted as a standalone function so it can be unit-tested without a
 * browser environment or localStorage access.
 *
 * @param settings  Result of `getInsulinSettings()` (or any `InsulinSettings`).
 * @param type      Which tab is open: "bolus" (default) or "basal".
 */
export function resolveInsulinNamePrefill(
  settings: InsulinSettings,
  type: "bolus" | "basal" = "bolus",
): string {
  const brand = type === "bolus" ? settings.insulinBrandBolus : settings.insulinBrandBasal;
  return brand?.trim() ?? "";
}

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

    // diaMinutes is optional — undefined means "not set by user, use type
    // fallback in getDIAMinutes()". No warning because absence is expected
    // for users who haven't visited the DIA setting yet.
    const diaMinutes =
      isFiniteNumber(parsed.diaMinutes) &&
      parsed.diaMinutes >= 60 &&
      parsed.diaMinutes <= 360
        ? parsed.diaMinutes
        : undefined;

    // Brand strings — optional, no validation needed beyond "is a string".
    const insulinBrandBolus =
      typeof parsed.insulinBrandBolus === "string" && parsed.insulinBrandBolus.trim()
        ? parsed.insulinBrandBolus.trim().slice(0, 40)
        : undefined;
    const insulinBrandBolus2 =
      typeof parsed.insulinBrandBolus2 === "string" && parsed.insulinBrandBolus2.trim()
        ? parsed.insulinBrandBolus2.trim().slice(0, 40)
        : undefined;
    const insulinBrandBasal =
      typeof parsed.insulinBrandBasal === "string" && parsed.insulinBrandBasal.trim()
        ? parsed.insulinBrandBasal.trim().slice(0, 40)
        : undefined;

    return { icr, cf, targetBg, diaMinutes, insulinBrandBolus, insulinBrandBolus2, insulinBrandBasal };
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
    .select("icr_g_per_unit, cf_mgdl_per_unit, target_bg_mgdl, dia_minutes, insulin_brand_bolus, insulin_brand_bolus_2, insulin_brand_basal")
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

  // diaMinutes optional — NULL in DB means "not set, fall back to type default"
  const diaMinutes =
    isFiniteNumber(data.dia_minutes) &&
    data.dia_minutes >= 60 &&
    data.dia_minutes <= 360
      ? data.dia_minutes
      : undefined;

  // Brand strings — NULL in DB means "not set".
  const insulinBrandBolus =
    typeof data.insulin_brand_bolus === "string" && data.insulin_brand_bolus.trim()
      ? data.insulin_brand_bolus.trim().slice(0, 40)
      : undefined;
  const insulinBrandBolus2 =
    typeof data.insulin_brand_bolus_2 === "string" && data.insulin_brand_bolus_2.trim()
      ? data.insulin_brand_bolus_2.trim().slice(0, 40)
      : undefined;
  const insulinBrandBasal =
    typeof data.insulin_brand_basal === "string" && data.insulin_brand_basal.trim()
      ? data.insulin_brand_basal.trim().slice(0, 40)
      : undefined;

  return { icr, cf, targetBg, diaMinutes, insulinBrandBolus, insulinBrandBolus2, insulinBrandBasal };
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
      // ICR is now NUMERIC(5,1) (Migration 20260515_split_icr_user_engine.sql)
      // — round to one decimal so the column can express e.g. 8.5 without
      // either drifting (8.547) or being silently floored to 8.
      icr_g_per_unit:   Math.round(settings.icr * 10) / 10,
      cf_mgdl_per_unit: Math.round(settings.cf),
      target_bg_mgdl:   Math.round(settings.targetBg),
      // dia_minutes is nullable — omit from the upsert payload when
      // the user has never set it (undefined) so the DB row keeps NULL
      // and getDIAMinutes() continues to fall back to the insulin-type
      // default (rapid 180 / regular 300). When set, clamp to 60–360.
      ...(settings.diaMinutes !== undefined
        ? { dia_minutes: Math.min(360, Math.max(60, Math.round(settings.diaMinutes))) }
        : {}),
      // Brand strings — write NULL when absent so the DB reflects the
      // user's intent (no brand set) rather than keeping a stale value.
      insulin_brand_bolus:   settings.insulinBrandBolus?.trim().slice(0, 40)  || null,
      insulin_brand_bolus_2: settings.insulinBrandBolus2?.trim().slice(0, 40) || null,
      insulin_brand_basal:   settings.insulinBrandBasal?.trim().slice(0, 40)  || null,
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}

/* ── Insulin type (rapid / regular) ──────────────────────────────── */

export async function fetchInsulinType(): Promise<import('./iob').InsulinType> {
  if (!supabase) return 'rapid';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'rapid';
  const { data, error } = await supabase
    .from("user_settings")
    .select("insulin_type")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return 'rapid';
  const t = data.insulin_type;
  if (t === 'rapid' || t === 'regular' || t === 'unknown') return t;
  return 'rapid';
}

export async function saveInsulinType(insulinType: import('./iob').InsulinType): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, insulin_type: insulinType }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

/* ── Personal glucose target range (TIR band) ─────────────────────── */
//
// Lives in `user_settings.target_min_mgdl` / `target_max_mgdl`
// (Migration 20260517). Prior to that migration the range only lived
// in localStorage, which meant every TIR card across the app silently
// used a different band than the user had configured the moment they
// switched browsers / devices. Persisting it makes the DB the
// cross-device source of truth.
//
// As with `getInsulinSettings()` we expose BOTH a sync localStorage
// reader (`getTargetRange()`) for hot-path render callers that cannot
// await a DB round-trip, AND an async DB reader (`fetchTargetRange()`)
// for code paths where the freshest cross-device value matters. The
// Settings page keeps the two in lock-step by mirroring every
// successful save back into `glev_settings.targetMin/targetMax`.

export interface TargetRange {
  /** Lower bound of the TIR target band (mg/dL). */
  low: number;
  /** Upper bound of the TIR target band (mg/dL). */
  high: number;
}

/** Clinical consensus (ATTD/ADA) — used whenever the user hasn't
 *  saved a custom range yet. */
export const DEFAULT_TARGET_RANGE: TargetRange = { low: 70, high: 180 };

/** Same per-field warn-once latch pattern as the insulin helpers. */
const warnedRange = { low: false, high: false };
function warnRangeDefault(field: keyof typeof warnedRange, value: number): void {
  if (warnedRange[field]) return;
  warnedRange[field] = true;
  // eslint-disable-next-line no-console
  console.warn(`[glev] user_settings.target_${field === "low" ? "min" : "max"}_mgdl missing — falling back to default ${value}. Set it in Settings to silence this warning.`);
}

/**
 * Synchronous read of the user's TIR target band from the localStorage
 * mirror (key "glev_settings", fields `targetMin` / `targetMax`).
 * Server-side / no-window returns DEFAULT_TARGET_RANGE without warning.
 * Each missing field warns at most once per session.
 *
 * Used by hot-path render callers (Dashboard Trend Breakdown,
 * CurrentDayGlucoseCard) that cannot await an async DB read on every
 * paint. The Settings page mirrors every successful DB save back into
 * localStorage so this stays in lock-step with the persisted value.
 */
export function getTargetRange(): TargetRange {
  if (typeof window === "undefined") return DEFAULT_TARGET_RANGE;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(SETTINGS_KEY); }
  catch { /* localStorage disabled */ }
  if (!raw) {
    warnRangeDefault("low",  DEFAULT_TARGET_RANGE.low);
    warnRangeDefault("high", DEFAULT_TARGET_RANGE.high);
    return DEFAULT_TARGET_RANGE;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let low: number;
    if (isFiniteNumber(parsed.targetMin) && parsed.targetMin > 0) low = parsed.targetMin;
    else { warnRangeDefault("low", DEFAULT_TARGET_RANGE.low); low = DEFAULT_TARGET_RANGE.low; }
    let high: number;
    if (isFiniteNumber(parsed.targetMax) && parsed.targetMax > low) high = parsed.targetMax;
    else { warnRangeDefault("high", DEFAULT_TARGET_RANGE.high); high = DEFAULT_TARGET_RANGE.high; }
    return { low, high };
  } catch {
    return DEFAULT_TARGET_RANGE;
  }
}

/**
 * Async DB read of the user's TIR target band from `user_settings`.
 * Falls back to DEFAULT_TARGET_RANGE on any failure (signed out,
 * Supabase unreachable, missing row, NULL columns) so callers don't
 * have to handle missing-data states. Use from initial-load
 * useEffects where the freshest cross-device value matters.
 */
export async function fetchTargetRange(): Promise<TargetRange> {
  if (!supabase) return DEFAULT_TARGET_RANGE;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_TARGET_RANGE;

  const { data, error } = await supabase
    .from("user_settings")
    .select("target_min_mgdl, target_max_mgdl")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return DEFAULT_TARGET_RANGE;

  const lowOk  = isFiniteNumber(data.target_min_mgdl) && data.target_min_mgdl > 0;
  const highOk = isFiniteNumber(data.target_max_mgdl) && data.target_max_mgdl > (lowOk ? data.target_min_mgdl : 0);
  if (!lowOk || !highOk) return DEFAULT_TARGET_RANGE;
  return { low: data.target_min_mgdl, high: data.target_max_mgdl };
}

/**
 * Persist the user's TIR target band. Clamps to the migration's CHECK
 * constraints (each bound 40–250, spread ≥ 20) before the upsert so a
 * Postgres rejection only fires for a truly malformed write. Throws
 * on auth/DB error so the Settings UI can surface a save-failed state.
 */
export async function saveTargetRange(range: TargetRange): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const clampedLow  = Math.min(250, Math.max(40, Math.round(range.low)));
  const clampedHigh = Math.min(250, Math.max(clampedLow + 20, Math.round(range.high)));

  const { error } = await supabase
    .from("user_settings")
    .upsert({
      user_id:         user.id,
      target_min_mgdl: clampedLow,
      target_max_mgdl: clampedHigh,
    }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
}

/* ── Engine-computed ICR (separate from user-set ICR) ─────────────── */
//
// Lucas-Spec May 14 split the single ICR column into two values that
// never clobber each other:
//
//   * `icr_g_per_unit`        → user-facing manual value. Bolus calc
//                               reads this. Settings UI writes this.
//   * `icr_g_per_unit_engine` → engine-computed adaptive ICR. ANZEIGE
//                               only by default; never feeds the bolus
//                               math unless the user opted-in via
//                               `engine_icr_auto_apply`.
//
// `persistEngineIcr` is called from the client (insights page) every
// time `computeAdaptiveICR` re-runs. That happens on every page load
// after a meal got logged, so the engine column stays roughly fresh
// without needing a separate cron. When `engine_icr_auto_apply` is on
// AND the engine has at least 10 meals, the engine value also takes
// over `icr_g_per_unit` and an entry lands in `adjustment_history`
// so the user can see what changed.

const ENGINE_ICR_AUTO_APPLY_MIN_SAMPLES = 10;

export interface EngineIcrInfo {
  /** Engine-computed adaptive ICR (g per unit), or null when the
   *  engine doesn't have enough meals yet. */
  value: number | null;
  /** Number of finalized meals that contributed to `value`. 0 when
   *  the engine hasn't computed yet. */
  sampleSize: number;
  /** ISO timestamp of the most recent engine recomputation, or null
   *  when no computation has been persisted yet. */
  updatedAt: string | null;
  /** When TRUE the engine overwrites `icr_g_per_unit` once
   *  `sampleSize` reaches `ENGINE_ICR_AUTO_APPLY_MIN_SAMPLES`. */
  autoApply: boolean;
}

export const DEFAULT_ENGINE_ICR_INFO: EngineIcrInfo = {
  value: null,
  sampleSize: 0,
  updatedAt: null,
  autoApply: false,
};

/**
 * Read the persisted engine ICR + auto-apply preference. Returns the
 * default zero-state when the user is signed out, the row hasn't been
 * created, or Supabase is unreachable — same fallback strategy as the
 * other helpers in this file so consumers don't have to handle errors.
 */
export async function fetchEngineIcrInfo(): Promise<EngineIcrInfo> {
  if (!supabase) return DEFAULT_ENGINE_ICR_INFO;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_ENGINE_ICR_INFO;

  const { data, error } = await supabase
    .from("user_settings")
    .select("icr_g_per_unit_engine, engine_icr_sample_size, engine_icr_updated_at, engine_icr_auto_apply")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return DEFAULT_ENGINE_ICR_INFO;

  return {
    value:      isFiniteNumber(data.icr_g_per_unit_engine) && data.icr_g_per_unit_engine > 0
                  ? data.icr_g_per_unit_engine : null,
    sampleSize: isFiniteNumber(data.engine_icr_sample_size) ? data.engine_icr_sample_size : 0,
    updatedAt:  typeof data.engine_icr_updated_at === "string" ? data.engine_icr_updated_at : null,
    autoApply:  Boolean(data.engine_icr_auto_apply),
  };
}

/**
 * Persist the engine-computed adaptive ICR. Always writes the engine
 * column. When the user has `engine_icr_auto_apply=TRUE` AND the sample
 * size reaches the threshold, ALSO writes the user column and appends
 * an `adjustment_history` entry so the audit trail stays complete.
 *
 * Idempotent on a no-op: if the engine value rounds to the same one-
 * decimal number that's already persisted, nothing is written. Errors
 * are swallowed (warned to console) — the caller (insights page) is a
 * fire-and-forget useEffect; a transient DB hiccup must not break the
 * card render.
 */
export async function persistEngineIcr(rawValue: number | null, rawSampleSize: number): Promise<void> {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Round to one decimal to match the column precision. Null pass-
  // through means "engine has no enough data" — we still persist that
  // explicitly so an old engine value doesn't linger after meals are
  // deleted.
  const engineValue = rawValue != null && Number.isFinite(rawValue) && rawValue > 0
    ? Math.round(rawValue * 10) / 10
    : null;
  const sampleSize = Math.max(0, Math.floor(rawSampleSize));

  // Pull current state to (a) skip writes when the rounded value matches
  // and (b) decide whether auto-apply should also touch the user column.
  const { data: current, error: readErr } = await supabase
    .from("user_settings")
    .select("icr_g_per_unit, icr_g_per_unit_engine, engine_icr_sample_size, engine_icr_auto_apply, adjustment_history")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    // eslint-disable-next-line no-console
    console.warn("[glev] persistEngineIcr read failed:", readErr.message);
    return;
  }

  const currentEngine = isFiniteNumber(current?.icr_g_per_unit_engine)
    ? current!.icr_g_per_unit_engine : null;
  const currentSample = isFiniteNumber(current?.engine_icr_sample_size)
    ? current!.engine_icr_sample_size : 0;
  // No-op fast path: same engine value AND same sample size → nothing
  // changed since last persist, skip the write entirely.
  if (currentEngine === engineValue && currentSample === sampleSize) return;

  const updates: Record<string, unknown> = {
    user_id:                user.id,
    icr_g_per_unit_engine:  engineValue,
    engine_icr_sample_size: sampleSize,
    engine_icr_updated_at:  new Date().toISOString(),
  };

  // Auto-apply: only when the user opted in AND the engine has enough
  // confidence (>=10 meals) AND the new value differs from the user's
  // current manual value (idempotent — re-applying the same number
  // would just spam the audit log).
  const autoApply = Boolean(current?.engine_icr_auto_apply);
  const currentUserIcr = isFiniteNumber(current?.icr_g_per_unit) && current!.icr_g_per_unit > 0
    ? current!.icr_g_per_unit
    : null;
  if (autoApply && engineValue != null && sampleSize >= ENGINE_ICR_AUTO_APPLY_MIN_SAMPLES
      && currentUserIcr !== engineValue) {
    updates.icr_g_per_unit = engineValue;
    const existingHistory: AdjustmentRecord[] = Array.isArray(current?.adjustment_history)
      ? (current!.adjustment_history as AdjustmentRecord[]) : [];
    updates.adjustment_history = [
      ...existingHistory,
      {
        at: new Date().toISOString(),
        field: "icr",
        // `from` may be null on first auto-apply — the AdjustmentRecord
        // shape expects a number, so we substitute the engine value
        // (which means "no prior delta"). Downstream UI tolerates
        // from===to as a no-op-render.
        from: currentUserIcr ?? engineValue,
        to: engineValue,
        reason: "engine-auto-apply",
      },
    ];
    // Mirror the new user ICR into localStorage so the sync
    // `getInsulinSettings()` caller (engine evaluation hot path) sees
    // the auto-applied value on the very next dose calc.
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        parsed.icr = engineValue;
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
      } catch { /* storage disabled / quota — ignore */ }
    }
  }

  const { error: writeErr } = await supabase
    .from("user_settings")
    .upsert(updates, { onConflict: "user_id" });
  if (writeErr) {
    // eslint-disable-next-line no-console
    console.warn("[glev] persistEngineIcr write failed:", writeErr.message);
  }
}

/**
 * Toggle whether the engine is allowed to auto-apply its adaptive ICR
 * onto the user's manual value. Throws on auth/DB error so the
 * Settings UI can surface a save-failed state.
 */
export async function setEngineIcrAutoApply(enabled: boolean): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, engine_icr_auto_apply: enabled }, { onConflict: "user_id" });
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
  // Use _liveSupabase() so that test fakes installed via globalThis._supabase
  // are picked up even when lib/supabase.ts is already in the module cache.
  const sb = _liveSupabase();
  if (!sb) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await sb.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  // Pull the row's current state — we need both the live ICR/CF (for
  // the "from" value in each history entry, since the suggestion was
  // computed against possibly-stale UI state) and the existing
  // history (so we can append rather than overwrite).
  const { data: current, error: readErr } = await sb
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

  const { error: writeErr } = await sb
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

/* ── AI consent ──────────────────────────────────────────────────── */

/**
 * Read the user's AI-feature consent flag from `user_settings`.
 * Returns false when the row is absent, the user is signed out, or
 * Supabase is unreachable. No throw — callers always get a boolean.
 */
export async function fetchAiConsent(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("user_settings")
    .select("ai_consent")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean(data.ai_consent);
}
