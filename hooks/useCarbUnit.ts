"use client";

// Carb-unit selector hook: loads the user's preferred display unit
// (g / BE / KE) from `profiles.carb_unit` once on mount and exposes
// convenience helpers for converting between grams (the canonical
// storage unit) and the chosen display unit.
//
// IMPORTANT: The DB always stores `meals.carbs_grams` in grams and the
// engine math (`carbs / icr`) runs in g/IE. This hook is purely a
// presentation-layer adapter — it does NOT change anything about how
// the engine, DB, or AI parse pipeline operate.
//
// SSR-safe: no direct `window`/`document` access in the initial render.
// On servers and during the first client paint we return the default
// unit ("g") so existing/legacy users see the unchanged Gramm display
// until the profile fetch resolves.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CARB_UNITS,
  type CarbUnit,
  formatCarbs,
  formatICR,
  gToUnit,
  isCarbUnit,
  unitToG,
} from "@/lib/carbUnits";

export interface UseCarbUnitResult {
  unit: CarbUnit;
  label: string;
  step: number;
  placeholder: string;
  description: string;
  setUnit: (next: CarbUnit) => void;
  display: (grams: number | null | undefined) => string;
  toGrams: (valueInUnit: number) => number;
  fromGrams: (grams: number) => number;
  displayICR: (icrGperIE: number | null | undefined) => string;
}

const DEFAULT_UNIT: CarbUnit = "g";

// Module-level cache so list-rendered components (e.g. MealEntryCardCollapsed
// rendered N times in a list) share a single auth + profile fetch instead
// of stampeding the network on every mount. Subscribers register via
// `subscribe()` and receive the resolved unit + every subsequent setUnit.
let cachedUnit: CarbUnit = DEFAULT_UNIT;
let cachedForUid: string | null = null;
let fetchInFlight: Promise<void> | null = null;
// Monotonic version stamp — bumped on every broadcast (incl. optimistic
// setUnit). The in-flight profile fetch captures the version at start;
// if it grew during the fetch we drop the late DB value to avoid
// clobbering a fresher user toggle.
let unitVersion = 0;
const subscribers = new Set<(u: CarbUnit) => void>();

function broadcast(next: CarbUnit) {
  cachedUnit = next;
  unitVersion += 1;
  subscribers.forEach(fn => fn(next));
}

function ensureFetched(): Promise<void> {
  if (fetchInFlight) return fetchInFlight;
  if (!supabase) return Promise.resolve();
  // Capture the version at fetch-start. If a user toggle (broadcast)
  // bumps unitVersion before we resolve, the late DB value is stale by
  // construction and must NOT be applied.
  const startVersion = unitVersion;
  fetchInFlight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (!uid) {
        cachedForUid = null;
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("carb_unit")
        .eq("id", uid)
        .maybeSingle();
      cachedForUid = uid;
      if (unitVersion !== startVersion) return;
      if (isCarbUnit(profile?.carb_unit)) {
        broadcast(profile.carb_unit);
      }
    } catch {
      // Silent: a missing/inaccessible profile must never block the UI;
      // the user simply continues to see Gramm until next fetch.
    }
  })();
  return fetchInFlight;
}

// Auth-state guard: when a different user signs in (or the user signs
// out) the cached unit is no longer valid. Subscribe once at module
// scope so every hook instance benefits — guarded by `__listenerAttached`
// so HMR re-evaluation doesn't pile up duplicate listeners.
let __listenerAttached = false;
if (typeof window !== "undefined" && supabase && !__listenerAttached) {
  __listenerAttached = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const nextUid = session?.user?.id ?? null;
    if (nextUid === cachedForUid) return;
    // Identity changed — invalidate cache, drop any in-flight promise,
    // reset to the safe default, then re-fetch for the new identity.
    cachedForUid = null;
    fetchInFlight = null;
    broadcast(DEFAULT_UNIT);
    void ensureFetched();
  });
}

export function useCarbUnit(): UseCarbUnitResult {
  // Start every render in the safe default so SSR + first paint never
  // disagree with the server-rendered HTML, but if a previous mount
  // already resolved the unit (cachedUnit) reuse it immediately.
  const [unit, setUnitState] = useState<CarbUnit>(cachedUnit);

  useEffect(() => {
    // Subscribe first so any setUnit() that fires from a sibling instance
    // mid-fetch lands here too. The fetch is module-scoped and de-duped.
    subscribers.add(setUnitState);
    if (cachedUnit !== unit) setUnitState(cachedUnit);
    void ensureFetched();
    return () => {
      subscribers.delete(setUnitState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic update — broadcast to every mounted hook instance
  // immediately so the entire UI flips in one render pass, then PATCH
  // the profile row in the background. Failure is silent (same
  // rationale as the language switcher in lib/locale.ts): the user's
  // preference can re-sync on the next mount.
  const setUnit = useCallback((next: CarbUnit) => {
    broadcast(next);
    if (!supabase) return;
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) return;
        await supabase
          .from("profiles")
          .update({ carb_unit: next })
          .eq("id", uid);
      } catch {
        // Persist errors are non-fatal; the local state remains correct
        // for this session and a later setUnit() will retry.
      }
    })();
  }, []);

  // Display "60 g KH" / "5 BE" / "6 KE". Tolerates null/undefined so
  // call-sites can pipe `meal.carbs_grams ?? 0` straight in without an
  // extra guard (matches the legacy `${m.carbs_grams ?? 0}g` pattern).
  const display = useCallback(
    (grams: number | null | undefined) => formatCarbs(grams ?? 0, unit),
    [unit],
  );

  const toGrams = useCallback(
    (valueInUnit: number) => unitToG(valueInUnit, unit),
    [unit],
  );

  const fromGrams = useCallback(
    (grams: number) => gToUnit(grams, unit),
    [unit],
  );

  // Display ICR in the chosen unit (g/IE → BE/IE or KE/IE). Used in the
  // engine recommendation card so the ratio matches the user's mental
  // model. The underlying engine math still consumes the raw g/IE value.
  const displayICR = useCallback(
    (icrGperIE: number | null | undefined) =>
      formatICR(icrGperIE ?? 0, unit),
    [unit],
  );

  const config = CARB_UNITS[unit];

  return {
    unit,
    label: config.label,
    step: config.step,
    placeholder: config.placeholder,
    description: config.description,
    setUnit,
    display,
    toGrams,
    fromGrams,
    displayICR,
  };
}
