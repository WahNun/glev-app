"use client";

import { type Meal } from "@/lib/meals";
import { supabase } from "@/lib/supabase";
import { logDebug } from "@/lib/debug";
import { parseLluTs as _parseLluTs, parseDbTs } from "@/lib/time";

const STORAGE_KEY_BASE = "glev:scheduled-cgm-fills";
const MATCH_WINDOW_MIN = 15;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const HISTORY_HORIZON_MS = 12 * ONE_HOUR_MS;

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

/** Conditionally write the autofill value only if the column is still null in
 *  the DB. This prevents a background timer/reconciliation from clobbering a
 *  reading the user has manually entered in the Entry Log meanwhile. */
async function fillSlot(
  mealId: string,
  mealTimeMs: number,
  slot: "1h" | "2h",
  history: CgmReading[],
): Promise<boolean> {
  const targetMs = mealTimeMs + (slot === "1h" ? ONE_HOUR_MS : TWO_HOURS_MS);
  if (Date.now() < targetMs) return false;
  const match = nearestReading(history, targetMs);
  if (!match) return false;
  if (!supabase) return false;

  const valueCol = slot === "1h" ? "bg_1h" : "bg_2h";
  const atCol    = slot === "1h" ? "bg_1h_at" : "bg_2h_at";
  const patch: Record<string, unknown> = {
    [valueCol]: match.value,
    [atCol]:    new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("meals")
    .update(patch)
    .eq("id", mealId)
    .is(valueCol, null)            // never overwrite a manually-entered reading
    .select("id");

  if (error) {
    // Schema-cache: column missing → nothing we can do from the autofiller; the
    // user can still record readings via the Entry Log fallback path. Log + bail.
    logDebug("CGM_AUTOFILL_DB_ERROR", { mealId, slot, message: error.message });
    return false;
  }
  const rows = (data ?? []).length;
  if (rows === 0) return false;     // already filled (manual entry won the race)
  logDebug("CGM_AUTOFILL", { mealId, slot, value: match.value, ageMin: Math.round(match.ageMin) });
  return true;
}

function armTimers(mealId: string, mealMs: number) {
  const existing = timers.get(mealId);
  if (existing) clearTimeout(existing);

  const now = Date.now();
  const delay1 = mealMs + ONE_HOUR_MS - now;
  const delay2 = mealMs + TWO_HOURS_MS - now;
  const candidates = [delay1, delay2].filter((d) => d > 0);
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
    if (await fillSlot(mealId, mealMs, "1h", hist.history)) filled = true;
    if (await fillSlot(mealId, mealMs, "2h", hist.history)) filled = true;
    if (filled && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("glev:meals-updated", { detail: { source: "cgm-autofill-timer" } }));
    }
    if (Date.now() >= mealMs + TWO_HOURS_MS) {
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
  if (Date.now() >= ms + TWO_HOURS_MS) return;
  void addScheduled(mealId, mealTimeIso);
  armTimers(mealId, ms);
}

/** Re-arm timers for any persisted scheduled fills (after page reload / new tab). */
export async function restoreScheduledTimers(): Promise<void> {
  for (const item of await loadScheduled()) {
    const ms = Date.parse(item.mealTimeIso);
    if (!isFinite(ms) || Date.now() >= ms + TWO_HOURS_MS) {
      void removeScheduled(item.mealId);
      continue;
    }
    armTimers(item.mealId, ms);
  }
}

/** Backfill any meal whose 1h or 2h slot is past-due and still null using
 *  the LLU graph history. Skips rows older than the CGM history horizon. */
export async function reconcilePendingMealsCgm(meals: Meal[]): Promise<{ filled: number }> {
  const now = Date.now();
  const candidates = meals.filter((m) => {
    const t = m.meal_time ? parseDbTs(m.meal_time) : parseDbTs(m.created_at);
    if (!isFinite(t)) return false;
    if (now - t > HISTORY_HORIZON_MS) return false;
    const need1h = m.bg_1h == null && now >= t + ONE_HOUR_MS;
    const need2h = m.bg_2h == null && now >= t + TWO_HOURS_MS;
    return need1h || need2h;
  });
  if (candidates.length === 0) return { filled: 0 };

  const hist = await fetchCgmHistory();
  if (!hist || !hist.history?.length) return { filled: 0 };

  let filled = 0;
  for (const m of candidates) {
    const t = m.meal_time ? parseDbTs(m.meal_time) : parseDbTs(m.created_at);
    try {
      if (m.bg_1h == null && now >= t + ONE_HOUR_MS) {
        if (await fillSlot(m.id, t, "1h", hist.history)) filled++;
      }
      if (m.bg_2h == null && now >= t + TWO_HOURS_MS) {
        if (await fillSlot(m.id, t, "2h", hist.history)) filled++;
      }
    } catch (e) {
      logDebug("CGM_AUTOFILL_ERROR", { mealId: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { filled };
}
