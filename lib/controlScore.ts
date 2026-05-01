import { unifiedOutcome, type Meal } from "./meals";
import { parseDbDate } from "./time";

/**
 * Rolling Control Score over a `[sinceMs, untilMs)` window.
 *
 * Extracted from `app/(protected)/dashboard/page.tsx` (Task #41) so the
 * formula can be unit-tested without dragging the React-only dashboard
 * tree into the Playwright unit suite. The dashboard re-exports the
 * helper from this module — behaviour is unchanged.
 *
 * Four mutually-exclusive buckets aligned with the deterministic
 * evaluator's outcome labels (`lib/engine/evaluation.ts`):
 *   GOOD       — dose matched the meal (Δ within ±30 mg/dL)
 *   SPIKE      — post-meal high (rapid spike OR slow underdose); incl. legacy "HIGH"
 *   OVERDOSE   — post-meal low (insulin overshot); incl. legacy "LOW"
 *   OTHER      — CHECK_CONTEXT, null, or anything we can't categorise yet
 *                (pending / provisional rows whose lifecycleFor hasn't
 *                cached an evaluation, plus the diagnostic CHECK_CONTEXT
 *                outcome). Stays in the denominator — a still-pending
 *                meal lowers all three displayed rates equally instead
 *                of being silently excluded.
 *
 * Spec formula:
 *   score = clamp(goodRate*0.7 + (100 - spikeRate - hypoRate)*0.3, 0, 100)
 *
 * `count` returns the denominator (every in-window meal — pending rows
 * included) so the card's "not enough data" branch still triggers.
 *
 * @param now Optional clock injection for tests; defaults to `new Date()`
 *            and is forwarded to `unifiedOutcome` so lifecycle decisions
 *            are deterministic in unit tests.
 */
export function computeControlScore(
  meals: Meal[],
  sinceMs: number,
  untilMs: number = Infinity,
  now: Date = new Date(),
): { score: number; count: number } {
  const inWindow = meals.filter(m => {
    const t = parseDbDate(m.created_at).getTime();
    return t >= sinceMs && t < untilMs;
  });
  const total = inWindow.length;
  if (!total) return { score: 0, count: 0 };
  let good = 0, spike = 0, hypo = 0;
  for (const m of inWindow) {
    const ev = unifiedOutcome(m, now);
    if      (ev === "GOOD")                                       good++;
    else if (ev === "SPIKE" || ev === "UNDERDOSE" || ev === "LOW") spike++;
    else if (ev === "OVERDOSE" || ev === "HIGH")                  hypo++;
  }
  const goodRate  = (good  / total) * 100;
  const spikeRate = (spike / total) * 100;
  const hypoRate  = (hypo  / total) * 100;
  const raw   = goodRate * 0.7 + (100 - spikeRate - hypoRate) * 0.3;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, count: total };
}
