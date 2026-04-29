"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Bridges the /history page sub-tab state ("insights" | "entries")
 * into the global mobile header so a compact dropdown can live next
 * to the Live badge / "+" / user icon (oben rechts), instead of the
 * old in-body Insights / Einträge pill that consumed a row of
 * vertical space at the top of the screen.
 *
 * The history page registers `setVisible(true)` on mount and the
 * Layout renders the dropdown only while visible is true. The active
 * tab itself lives in this context so the header dropdown can both
 * display the current label and switch tabs in a single tap.
 *
 * Mirrors the pattern in `engineHeaderContext.ts` — same shape, same
 * defensive null-fallback for routes outside the provider.
 */
export type HistoryTab = "insights" | "entries";

export interface HistoryHeaderState {
  visible:    boolean;
  tab:        HistoryTab;
  setVisible: (v: boolean) => void;
  setTab:     (t: HistoryTab) => void;
}

const HistoryHeaderContext = createContext<HistoryHeaderState | null>(null);

export function HistoryHeaderProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [tab,     setTab]     = useState<HistoryTab>("insights");

  return (
    <HistoryHeaderContext.Provider value={{ visible, tab, setVisible, setTab }}>
      {children}
    </HistoryHeaderContext.Provider>
  );
}

export function useHistoryHeader(): HistoryHeaderState {
  const ctx = useContext(HistoryHeaderContext);
  if (!ctx) {
    // Safe no-op fallback for routes outside the provider (unit tests,
    // unauthenticated pages, etc.) — matches the engine-header
    // contract so consumers never throw on render.
    return {
      visible: false,
      tab: "insights",
      setVisible: () => {},
      setTab:     () => {},
    };
  }
  return ctx;
}
