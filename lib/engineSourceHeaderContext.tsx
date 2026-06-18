"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

/**
 * Bridges the engine page's `nutritionSource` state into the global
 * mobile header so the provenance pill ("Source: Estimated" /
 * "Quelle: Datenbank ✓" / …) renders next to the brand lockup
 * instead of stealing a row of vertical space at the top of the
 * Step-2 macros card. The engine page registers the active source
 * on mount + whenever the meal parser returns a new value, and
 * clears it (setSource(null)) when leaving Step 2 or starting a
 * fresh meal so other pages don't inherit a stale pill.
 *
 * Values mirror `AggregateSource` in lib/nutrition/types.ts:
 *   "user_history"   → all items from per-user food log ("Aus deinen Logs")
 *   "open_food_facts"→ all items from Open Food Facts
 *   "usda"           → all items from USDA FoodData Central
 *   "database"       → mix of DB sources (green)
 *   "mixed"          → DB + AI estimate blend (orange)
 *   "estimated"      → pure AI estimation (pink)
 *   "unknown"        → pipeline couldn't price any ingredient (red+pulse)
 *   null             → no source recorded → hide the pill
 *
 * `historyCount` is only set when source === "user_history" and carries
 * the min occurrence count across resolved items, used for the badge text
 * "Basiert auf X vorherigen Einträgen".
 */
export type NutritionSource =
  | "database"
  | "user_history"
  | "open_food_facts"
  | "usda"
  | "mixed"
  | "estimated"
  | "unknown";

export interface EngineSourceHeaderState {
  source:       NutritionSource | null;
  historyCount: number | null;
  setSource:    (s: NutritionSource | null, historyCount?: number) => void;
}

const EngineSourceHeaderContext = createContext<EngineSourceHeaderState | null>(null);

export function EngineSourceHeaderProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<NutritionSource | null>(null);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const setSource = useCallback((s: NutritionSource | null, count?: number) => {
    setSourceState(s);
    setHistoryCount(count ?? null);
  }, []);
  // Memoize to prevent Layout (both parent and consumer) from looping.
  const value = useMemo(() => ({ source, historyCount, setSource }), [source, historyCount, setSource]);

  return (
    <EngineSourceHeaderContext.Provider value={value}>
      {children}
    </EngineSourceHeaderContext.Provider>
  );
}

export function useEngineSourceHeader(): EngineSourceHeaderState {
  const ctx = useContext(EngineSourceHeaderContext);
  if (!ctx) {
    // Safe no-op fallback for unwrapped routes (unit tests, auth
    // screens). Returning a stub avoids throwing in any consumer
    // rendered outside the provider tree.
    return { source: null, historyCount: null, setSource: () => {} };
  }
  return ctx;
}
