/**
 * lib/icrSchedule.ts — per-user time-banded ICR helper.
 *
 * Phase A (2026-05-14): UI + persistence only. The Adaptive Engine
 * (lib/engine/adaptiveICR.ts) does NOT consult this yet — Phase B
 * wires it after Lucas confirms the data shape on /settings/icr-schedule.
 *
 * Storage:
 *   - `user_icr_schedule` table — 0..3 rows per user (slot_index 1/2/3)
 *   - `user_settings.icr_schedule_enabled` master toggle
 *
 * Slots may wrap midnight (start > end → window crosses 00:00). The
 * `findActiveSlot()` helper handles the modulo so callers can ignore it.
 */

import { supabase } from "./supabase";

/** localStorage mirror — lets the engine read the schedule synchronously
 *  from inside `evaluateEntry()` (which can't await). Updated on every
 *  fetch + save. Schema-versioned so future changes can invalidate. */
const LS_KEY = "glev_icr_schedule_v1";

export type IcrSlot = {
  slotIndex: 1 | 2 | 3;
  label: string;
  startMinute: number; // 0..1439
  endMinute:   number; // 0..1439
  icrGPerUnit: number; // 1..100
  enabled: boolean;
};

export type IcrSchedule = {
  enabled: boolean;
  slots: IcrSlot[]; // 0..3, sorted by slotIndex
};

export const EMPTY_ICR_SCHEDULE: IcrSchedule = { enabled: false, slots: [] };

/** Sensible defaults the Settings page seeds when no rows exist —
 *  three classic meal windows. User overwrites freely. */
export function defaultSlots(currentIcr?: number): IcrSlot[] {
  const fallback = currentIcr && currentIcr >= 1 && currentIcr <= 100 ? Math.round(currentIcr) : 15;
  return [
    { slotIndex: 1, label: "",  startMinute:  4 * 60,             endMinute: 11 * 60,             icrGPerUnit: fallback, enabled: true },
    { slotIndex: 2, label: "",  startMinute: 11 * 60,             endMinute: 17 * 60,             icrGPerUnit: fallback, enabled: true },
    { slotIndex: 3, label: "",  startMinute: 17 * 60,             endMinute: (4 * 60) % 1440,     icrGPerUnit: fallback, enabled: true },
  ];
}

export function minutesToHHMM(m: number): string {
  const mm = Math.max(0, Math.min(1439, Math.round(m)));
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** True if `minute` falls inside [start, end), handling midnight-wrap.
 *  When start === end the slot is treated as covering the full day. */
export function slotContainsMinute(slot: IcrSlot, minute: number): boolean {
  if (!slot.enabled) return false;
  const m = ((minute % 1440) + 1440) % 1440;
  if (slot.startMinute === slot.endMinute) return true;
  if (slot.startMinute < slot.endMinute) {
    return m >= slot.startMinute && m < slot.endMinute;
  }
  // Wraps midnight, e.g. 22:00 → 06:00
  return m >= slot.startMinute || m < slot.endMinute;
}

/** First enabled slot whose window contains `minute`. */
export function findActiveSlot(schedule: IcrSchedule, minute: number): IcrSlot | null {
  if (!schedule.enabled) return null;
  for (const s of schedule.slots) if (slotContainsMinute(s, minute)) return s;
  return null;
}

/** Sync localStorage read — used by the engine inside evaluateEntry()
 *  which can't await. Returns EMPTY_ICR_SCHEDULE on SSR / parse error /
 *  empty cache so callers can always fall back to the global ICR. */
export function loadIcrScheduleSync(): IcrSchedule {
  if (typeof window === "undefined") return EMPTY_ICR_SCHEDULE;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_ICR_SCHEDULE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_ICR_SCHEDULE;
    const enabled = parsed.enabled === true;
    const slotsRaw = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slots: IcrSlot[] = [];
    for (const r of slotsRaw) {
      if (!r || typeof r !== "object") continue;
      const idx = Number(r.slotIndex);
      if (idx !== 1 && idx !== 2 && idx !== 3) continue;
      const startMinute = Number(r.startMinute);
      const endMinute   = Number(r.endMinute);
      const icr         = Number(r.icrGPerUnit);
      if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || !Number.isFinite(icr)) continue;
      slots.push({
        slotIndex: idx as 1 | 2 | 3,
        label: typeof r.label === "string" ? r.label : "",
        startMinute, endMinute,
        icrGPerUnit: icr,
        enabled: r.enabled !== false,
      });
    }
    return { enabled, slots };
  } catch {
    return EMPTY_ICR_SCHEDULE;
  }
}

function writeScheduleToLS(schedule: IcrSchedule): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(schedule)); }
  catch { /* quota / privacy mode — silently ignore, DB is source of truth */ }
}

/** "Which ICR applies right now?" — sync helper used by the evaluator
 *  and the dose recommender. Returns the matching slot's ICR when:
 *   1. master toggle is on, AND
 *   2. an enabled slot covers `at`'s minute-of-day.
 *  Otherwise returns `fallbackIcr` (the global ICR from user_settings).
 *  The matching slot (if any) is returned so the UI can attribute the
 *  recommendation to a window name. */
export function getEffectiveICR(
  at: Date,
  fallbackIcr: number,
): { icr: number; slot: IcrSlot | null } {
  const schedule = loadIcrScheduleSync();
  if (!schedule.enabled) return { icr: fallbackIcr, slot: null };
  const minute = at.getHours() * 60 + at.getMinutes();
  const slot = findActiveSlot(schedule, minute);
  if (!slot) return { icr: fallbackIcr, slot: null };
  return { icr: slot.icrGPerUnit, slot };
}

/** Read the schedule from Supabase. Empty/error → empty schedule.
 *  Side effect: mirrors the result into localStorage so `loadIcrScheduleSync`
 *  has the latest data ready for the engine. */
export async function fetchIcrSchedule(): Promise<IcrSchedule> {
  if (!supabase) return EMPTY_ICR_SCHEDULE;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY_ICR_SCHEDULE;

  // Master toggle lives on user_settings. 42703 = column doesn't exist
  // yet → migration not run → treat as off.
  const { data: settings, error: sErr } = await supabase
    .from("user_settings")
    .select("icr_schedule_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  const enabled = !sErr && settings?.icr_schedule_enabled === true;

  const { data: rows, error: rErr } = await supabase
    .from("user_icr_schedule")
    .select("slot_index, label, start_minute, end_minute, icr_g_per_unit, enabled")
    .eq("user_id", user.id)
    .order("slot_index", { ascending: true });

  if (rErr || !rows) {
    const out = { enabled, slots: [] };
    writeScheduleToLS(out);
    return out;
  }

  const slots: IcrSlot[] = rows
    .filter(r => r.slot_index === 1 || r.slot_index === 2 || r.slot_index === 3)
    .map(r => ({
      slotIndex: r.slot_index as 1 | 2 | 3,
      label: typeof r.label === "string" ? r.label : "",
      startMinute: Number(r.start_minute),
      endMinute:   Number(r.end_minute),
      icrGPerUnit: Number(r.icr_g_per_unit),
      enabled: r.enabled !== false,
    }));

  const out = { enabled, slots };
  writeScheduleToLS(out);
  return out;
}

/** Replace the user's full schedule (master toggle + 3 slots).
 *  Throws on auth/db error so the Settings page can surface inline. */
export async function saveIcrSchedule(schedule: IcrSchedule): Promise<void> {
  if (!supabase) throw new Error("supabase-not-configured");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not-authenticated");

  // Validate before writing — cheap defense against UI bugs that send
  // out-of-range values (DB CHECKs would catch but error UX is uglier).
  for (const s of schedule.slots) {
    if (![1, 2, 3].includes(s.slotIndex)) throw new Error(`invalid-slot-index:${s.slotIndex}`);
    if (s.startMinute < 0 || s.startMinute > 1439) throw new Error(`invalid-start:${s.startMinute}`);
    if (s.endMinute   < 0 || s.endMinute   > 1439) throw new Error(`invalid-end:${s.endMinute}`);
    if (s.icrGPerUnit < 1 || s.icrGPerUnit > 100)  throw new Error(`invalid-icr:${s.icrGPerUnit}`);
  }

  // Upsert master toggle on user_settings (row may not exist yet for
  // brand-new accounts → on conflict do update).
  const { error: sErr } = await supabase
    .from("user_settings")
    .upsert(
      { user_id: user.id, icr_schedule_enabled: schedule.enabled },
      { onConflict: "user_id" },
    );
  if (sErr) throw sErr;

  // Replace strategy: upsert each slot. We don't delete missing slots
  // because the UI always sends all three. Keeps behaviour predictable.
  if (schedule.slots.length > 0) {
    const rows = schedule.slots.map(s => ({
      user_id:        user.id,
      slot_index:     s.slotIndex,
      label:          s.label || null,
      start_minute:   s.startMinute,
      end_minute:     s.endMinute,
      icr_g_per_unit: s.icrGPerUnit,
      enabled:        s.enabled,
      updated_at:     new Date().toISOString(),
    }));
    const { error: rErr } = await supabase
      .from("user_icr_schedule")
      .upsert(rows, { onConflict: "user_id,slot_index" });
    if (rErr) throw rErr;
  }

  // Mirror the freshly-saved state into LS so the next evaluator call
  // sees it without waiting for fetchIcrSchedule to re-run.
  writeScheduleToLS(schedule);
}
