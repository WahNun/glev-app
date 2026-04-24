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
      if (!res.ok) return null;
      const data = (await res.json()) as HistoryData;
      cachedData = data;
      cachedAt = Date.now();
      return data;
    } catch {
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
}
