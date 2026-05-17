"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
 * Values mirror `nutritionSource` in app/(protected)/engine/page.tsx:
 *   "database"  → all macros from Open Food Facts + USDA (green)
 *   "mixed"     → DB + AI estimate blend (orange)
 *   "estimated" → pure AI estimation (pink)
 *   "unknown"   → pipeline couldn't price any ingredient (red+pulse)
 *   null        → no source recorded → hide the pill
 */
export type NutritionSource = "database" | "mixed" | "estimated" | "unknown";

export interface EngineSourceHeaderState {
  source:    NutritionSource | null;
  setSource: (s: NutritionSource | null) => void;
}

const EngineSourceHeaderContext = createContext<EngineSourceHeaderState | null>(null);

export function EngineSourceHeaderProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<NutritionSource | null>(null);
  const setSource = useCallback((s: NutritionSource | null) => setSourceState(s), []);

  return (
    <EngineSourceHeaderContext.Provider value={{ source, setSource }}>
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
    return { source: null, setSource: () => {} };
  }
  return ctx;
}
