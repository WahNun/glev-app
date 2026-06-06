"use client";

import { type Meal } from "@/lib/meals";
import { supabase } from "@/lib/supabase";
import { logDebug } from "@/lib/debug";
import { parseLluTs as _parseLluTs, parseDbTs } from "@/lib/time";

const STORAGE_KEY_BASE = "glev:scheduled-cgm-fills";
/**
 * Tolerance window (minutes) around each target when picking the
 * closest CGM reading. Wide on purpose: sparse-data CGMs (Libre 14d at
 * 15-min cadence with occasional gaps) and users who scan late often
 * have no value within ±15 min of the exact target. 60 min covers a
 * broad window — narrow enough to not grab a reading from the middle of
 * the next meal.
 */
const MATCH_WINDOW_MIN = 60;
const ONE_HOUR_MS      = 60 * 60 * 1000;
const TWO_HOURS_MS     = 2 * ONE_HOUR_MS;
const HISTORY_HORIZON_MS = 12 * ONE_HOUR_MS;

const THIRTY_MIN_MS  =  30 * 60 * 1000;
const NINETY_MIN_MS  =  90 * 60 * 1000;
const THREE_HOURS_MS = 180 * 60 * 1000;

type SlotKey = "30min" | "1h" | "90min" | "2h" | "3h";

interface SlotCfg {
  offsetMs: number;
  /** Primary column written (new glucose_* family). */
  valueCol: string;
  atCol: string;
  /** Legacy bg_* column written in parallel while the old columns coexist. */
  legacyValueCol?: string;
  legacyAtCol?: string;
}

const SLOT_CONFIG: Record<SlotKey, SlotCfg> = {
  "30min": { offsetMs: THIRTY_MIN_MS,  valueCol: "glucose_30min", atCol: "glucose_30min_at" },
  "1h":    { offsetMs: ONE_HOUR_MS,    valueCol: "glucose_1h",    atCol: "glucose_1h_at",    legacyValueCol: "bg_1h", legacyAtCol: "bg_1h_at" },
  "90min": { offsetMs: NINETY_MIN_MS,  valueCol: "glucose_90min", atCol: "glucose_90min_at" },
  "2h":    { offsetMs: TWO_HOURS_MS,   valueCol: "glucose_2h",    atCol: "glucose_2h_at",    legacyValueCol: "bg_2h", legacyAtCol: "bg_2h_at" },
  "3h":    { offsetMs: THREE_HOURS_MS, valueCol: "glucose_3h",    atCol: "glucose_3h_at" },
};

const ALL_SLOTS: SlotKey[] = ["30min", "1h", "90min", "2h", "3h"];

interface CgmReading { value: number | null; timestamp: string | null; }
interface CgmHistoryResponse { current: CgmReading | null; history: CgmReading[]; }
interface ScheduledFill { mealId: string; mealTimeIso: string; }

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let historyCache: { fetchedAt: number; data: CgmHistoryResponse } | null = null;
const HISTORY_CACHE_MS = 30_000;

function parseLluTs(ts: string | null): number | null {
  return _parseLluTs(ts);
}

async function fetchCgmHistory(force = false): Promise<CgmHistoryResponse | null> {
  if (!force && historyCache && Date.now() - historyCache.fetchedAt < HISTORY_CACHE_MS) {
    return historyCache.data;
  }
  try {
    const r = await fetch("/api/cgm/history", { cache: "no-store" });
    if (!r.ok) return null;
    const data = (await r.json()) as CgmHistoryResponse;
    historyCache = { fetchedAt: Date.now(), data };
    return data;
  } catch { return null; }
}

function nearestReading(history: CgmReading[], targetMs: number): { value: number; ageMin: number } | null {
  let best: { value: number; ageMin: number } | null = null;
  for (const r of history) {
    if (r.value == null) continue;
    const t = parseLluTs(r.timestamp);
    if (t == null) continue;
    const ageMin = Math.abs(t - targetMs) / 60_000;
    if (ageMin <= MATCH_WINDOW_MIN && (!best || ageMin < best.ageMin)) {
      best = { value: r.value, ageMin };
    }
  }
  return best;
}

/**
 * Public CGM-history lookup used by the manual-entry modal to auto-fill
 * glucose-before / bg_1h / bg_2h when the user picks a meal time. Returns
 * null when no CGM source is linked, the history endpoint is offline, or
 * no reading falls inside the ±MATCH_WINDOW_MIN tolerance — the caller
 * should silently fall back to manual entry in that case.
 *
 * Uses the same 30 s in-memory cache as the auto-fill timers so rapid
 * meal-time tweaks in the modal don't hammer /api/cgm/history.
 */
export async function findCgmReadingNearTime(targetMs: number): Promise<{ value: number; ageMin: number } | null> {
  const hist = await fetchCgmHistory();
  if (!hist?.history?.length) return null;
  return nearestReading(hist.history, targetMs);
}

// User-namespaced storage keys so account switches do not bleed scheduled
// timers across users. Falls back to the un-namespaced legacy key while a
// user-id is being resolved on first call.
let cachedUserId: string | null | undefined; // undefined = not yet checked
async function userId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  if (!supabase) { cachedUserId = null; return null; }
  try {
    const { data } = await supabase.auth.getUser();
    cachedUserId = data?.user?.id ?? null;
  } catch { cachedUserId = null; }
  return cachedUserId;
}

function storageKeyFor(uid: string | null): string {
  return uid ? `${STORAGE_KEY_BASE}:${uid}` : STORAGE_KEY_BASE;
}

async function loadScheduled(): Promise<ScheduledFill[]> {
  if (typeof localStorage === "undefined") return [];
  const uid = await userId();
  try {
    const raw = localStorage.getItem(storageKeyFor(uid));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function saveScheduled(items: ScheduledFill[]) {
  if (typeof localStorage === "undefined") return;
  const uid = await userId();
  try { localStorage.setItem(storageKeyFor(uid), JSON.stringify(items)); } catch {}
}

/** Clear cached user id + in-tab timers; called on sign-out so a freshly
 *  signed-in account does not inherit the previous user's timers. */
export function resetAutoFillForSignOut(): void {
  cachedUserId = undefined;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  historyCache = null;
}

async function addScheduled(mealId: string, mealTimeIso: string) {
  const items = (await loadScheduled()).filter((s) => s.mealId !== mealId);
  items.push({ mealId, mealTimeIso });
  await saveScheduled(items);
}

async function removeScheduled(mealId: string) {
  await saveScheduled((await loadScheduled()).filter((s) => s.mealId !== mealId));
}

/**
 * Conditionally write the autofill value only if the primary column is
 * still null in the DB. This prevents a background timer from clobbering
 * a reading the user has manually entered in the Entry Log meanwhile.
 *
 * For slots with a legacy bg_* column (1h, 2h) we also write that column
 * so the CgmCountdownPair + lifecycle engine continue to work without schema
 * changes while the old columns are being deprecated.
 */
async function fillSlot(
  mealId: string,
  mealTimeMs: number,
  slot: SlotKey,
  history: CgmReading[],
): Promise<boolean> {
  const cfg = SLOT_CONFIG[slot];
  const targetMs = mealTimeMs + cfg.offsetMs;
  if (Date.now() < targetMs) return false;
  const match = nearestReading(history, targetMs);
  if (!match) return false;
  if (!supabase) return false;

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    [cfg.valueCol]: match.value,
    [cfg.atCol]:    nowIso,
  };
  // Also write legacy bg_* columns so CgmCountdownPair + lifecycle keep working.
  if (cfg.legacyValueCol) {
    patch[cfg.legacyValueCol] = match.value;
    patch[cfg.legacyAtCol!]   = nowIso;
  }

  const { data, error } = await supabase
    .from("meals")
    .update(patch)
    .eq("id", mealId)
    .is(cfg.valueCol, null)            // never overwrite a manually-entered reading
    .select("id");

  if (error) {
    logDebug("CGM_AUTOFILL_DB_ERROR", { mealId, slot, message: error.message });
    return false;
  }
  const rows = (data ?? []).length;
  if (rows === 0) return false;        // already filled (manual entry won the race)
  logDebug("CGM_AUTOFILL", { mealId, slot, value: match.value, ageMin: Math.round(match.ageMin) });

  // When the 2h slot was just populated, give the row a chance to flip
  // `evaluation` from null → final. Non-fatal — the lifecycle recomputes
  // on read so a failure here just delays the cached column update.
  if (slot === "2h") {
    try {
      const { data: row } = await supabase
        .from("meals")
        .select("id, glucose_before, bg_1h, bg_1h_at, bg_2h, bg_2h_at, glucose_after, meal_time, created_at, carbs_grams, protein_grams, fat_grams, fiber_grams, insulin_units, meal_type, evaluation")
        .eq("id", mealId)
        .single();
      if (row) {
        const [{ lifecycleFor }, { fetchInsulinSettings }] = await Promise.all([
          import("./engine/lifecycle"),
          import("./userSettings"),
        ]);
        const settings = await fetchInsulinSettings();
        const lc = lifecycleFor(row as unknown as import("./meals").Meal, new Date(), settings);
        const evaluation = lc.state === "final" ? lc.outcome : null;
        if (evaluation !== (row as { evaluation: string | null }).evaluation) {
          await supabase.from("meals").update({ evaluation }).eq("id", mealId);
        }
      }
    } catch (e) {
      logDebug("CGM_AUTOFILL_EVAL_REFRESH_ERROR", { mealId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return true;
}

function armTimers(mealId: string, mealMs: number) {
  const existing = timers.get(mealId);
  if (existing) clearTimeout(existing);

  const now = Date.now();
  // Find the delay to the next slot that hasn't fired yet.
  const candidates = ALL_SLOTS
    .map(slot => mealMs + SLOT_CONFIG[slot].offsetMs - now)
    .filter(d => d > 0);

  if (candidates.length === 0) {
    void removeScheduled(mealId);
    return;
  }
  const nextDelay = Math.min(...candidates);
  // Cap at 24h to avoid pathological timers; min 1s.
  const safeDelay = Math.min(Math.max(nextDelay, 1000), 24 * ONE_HOUR_MS);

  const t = setTimeout(async () => {
    timers.delete(mealId);
    const hist = await fetchCgmHistory(true);
    if (!hist) {
      // Retry in 60s.
      const retry = setTimeout(() => armTimers(mealId, mealMs), 60_000);
      timers.set(mealId, retry);
      return;
    }
    let filled = false;
    for (const slot of ALL_SLOTS) {
      if (await fillSlot(mealId, mealMs, slot, hist.history)) filled = true;
    }
    if (filled && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("glev:meals-updated", { detail: { source: "cgm-autofill-timer" } }));
    }
    // Keep rescheduling until all slots are past.
    const allSlotsDone = ALL_SLOTS.every(s => Date.now() >= mealMs + SLOT_CONFIG[s].offsetMs);
    if (allSlotsDone) {
      void removeScheduled(mealId);
    } else {
      armTimers(mealId, mealMs);
    }
  }, safeDelay);
  timers.set(mealId, t);
}

/** Persist + arm in-tab timers for a freshly-logged meal. Safe to call with a
 *  past meal_time — the timer is only armed for slots still in the future. */
export function scheduleAutoFillForMeal(mealId: string, mealTimeIso: string): void {
  const ms = Date.parse(mealTimeIso);
  if (!isFinite(ms)) return;
  if (Date.now() >= ms + THREE_HOURS_MS) return;
  void addScheduled(mealId, mealTimeIso);
  armTimers(mealId, ms);
}

/** Re-arm timers for any persisted scheduled fills (after page reload / new tab). */
export async function restoreScheduledTimers(): Promise<void> {
  for (const item of await loadScheduled()) {
    const ms = Date.parse(item.mealTimeIso);
    if (!isFinite(ms) || Date.now() >= ms + THREE_HOURS_MS) {
      void removeScheduled(item.mealId);
      continue;
    }
    armTimers(item.mealId, ms);
  }
}

/** Backfill any meal whose slots are past-due and still null using
 *  the CGM history. Skips rows older than the CGM history horizon (12h). */
export async function reconcilePendingMealsCgm(meals: Meal[]): Promise<{ filled: number }> {
  const now = Date.now();
  const candidates = meals.filter((m) => {
    const t = m.meal_time ? parseDbTs(m.meal_time) : parseDbTs(m.created_at);
    if (!isFinite(t)) return false;
    if (now - t > HISTORY_HORIZON_MS) return false;
    // Needs at least one slot past-due and unfilled.
    return ALL_SLOTS.some(slot => {
      const col = SLOT_CONFIG[slot].valueCol as keyof Meal;
      return (m[col] == null) && now >= t + SLOT_CONFIG[slot].offsetMs;
    });
  });
  if (candidates.length === 0) return { filled: 0 };

  const hist = await fetchCgmHistory();
  if (!hist || !hist.history?.length) return { filled: 0 };

  let filled = 0;
  for (const m of candidates) {
    const t = m.meal_time ? parseDbTs(m.meal_time) : parseDbTs(m.created_at);
    for (const slot of ALL_SLOTS) {
      const col = SLOT_CONFIG[slot].valueCol as keyof Meal;
      if (m[col] == null && now >= t + SLOT_CONFIG[slot].offsetMs) {
        try {
          if (await fillSlot(m.id, t, slot, hist.history)) filled++;
        } catch (e) {
          logDebug("CGM_AUTOFILL_ERROR", { mealId: m.id, slot, message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }
  return { filled };
}
