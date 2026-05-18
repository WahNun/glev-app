"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { startOfDay, userTimezone } from "@/lib/utils/datetime";

/**
 * Bridges the Insights-page scope picker (Day / Week / Month / Year + ◀ ▶)
 * into the global mobile header. The /insights page registers
 * `setVisible(true)` on mount so the Layout renders the compact
 * `ScopeHeaderChip` next to the Live badge / "+" / user icon — exactly
 * where the old `Insights ▾ / Einträge ▾` dropdown used to live.
 *
 * Mirrors the pattern in `historyHeaderContext.tsx` / `engineHeaderContext.tsx`
 * so consumers always get a defensive null-fallback outside the provider
 * (unit tests, unauthenticated routes, etc.).
 */
export type ScopeMode = "day" | "week" | "month" | "year";

export interface ScopeWindow {
  startMs: number;
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
}

/** Compute the millisecond bounds of the period containing `anchor`
 *  for the given scope mode. All boundaries snap to midnight in the
 *  user's local timezone via `startOfDay`, which itself handles DST
 *  correctly. The previous-period bounds describe the immediately
 *  preceding window of the same shape (last week, last month, etc.). */
export function computeScopeWindow(mode: ScopeMode, anchor: Date): ScopeWindow {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: userTimezone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = fmt.formatToParts(anchor);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const y = Number(get("year"));
  const mo = Number(get("month"));
  const d = Number(get("day"));
  const wkdShort = get("weekday");

  const midnight = (yy: number, mm: number, dd: number): number => {
    const noonUtc = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
    return startOfDay(noonUtc).getTime();
  };

  if (mode === "day") {
    const startMs = midnight(y, mo, d);
    const endMs = midnight(y, mo, d + 1);
    const prevStartMs = midnight(y, mo, d - 1);
    return { startMs, endMs, prevStartMs, prevEndMs: startMs };
  }
  if (mode === "week") {
    // Rolling 7-day window ending at end-of-anchor-day (Lucas
    // 2026-05-17): the previous Mon–Sun calendar-week implementation
    // collapsed to "today only" every Monday 00:00, hiding all data
    // from the cards until enough days accumulated again. Rolling 7d
    // matches what the user expects from a "letzte 7 Tage"-label and
    // never goes empty on a weekday boundary. ◀ ▶ navigation moves
    // the anchor by 7 days, so the previous window is exactly the 7
    // days before that. `wkdShort` is no longer needed for week mode
    // — kept around because Month/Year still snap to calendar
    // boundaries.
    const endMs = midnight(y, mo, d + 1);          // start of tomorrow (exclusive upper bound)
    const startMs = midnight(y, mo, d + 1 - 7);    // 7 days back, inclusive
    const prevStartMs = midnight(y, mo, d + 1 - 14);
    return { startMs, endMs, prevStartMs, prevEndMs: startMs };
  }
  if (mode === "month") {
    const startMs = midnight(y, mo, 1);
    const endMs = midnight(y, mo + 1, 1);
    const prevStartMs = midnight(y, mo - 1, 1);
    return { startMs, endMs, prevStartMs, prevEndMs: startMs };
  }
  const startMs = midnight(y, 1, 1);
  const endMs = midnight(y + 1, 1, 1);
  const prevStartMs = midnight(y - 1, 1, 1);
  return { startMs, endMs, prevStartMs, prevEndMs: startMs };
}

export interface ScopeHeaderState {
  visible: boolean;
  mode:    ScopeMode;
  anchor:  Date;
  setVisible: (v: boolean) => void;
  setMode:    (m: ScopeMode) => void;
  setAnchor:  (d: Date) => void;
}

const ScopeHeaderContext = createContext<ScopeHeaderState | null>(null);

export function ScopeHeaderProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [mode, setMode]       = useState<ScopeMode>("week");
  const [anchor, setAnchor]   = useState<Date>(() => new Date());

  return (
    <ScopeHeaderContext.Provider value={{ visible, mode, anchor, setVisible, setMode, setAnchor }}>
      {children}
    </ScopeHeaderContext.Provider>
  );
}

export function useScopeHeader(): ScopeHeaderState {
  const ctx = useContext(ScopeHeaderContext);
  if (!ctx) {
    return {
      visible: false,
      mode: "week",
      anchor: new Date(),
      setVisible: () => {},
      setMode:    () => {},
      setAnchor:  () => {},
    };
  }
  return ctx;
}
