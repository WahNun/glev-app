"use client";

// Glucose unit preference hook: "mg/dL" (default) or "mmol/L".
// Persisted to localStorage so it survives reloads without a DB round-trip.
// A future migration can promote this to profiles.glucose_unit — the hook
// interface is intentionally DB-agnostic so call-sites don't need to change.

import { useCallback, useEffect, useState } from "react";

export type GlucoseUnit = "mg/dL" | "mmol/L";

const LS_KEY = "glev_glucose_unit";
const MMOL_TO_MGDL = 18.0182;
const DEFAULT: GlucoseUnit = "mg/dL";

export function mgdlToMmol(v: number): number {
  return Math.round((v / MMOL_TO_MGDL) * 10) / 10;
}

export function mmolToMgdl(v: number): number {
  return Math.round(v * MMOL_TO_MGDL);
}

function readPref(): GlucoseUnit {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw === "mmol/L" ? "mmol/L" : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function writePref(u: GlucoseUnit): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, u);
    }
  } catch {
    /* quota / disabled */
  }
}

// Module-level cache + subscriber set so all mounted hooks share one state.
let _unit: GlucoseUnit = DEFAULT;
const _subs = new Set<(u: GlucoseUnit) => void>();

function broadcast(next: GlucoseUnit) {
  _unit = next;
  writePref(next);
  _subs.forEach(fn => fn(next));
}

export interface UseGlucoseUnitResult {
  unit: GlucoseUnit;
  setUnit: (next: GlucoseUnit) => void;
  display: (mgdl: number | null | undefined) => string;
  displayCompact: (mgdl: number | null | undefined) => string;
}

export function useGlucoseUnit(): UseGlucoseUnitResult {
  const [unit, setUnitState] = useState<GlucoseUnit>(_unit);

  useEffect(() => {
    const persisted = readPref();
    if (persisted !== _unit) broadcast(persisted);
    _subs.add(setUnitState);
    setUnitState(_unit);
    return () => { _subs.delete(setUnitState); };
  }, []);

  const setUnit = useCallback((next: GlucoseUnit) => {
    broadcast(next);
  }, []);

  const display = useCallback((mgdl: number | null | undefined): string => {
    if (mgdl == null) return "—";
    if (unit === "mmol/L") return `${mgdlToMmol(mgdl)} mmol/L`;
    return `${Math.round(mgdl)} mg/dL`;
  }, [unit]);

  const displayCompact = useCallback((mgdl: number | null | undefined): string => {
    if (mgdl == null) return "—";
    if (unit === "mmol/L") return `${mgdlToMmol(mgdl)}`;
    return `${Math.round(mgdl)}`;
  }, [unit]);

  return { unit, setUnit, display, displayCompact };
}
