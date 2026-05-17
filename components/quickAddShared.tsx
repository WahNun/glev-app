"use client";

import { useEffect, useState } from "react";
import GlevLogo from "@/components/GlevLogo";
import {
  fetchCycleLoggingEnabled,
  CYCLE_LOGGING_CHANGED_EVENT,
} from "@/lib/cyclePrefs";
import {
  fetchUserProfile,
  cycleSurfacesAvailable,
  USER_PROFILE_CHANGED_EVENT,
  type Sex,
} from "@/lib/userProfile";

const TEXT_DIM = "var(--text-muted)";

export const QA_ICONS = {
  droplet: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </svg>
  ),
  run: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 2 13 9 19 9" />
      <polyline points="11 22 11 15 5 15" />
      <path d="M21 13a9 9 0 0 1-15 6.7" />
      <path d="M3 11a9 9 0 0 1 15-6.7" />
    </svg>
  ),
  engine: <GlevLogo size={18} color={TEXT_DIM} bg="transparent" />,
  syringe: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2l4 4" />
      <path d="M17 3l4 4-7 7-4-4z" />
      <path d="M14 7l-7 7" />
      <path d="M9 12l3 3" />
      <path d="M7 14l-4 4 2 2 4-4" />
    </svg>
  ),
  cycle: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18" />
    </svg>
  ),
  symptom: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.39 6.96H22l-6.18 4.49L18.18 22 12 17.27 5.82 22l2.36-8.55L2 8.96h7.61L12 2z" />
    </svg>
  ),
  influence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 12 12 22 2 12" />
    </svg>
  ),
  meal: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11h18" />
      <path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
      <path d="M5 11l-1 6h16l-1-6" />
    </svg>
  ),
};

export type QuickAddItemKey =
  | "open_engine"
  | "log_insulin"
  | "measure_glucose"
  | "log_activity"
  | "log_cycle"
  | "log_symptoms"
  | "log_influences";

export type QuickAddItem = {
  key: QuickAddItemKey;
  href: string;
  icon: React.ReactNode;
};

// Single source of truth for the header-"+" dropdown items. Any
// surface that wants to mirror the header menu (e.g. the Entries-page
// CTA) imports this list so the two stay in sync automatically.
// "Mahlzeit loggen" is intentionally NOT here — the Glev item already
// routes to the meal voice flow; see QuickAddMenu.tsx for the rationale.
export const QUICK_ADD_ITEMS: QuickAddItem[] = [
  { key: "open_engine",     href: "/engine?tab=engine&voice=1", icon: QA_ICONS.engine    },
  { key: "log_insulin",     href: "/engine?tab=bolus",       icon: QA_ICONS.syringe   },
  { key: "measure_glucose", href: "/engine?tab=fingerstick", icon: QA_ICONS.droplet   },
  { key: "log_activity",    href: "/engine?tab=exercise",    icon: QA_ICONS.run       },
  { key: "log_cycle",       href: "/engine?tab=cycle",       icon: QA_ICONS.cycle     },
  { key: "log_symptoms",    href: "/engine?tab=symptoms",    icon: QA_ICONS.symptom   },
  { key: "log_influences",  href: "/engine?tab=influences",  icon: QA_ICONS.influence },
];

/** Resolves which items the current user is allowed to see, applying
 *  the two-stage cycle gating (sex !== male AND cycle opt-in). Re-syncs
 *  on window events so a toggle in Settings is reflected immediately
 *  in any open header / CTA popup. */
export function useQuickAddVisibleItems(open: boolean): QuickAddItem[] {
  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [sex, setSex] = useState<Sex | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCycleLoggingEnabled()
      .then((v) => { if (!cancelled) setCycleEnabled(v); })
      .catch(() => {});
    fetchUserProfile()
      .then((p) => { if (!cancelled) setSex(p.sex); })
      .catch(() => {});
    function onCycleChange(e: Event) {
      const ce = e as CustomEvent<boolean>;
      if (typeof ce.detail === "boolean") setCycleEnabled(ce.detail);
    }
    function onProfileChange() {
      fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
    }
    if (typeof window !== "undefined") {
      window.addEventListener(CYCLE_LOGGING_CHANGED_EVENT, onCycleChange);
      window.addEventListener(USER_PROFILE_CHANGED_EVENT, onProfileChange);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(CYCLE_LOGGING_CHANGED_EVENT, onCycleChange);
        window.removeEventListener(USER_PROFILE_CHANGED_EVENT, onProfileChange);
      }
    };
  }, []);

  // Re-sync on each open so changes from another tab/device land
  // before the user makes a selection.
  useEffect(() => {
    if (!open) return;
    fetchCycleLoggingEnabled().then(setCycleEnabled).catch(() => {});
    fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
  }, [open]);

  const cycleVisible = cycleSurfacesAvailable(sex) && cycleEnabled;
  return QUICK_ADD_ITEMS.filter(
    (it) => it.key !== "log_cycle" || cycleVisible,
  );
}
