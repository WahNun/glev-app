/**
 * Shared input normalisation for the Apple-Health daily-steps sync
 * endpoint (Task #183). Extracted from `app/api/health/steps/sync/route.ts`
 * so unit tests assert the SAME function the route handler runs —
 * preventing mirrored-validator drift that a copy-paste test would
 * eventually accrue.
 */

export const HEALTH_STEPS_MAX_BATCH = 400;
export const HEALTH_STEPS_MAX_STEPS = 250_000;
export const HEALTH_STEPS_MAX_ACTIVE_MIN = 1440;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InboundHealthStepsSample {
  date?: unknown;
  steps?: unknown;
  activeMinutes?: unknown;
}

export interface NormalisedHealthStepsRow {
  date: string;
  steps: number;
  active_minutes: number | null;
}

/**
 * Strict calendar-date validator. `new Date("YYYY-MM-DDTHH:MM:SSZ")`
 * silently rolls invalid dates over (e.g. "2026-02-31" → Mar 3), so
 * we parse the digits ourselves and round-trip the resulting Date
 * back to the canonical UTC ISO string. Any mismatch means the
 * caller sent a non-existent calendar date and the row is rejected.
 */
function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function normaliseHealthStepsSample(
  s: InboundHealthStepsSample,
): NormalisedHealthStepsRow | null {
  if (!s || typeof s !== "object") return null;
  const date = typeof s.date === "string" ? s.date.trim() : "";
  if (!isValidCalendarDate(date)) return null;

  const stepsRaw = typeof s.steps === "number" ? s.steps : Number(s.steps);
  if (!Number.isFinite(stepsRaw)) return null;
  const steps = Math.round(stepsRaw);
  if (steps < 0 || steps > HEALTH_STEPS_MAX_STEPS) return null;

  let activeMinutes: number | null = null;
  if (s.activeMinutes != null) {
    const amRaw =
      typeof s.activeMinutes === "number"
        ? s.activeMinutes
        : Number(s.activeMinutes);
    if (Number.isFinite(amRaw)) {
      const am = Math.round(amRaw);
      if (am >= 0 && am <= HEALTH_STEPS_MAX_ACTIVE_MIN) activeMinutes = am;
    }
  }

  return { date, steps, active_minutes: activeMinutes };
}
