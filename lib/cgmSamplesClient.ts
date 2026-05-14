// Browser-side fetch helper for the continuous CGM-samples endpoint.
// Mirrors the BgReading shape used in app/(protected)/insights/page.tsx
// so callers can spread the result directly into existing reading
// arrays without remapping.

export type ContinuousReading = { v: number; t: number };

/**
 * Fetch continuous CGM readings for the current user in [fromMs, toMs).
 * Returns an empty array on any error (network, 4xx, 5xx) so the
 * caller can render its UI with whatever event-based readings it
 * already has — continuous samples are an additive enhancement.
 */
export async function fetchCgmSamples(fromMs: number, toMs: number): Promise<ContinuousReading[]> {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  const fromIso = new Date(fromMs).toISOString();
  const toIso   = new Date(toMs).toISOString();
  try {
    const res = await fetch(
      `/api/cgm/samples?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      { cache: "no-store", credentials: "include" },
    );
    if (!res.ok) return [];
    const j = await res.json() as { samples?: ContinuousReading[] };
    return Array.isArray(j?.samples) ? j.samples : [];
  } catch {
    return [];
  }
}
