import type { SymptomType, SeveritiesMap } from "@/lib/symptoms";

export interface SymptomLogSlice {
  occurred_at: string;
  symptom_types: SymptomType[];
  severities: SeveritiesMap;
  cgm_glucose_at_log: number | null | undefined;
}

interface SymptomStat {
  count: number;
  sevSum: number;
  glucoseSum: number;
  glucoseCount: number;
  glucoseEntries: { value: number; occurredAt: string }[];
}

export interface TopSymptomEntry {
  key: SymptomType;
  count: number;
  avgSev: number;
  avgGlucose: number | null;
  minGlucose: number | null;
  maxGlucose: number | null;
  glucoseEntries: { value: number; occurredAt: string }[];
}

/**
 * Accumulates per-symptom statistics from a set of symptom log rows,
 * then returns the top-N symptoms sorted by occurrence count.
 *
 * Key invariants (pinned by tests/unit/symStatsGlucose.test.ts):
 *  - Rows outside [windowStartMs, windowEndMs) are skipped entirely.
 *  - `cgm_glucose_at_log` is null-excluded: only `typeof value === "number"`
 *    entries increment glucoseSum / glucoseCount.
 *  - When glucoseCount === 0 (all-null or no CGM rows), avgGlucose / minGlucose
 *    / maxGlucose are all null and glucoseEntries is empty.
 *  - avgGlucose is rounded to the nearest integer via Math.round.
 *  - glucoseEntries is sorted ascending by occurredAt.
 *  - Per-symptom severity is read from the `severities` map; when missing,
 *    the row average of all present severity values is used (fallback 3).
 */
export function computeSymStats(
  logs: SymptomLogSlice[],
  windowStartMs: number,
  windowEndMs: number,
  topN = 3,
): TopSymptomEntry[] {
  const symStats: Record<string, SymptomStat> = {};

  for (const s of logs) {
    const occ = new Date(s.occurred_at).getTime();
    if (occ < windowStartMs || occ >= windowEndMs) continue;

    for (const sym of s.symptom_types || []) {
      const cur = (symStats[sym] ??= {
        count: 0,
        sevSum: 0,
        glucoseSum: 0,
        glucoseCount: 0,
        glucoseEntries: [],
      });
      cur.count += 1;

      const perSym = (s.severities ?? {})[sym];
      if (typeof perSym === "number") {
        cur.sevSum += perSym;
      } else {
        const fallbackVals: number[] = [];
        for (const v of Object.values(s.severities ?? {})) {
          if (typeof v === "number") fallbackVals.push(v);
        }
        const fallback =
          fallbackVals.length > 0
            ? fallbackVals.reduce((a, b) => a + b, 0) / fallbackVals.length
            : 3;
        cur.sevSum += fallback;
      }

      if (
        typeof s.cgm_glucose_at_log === "number" &&
        s.cgm_glucose_at_log !== null
      ) {
        cur.glucoseSum += s.cgm_glucose_at_log;
        cur.glucoseCount += 1;
        cur.glucoseEntries.push({ value: s.cgm_glucose_at_log, occurredAt: s.occurred_at });
      }
    }
  }

  return Object.entries(symStats)
    .map(([k, v]) => {
      const entries = [...v.glucoseEntries].sort((a, b) =>
        a.occurredAt.localeCompare(b.occurredAt),
      );
      const values = entries.map((e) => e.value);
      return {
        key: k as SymptomType,
        count: v.count,
        avgSev: v.sevSum / v.count,
        avgGlucose:
          v.glucoseCount > 0 ? Math.round(v.glucoseSum / v.glucoseCount) : null,
        minGlucose: values.length > 0 ? Math.min(...values) : null,
        maxGlucose: values.length > 0 ? Math.max(...values) : null,
        glucoseEntries: entries,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}
