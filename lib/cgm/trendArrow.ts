/**
 * Client-side helper to capture the current CGM trend arrow at the
 * moment a meal is logged (Task #265). Returns the raw `current.trend`
 * string from the source adapter (LLU / Nightscout / Apple Health) —
 * one of `fallingQuickly` / `falling` / `stable` / `rising` /
 * `risingQuickly` — or `null` when the CGM is unavailable, slow, or
 * has no current reading.
 *
 * Designed to never block the meal-save UX:
 *   - Reuses the shared client cache (`fetchCgmHistory`) when possible
 *     so the dashboard's recent fetch is reused without a second hit.
 *   - Falls back to a direct `GET /api/cgm/latest` with a ~1.5s
 *     AbortController timeout when no cache is warm.
 *   - Swallows every error and timeout — callers always get
 *     `string | null`, never a throw.
 */

import { peekCgmHistoryCache } from "./clientCache";

const TIMEOUT_MS = 1500;

export async function getCurrentTrendArrow(): Promise<string | null> {
  // Fast path: read the shared in-memory cache *without* triggering a
  // network fetch. If the dashboard / live glucose widget already
  // populated it within the TTL, we get the trend instantly.
  try {
    const cached = peekCgmHistoryCache();
    if (cached?.current?.trend) return cached.current.trend;
  } catch {
    // fall through to direct fetch
  }

  // Slow path: explicit /api/cgm/latest call with a hard ~1.5s timeout
  // so a stalled CGM never delays the meal save.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/cgm/latest", {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: { trend?: string | null } | null };
    return data?.current?.trend ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
