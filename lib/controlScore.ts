import { unifiedOutcome, type Meal } from "./meals";
import { parseDbDate } from "./time";

/**
 * Rolling Adapt Score over a `[sinceMs, untilMs)` window.
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
 *   OTHER      — null or anything we can't categorise yet (pending /
 *                provisional rows whose lifecycleFor hasn't cached an
 *                evaluation).
 *
 * Key change vs. v1: only *evaluated* meals (GOOD + SPIKE + HYPO) enter
 * the denominator. Pending/OTHER rows are excluded from the rate math so
 * that active loggers aren't penalised for meals that haven't been
 * assessed yet. The raw `count` still reflects every in-window meal
 * (including pending) so the "n entries" display stays accurate.
 *
 * Minimum threshold: fewer than 3 evaluated meals → `score: null`.
 * The dashboard shows "IM AUFBAU" / "BUILDING" in that case.
 *
 * Spec formula (applied to evaluated-only denominator):
 *   score = clamp(goodRate×0.7 + (100 − spikeRate − hypoRate)×0.3, 0, 100)
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
): { score: number | null; count: number; good: number; spike: number; hypo: number; other: number } {
  const inWindow = meals.filter(m => {
    const t = parseDbDate(m.created_at).getTime();
    return t >= sinceMs && t < untilMs;
  });
  const total = inWindow.length;
  if (!total) return { score: null, count: 0, good: 0, spike: 0, hypo: 0, other: 0 };

  let good = 0, spike = 0, hypo = 0;
  for (const m of inWindow) {
    const ev = unifiedOutcome(m, now);
    if      (ev === "GOOD")                                                               good++;
    else if (ev === "SPIKE" || ev === "SPIKE_STRONG" || ev === "UNDERDOSE" || ev === "LOW") spike++;
    else if (ev === "OVERDOSE" || ev === "HIGH" || ev === "HYPO_DURING")                  hypo++;
  }

  const evaluated = good + spike + hypo;
  const other     = total - evaluated;

  // Not enough evaluated meals — return null so the UI can show "IM AUFBAU".
  if (evaluated < 3) return { score: null, count: total, good, spike, hypo, other };

  const goodRate  = (good  / evaluated) * 100;
  const spikeRate = (spike / evaluated) * 100;
  const hypoRate  = (hypo  / evaluated) * 100;
  const raw   = goodRate * 0.7 + (100 - spikeRate - hypoRate) * 0.3;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, count: total, good, spike, hypo, other };
}
