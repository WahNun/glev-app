/**
 * Shared client-side cache for CGM history data.
 * Prevents multiple parallel LLU fetches when several components
 * (CurrentDayGlucoseCard, CgmAutoFillProvider, CgmFetchButton) mount simultaneously.
 *
 * TTL: 30 seconds (matches the existing inline cache in postMealCgmAutoFill.ts)
 */

const CACHE_TTL_MS = 30_000;

type HistoryData = {
  current: { value: number | null; unit: string; timestamp: string | null; trend: string } | null;
  history: { value: number; timestamp: string; trend: string }[];
};

let cachedData: HistoryData | null = null;
let cachedAt: number | null = null;
let inFlight: Promise<HistoryData | null> | null = null;
let lastErrorCode: string | null = null;

export function getLastCgmErrorCode(): string | null {
  return lastErrorCode;
}

export async function fetchCgmHistory(): Promise<HistoryData | null> {
  // Return fresh cache
  if (cachedData && cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }

  // Coalesce concurrent requests into one
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/cgm/history", { cache: "no-store" });
      if (!res.ok) {
        try {
          const body = await res.json() as { error_code?: string };
          lastErrorCode = body.error_code ?? null;
        } catch { lastErrorCode = null; }
        return null;
      }
      const data = (await res.json()) as HistoryData;
      lastErrorCode = null;
      cachedData = data;
      cachedAt = Date.now();
      return data;
    } catch {
      lastErrorCode = "network_error";
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function invalidateCgmCache(): void {
  cachedData = null;
  cachedAt = null;
  // Also drop any in-flight request — otherwise a refresh issued during
  // a parallel auto-refresh would still piggyback on the old (now-stale)
  // promise and silently re-populate the cache with stale data, defeating
  // the invalidation. Setting inFlight to null forces the next call to
  // start a fresh network round-trip. (Lucas 2026-05-12 follow-up: the
  // architect flagged this race after the original cache-invalidate fix.)
  inFlight = null;
}

/**
 * Non-fetching cache peek — returns the cached payload only when it is
 * still within TTL, otherwise null. Never triggers a network request.
 * Useful for callers (e.g. the meal-save trend snapshot) that must
 * never stall the UX waiting for CGM history.
 */
export function peekCgmHistoryCache(): HistoryData | null {
  if (cachedData && cachedAt && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }
  return null;
}
