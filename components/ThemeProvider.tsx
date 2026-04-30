"use client";

// React context for the active theme.
//
// Most of the app does NOT need this — components style themselves
// through CSS variables (var(--surface), var(--text), etc.) which the
// pre-hydration script in app/layout.tsx already wires up via
// `<html data-theme="...">`. The provider exists for the small number of
// places that need to:
//   - render conditional UI based on the active theme (e.g. the Settings
//     theme picker showing which option is selected),
//   - feed the resolved theme into a chart library that doesn't read CSS
//     variables (e.g. inline-color recharts <Cell> values),
//   - listen for system-preference changes when choice === "system".
//
// The provider also owns the matchMedia subscription so the `system`
// option keeps tracking the OS preference live without each consumer
// having to re-implement it.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  type ResolvedTheme,
  type ThemeChoice,
  DEFAULT_RESOLVED_THEME,
  DEFAULT_THEME_CHOICE,
  applyTheme,
  readStoredChoice,
  resolveSystemTheme,
  resolveTheme,
  setTheme as persistTheme,
} from "@/lib/theme";

interface ThemeContextValue {
  /** What the user picked: dark | light | system. */
  choice: ThemeChoice;
  /** What the choice resolves to right now (system → dark|light). */
  resolved: ResolvedTheme;
  /** Persist + apply a new choice. */
  setChoice: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR / first paint: trust the pre-hydration script. We seed with the
  // defaults so the server render is stable; an effect synchronises to
  // the real cookie/localStorage value once we're on the client. The
  // visible theme on screen is already correct at this point because
  // <html data-theme> was set before React mounted.
  const [choice, setChoiceState] = useState<ThemeChoice>(DEFAULT_THEME_CHOICE);
  const [resolved, setResolved] = useState<ResolvedTheme>(DEFAULT_RESOLVED_THEME);

  // Sync state with persisted choice on mount.
  useEffect(() => {
    const stored = readStoredChoice();
    setChoiceState(stored);
    setResolved(resolveTheme(stored));
  }, []);

  // Keep `system` choice live with the OS preference.
  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next = resolveSystemTheme();
      setResolved(next);
      applyTheme(next);
    };
    // Safari < 14 used the deprecated addListener API.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    persistTheme(next);
    setChoiceState(next);
    setResolved(resolveTheme(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read + control the active theme. Falls back to defaults if used outside
 * the provider so isolated components (e.g. landing page bits) don't need
 * the provider mounted.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return {
    choice: DEFAULT_THEME_CHOICE,
    resolved: DEFAULT_RESOLVED_THEME,
    setChoice: persistTheme,
  };
}
