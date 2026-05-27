"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchCgmHistory } from "@/lib/cgm/clientCache";
import {
  pathToScreen,
  resolveWants,
  trendArrow,
  minutesAgo,
  getIOBSummary,
  getLastMealSummary,
} from "@/lib/screenContext";

export type { GlevScreen, ScreenContext } from "@/lib/screenContext";
export { pathToScreen, resolveWants } from "@/lib/screenContext";

async function getGlucoseSummary(): Promise<string | null> {
  try {
    const data = await fetchCgmHistory();
    if (!data?.current?.value) return null;
    const { value, timestamp, trend } = data.current;
    const arrow = trendArrow(trend ?? "");
    const ago   = minutesAgo(timestamp);
    return `${value} mg/dL${arrow ? ` ${arrow}` : ""}${ago ? `, ${ago}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * Derives the active Glev screen from the current pathname and — for
 * the Dashboard only — fetches real-time glucose, IOB and last-meal
 * data from the client-side Supabase client + CGM cache.
 *
 * Consent-gated: glucoseSummary is only populated when
 * `profiles.ai_consent_glucose_at` is set; iobSummary only when
 * `profiles.ai_consent_iob_at` is set. lastMealSummary has no toggle
 * (matches the server-side behaviour described in D-016).
 *
 * SSR-safe: all network calls run inside a useEffect.
 */
/** Refresh interval in ms — 3 minutes, paused when tab is hidden. */
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;

export function useScreenContext(): ScreenContext {
  const pathname = usePathname();
  const [context, setContext] = useState<ScreenContext>({
    screen: pathToScreen(pathname),
  });
  // Stable ref so the interval callback always sees the latest pathname
  // without needing to be recreated on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function refresh() {
      if (cancelled || !supabase) return;

      // Skip fetch when tab is hidden — saves API calls on background tabs.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const screen = pathToScreen(pathnameRef.current);

      // Settings screen never needs AI context — skip all network calls.
      if (screen === "settings" || screen === "unknown") {
        setContext({ screen });
        return;
      }

      try {
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user || cancelled) return;

        const { data: profile } = await supabase!
          .from("profiles")
          .select("ai_consent_glucose_at, ai_consent_iob_at")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        const { wantsGlucose, wantsIOB, wantsMeal } = resolveWants(
          screen,
          profile as { ai_consent_glucose_at?: unknown; ai_consent_iob_at?: unknown } | null,
        );

        const [glucoseSummary, lastMealSummary, iobSummary] = await Promise.all([
          wantsGlucose ? getGlucoseSummary()                   : Promise.resolve(null),
          wantsMeal    ? getLastMealSummary(supabase!, user.id) : Promise.resolve(null),
          wantsIOB     ? getIOBSummary(supabase!, user.id)      : Promise.resolve(null),
        ]);

        if (cancelled) return;

        setContext({
          screen,
          glucoseSummary:  glucoseSummary  ?? undefined,
          iobSummary:      iobSummary      ?? undefined,
          lastMealSummary: lastMealSummary ?? undefined,
        });
      } catch {
        if (!cancelled) setContext({ screen });
      }
    }

    // Immediate fetch on mount / navigation change.
    refresh();

    // Auto-refresh every 3 minutes, paused when hidden.
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);

    // Also refresh when the user switches back to the tab.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  // Re-run when pathname changes (new screen = fresh fetch immediately).
  // pathnameRef keeps the interval callback current without recreating it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return context;
}
