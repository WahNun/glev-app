/**
 * Server-side: find the CGM reading closest to a target timestamp
 * within a ±window. Used by PATCH endpoints that edit an entry's
 * timestamp (meals, bolus, exercise) so the snapshot glucose-before
 * column is re-aligned to the new time instead of staying stale.
 *
 * Sources both stream tables via the existing getCgmSamples helper
 * (cgm_samples + apple_health_readings) — so it works for LLU,
 * Nightscout, and HealthKit users alike.
 *
 * Returns null when no sample is found in the window — caller
 * decides whether to null-out the persisted snapshot or leave it
 * (we recommend null-out so the UI can fall back to manual entry).
 *
 * Window default: ±15 minutes — matches the client-side MealEditor
 * auto-fill behaviour.
 */

import { getCgmSamples } from "./samples";

export async function findGlucoseAt(
  userId: string,
  targetIso: string,
  windowMinutes: number = 15,
): Promise<{ value: number; tIso: string } | null> {
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return null;
  const winMs = Math.max(1, windowMinutes) * 60_000;
  const fromMs = target - winMs;
  const toMs = target + winMs;
  try {
    const samples = await getCgmSamples(userId, fromMs, toMs);
    if (!samples || samples.length === 0) return null;
    let best = samples[0];
    let bestDelta = Math.abs(best.t - target);
    for (const s of samples) {
      const d = Math.abs(s.t - target);
      if (d < bestDelta) {
        best = s;
        bestDelta = d;
      }
    }
    return { value: Math.round(best.v), tIso: new Date(best.t).toISOString() };
  } catch {
    return null;
  }
}
