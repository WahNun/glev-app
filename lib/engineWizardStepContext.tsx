"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

/**
 * Bridges the engine wizard's `stepIndex` (0 = Essen, 1 = Makros,
 * 2 = Ergebnis) into the global mobile header so the step indicator
 * renders there instead of stealing a full row of vertical space at
 * the top of the engine content area.
 *
 * The engine page calls `setStep(stepIndex)` whenever stepIndex
 * changes and `setStep(null)` on unmount so other pages don't
 * inherit a stale indicator.
 */
export interface EngineWizardStepState {
  step: number | null;
  setStep: (s: number | null) => void;
}

const EngineWizardStepContext = createContext<EngineWizardStepState | null>(null);

export function EngineWizardStepProvider({ children }: { children: ReactNode }) {
  const [step, setStepState] = useState<number | null>(null);
  const setStep = useCallback((s: number | null) => setStepState(s), []);
  // Memoize to prevent Layout (both parent and consumer) from looping.
  const value = useMemo(() => ({ step, setStep }), [step, setStep]);
  return (
    <EngineWizardStepContext.Provider value={value}>
      {children}
    </EngineWizardStepContext.Provider>
  );
}

export function useEngineWizardStep(): EngineWizardStepState {
  const ctx = useContext(EngineWizardStepContext);
  if (!ctx) return { step: null, setStep: () => {} };
  return ctx;
}
