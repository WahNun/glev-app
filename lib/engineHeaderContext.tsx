"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

/**
 * Bridges the engine page's tab-strip state into the global mobile
 * header so the chevron toggle can live next to the Live badge / user
 * icon (oben rechts), instead of consuming a row of vertical real
 * estate inside the page body. The engine page registers the active
 * label + visibility on mount, and the global Layout reads `visible`
 * to decide whether to render the chevron control at all.
 */
export interface EngineHeaderState {
  visible:        boolean;
  activeLabel:    string;
  tabsExpanded:   boolean;
  setVisible:     (v: boolean) => void;
  setActiveLabel: (label: string) => void;
  toggleTabs:     () => void;
  setTabsExpanded:(v: boolean) => void;
}

const EngineHeaderContext = createContext<EngineHeaderState | null>(null);

export function EngineHeaderProvider({ children }: { children: ReactNode }) {
  const [visible,      setVisible]      = useState(false);
  const [activeLabel,  setActiveLabel]  = useState("Engine");
  const [tabsExpanded, setTabsExpanded] = useState(false);
  const toggleTabs = useCallback(() => setTabsExpanded(v => !v), []);

  // Memoize so the context object reference stays stable when primitives
  // haven't changed. Without this, Layout (which is both parent AND
  // consumer of this context) would re-render on every render of this
  // provider, triggering an infinite Layout → Provider → Layout loop.
  const value = useMemo(
    () => ({ visible, activeLabel, tabsExpanded, setVisible, setActiveLabel, toggleTabs, setTabsExpanded }),
    // setVisible / setActiveLabel / setTabsExpanded are stable useState setters;
    // toggleTabs is useCallback-stable — only the primitive fields matter.
    [visible, activeLabel, tabsExpanded, toggleTabs],
  );

  return (
    <EngineHeaderContext.Provider value={value}>
      {children}
    </EngineHeaderContext.Provider>
  );
}

export function useEngineHeader(): EngineHeaderState {
  const ctx = useContext(EngineHeaderContext);
  if (!ctx) {
    // Safe no-op fallback for routes that aren't wrapped (e.g. unit
    // tests or unauthenticated routes). Returning a stub avoids
    // throwing in any consumer rendered outside the provider.
    return {
      visible: false, activeLabel: "Engine", tabsExpanded: false,
      setVisible:     () => {},
      setActiveLabel: () => {},
      toggleTabs:     () => {},
      setTabsExpanded:() => {},
    };
  }
  return ctx;
}
