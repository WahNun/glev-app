"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchCgmHistory } from "@/lib/cgm/clientCache";
import { buildDoses, calcTotalIOB, getDIAMinutes } from "@/lib/iob";

export type GlevScreen =
  | "dashboard"
  | "engine"
  | "entries"
  | "insights"
  | "settings"
  | "unknown";

export type ScreenContext = {
  screen: GlevScreen;
  glucoseSummary?: string;
  iobSummary?: string;
  lastMealSummary?: string;
};

function trendArrow(trend: string): string {
  switch (trend) {
    case "fallingQuickly": return "↓↓";
    case "falling":        return "↓";
    case "stable":         return "→";
    case "rising":         return "↑";
    case "risingQuickly":  return "↑↑";
    default:               return "";
  }
}

function minutesAgo(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "";
  const diffMin = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60_000);
  if (diffMin < 1)  return "gerade eben";
  if (diffMin === 1) return "vor 1 Min";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `vor ${h} h` : `vor ${h} h ${m} Min`;
}

function pathToScreen(pathname: string): GlevScreen {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/engine"))    return "engine";
  if (pathname.startsWith("/entries"))   return "entries";
  if (pathname.startsWith("/insights"))  return "insights";
  if (pathname.startsWith("/settings"))  return "settings";
  return "unknown";
}

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

async function getLastMealSummary(
  sb: NonNullable<typeof supabase>,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await sb
      .from("meals")
      .select("input_text, carbs_grams, created_at, meal_time")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const ago   = minutesAgo(data.meal_time ?? data.created_at);
    const carbs = data.carbs_grams != null ? ` — ${Math.round(data.carbs_grams as number)}g KH` : "";
    const text  = data.input_text
      ? ` (${(data.input_text as string).slice(0, 40)}${(data.input_text as string).length > 40 ? "…" : ""})`
      : "";
    return `${ago}${text}${carbs}`;
  } catch {
    return null;
  }
}

async function getIOBSummary(
  sb: NonNullable<typeof supabase>,
  userId: string,
): Promise<string | null> {
  try {
    const { data: settings } = await sb
      .from("user_settings")
      .select("dia_minutes, insulin_type")
      .eq("user_id", userId)
      .maybeSingle();

    const insulinType    = ((settings as Record<string, unknown> | null)?.insulin_type as "rapid" | "regular" | "unknown") ?? "rapid";
    const userDiaMinutes = typeof (settings as Record<string, unknown> | null)?.dia_minutes === "number"
      ? (settings as Record<string, unknown>).dia_minutes as number
      : undefined;
    const diaMinutes = getDIAMinutes(insulinType, userDiaMinutes);

    const cutoff = new Date(Date.now() - diaMinutes * 60_000).toISOString();
    const { data: logs } = await sb
      .from("insulin_logs")
      .select("id, insulin_type, units, created_at, related_entry_id, insulin_name")
      .eq("user_id", userId)
      .eq("insulin_type", "bolus")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false });

    if (!Array.isArray(logs) || logs.length === 0) return "Kein aktiver IOB";

    const doses = buildDoses(logs as Parameters<typeof buildDoses>[0]);
    const iob   = calcTotalIOB(doses, insulinType, Date.now(), userDiaMinutes);
    if (iob < 0.05) return "Kein aktiver IOB";

    const ago = minutesAgo((logs[0] as Record<string, unknown>).created_at as string);
    return `≈ ${iob.toFixed(1)} IE aktiv (letzter Bolus ${ago})`;
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
export function useScreenContext(): ScreenContext {
  const pathname = usePathname();
  const [context, setContext] = useState<ScreenContext>({
    screen: pathToScreen(pathname),
  });

  useEffect(() => {
    const screen = pathToScreen(pathname);

    if (screen !== "dashboard" || !supabase) {
      setContext({ screen });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: { user } } = await supabase!.auth.getUser();
        if (!user || cancelled) return;

        const { data: profile } = await supabase!
          .from("profiles")
          .select("ai_consent_glucose_at, ai_consent_iob_at")
          .eq("user_id", user.id)
          .maybeSingle();

        if (cancelled) return;

        const glucoseConsented = Boolean((profile as Record<string, unknown> | null)?.ai_consent_glucose_at);
        const iobConsented     = Boolean((profile as Record<string, unknown> | null)?.ai_consent_iob_at);

        const [glucoseSummary, lastMealSummary, iobSummary] = await Promise.all([
          glucoseConsented ? getGlucoseSummary() : Promise.resolve(null),
          getLastMealSummary(supabase!, user.id),
          iobConsented ? getIOBSummary(supabase!, user.id) : Promise.resolve(null),
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
    })();

    return () => {
      cancelled = true;
    };
  // pathname is the only external dependency; re-run on every navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return context;
}
