/**
 * Pure (non-React) helpers extracted from hooks/useScreenContext so they can
 * be unit-tested without a Next.js router context or browser environment.
 *
 * The hook imports from here — no logic lives in the hook itself.
 */

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

export function trendArrow(trend: string): string {
  switch (trend) {
    case "fallingQuickly": return "↓↓";
    case "falling":        return "↓";
    case "stable":         return "→";
    case "rising":         return "↑";
    case "risingQuickly":  return "↑↑";
    default:               return "";
  }
}

export function minutesAgo(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "";
  const diffMin = Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60_000);
  if (diffMin < 1)  return "gerade eben";
  if (diffMin === 1) return "vor 1 Min";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m === 0 ? `vor ${h} h` : `vor ${h} h ${m} Min`;
}

export function pathToScreen(pathname: string): GlevScreen {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/engine"))    return "engine";
  if (pathname.startsWith("/entries"))   return "entries";
  if (pathname.startsWith("/insights"))  return "insights";
  if (pathname.startsWith("/settings"))  return "settings";
  return "unknown";
}

/**
 * Pure helper: decides which data fetches are needed for a given screen +
 * consent profile. No Supabase or React dependency — safe to unit-test.
 */
export function resolveWants(
  screen: GlevScreen,
  profile: { ai_consent_glucose_at?: unknown; ai_consent_iob_at?: unknown } | null,
): { wantsGlucose: boolean; wantsIOB: boolean; wantsMeal: boolean } {
  const glucoseConsented = Boolean(profile?.ai_consent_glucose_at);
  const iobConsented     = Boolean(profile?.ai_consent_iob_at);
  return {
    wantsGlucose: glucoseConsented && screen === "dashboard",
    wantsIOB:     iobConsented && (screen === "dashboard" || screen === "engine"),
    wantsMeal:    screen === "dashboard" || screen === "entries",
  };
}

/**
 * Pure helper: assembles a ScreenContext from the individual fetched
 * values (null → undefined). Exported for unit tests — they can call
 * this without React to verify the consent-null → undefined shape.
 */
export function buildScreenContext(
  screen: GlevScreen,
  glucoseSummary: string | null,
  iobSummary: string | null,
  lastMealSummary: string | null,
): ScreenContext {
  return {
    screen,
    glucoseSummary:  glucoseSummary  ?? undefined,
    iobSummary:      iobSummary      ?? undefined,
    lastMealSummary: lastMealSummary ?? undefined,
  };
}

export interface InsulinLogRow {
  id?: string;
  insulin_type: string;
  units: number;
  created_at: string;
  related_entry_id?: string | null;
  insulin_name?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLastMealSummary(sb: any, userId: string): Promise<string | null> {
  try {
    const { data } = await sb
      .from("meals")
      .select("input_text, carbs_grams, created_at, meal_time")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const ago   = minutesAgo((row.meal_time ?? row.created_at) as string | null);
    const carbs = row.carbs_grams != null ? ` — ${Math.round(row.carbs_grams as number)}g KH` : "";
    const text  = row.input_text
      ? ` (${(row.input_text as string).slice(0, 40)}${(row.input_text as string).length > 40 ? "…" : ""})`
      : "";
    return `${ago}${text}${carbs}`;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getIOBSummary(sb: any, userId: string): Promise<string | null> {
  try {
    const { data: settings } = await sb
      .from("user_settings")
      .select("dia_minutes, insulin_type")
      .eq("user_id", userId)
      .maybeSingle();

    const s = settings as Record<string, unknown> | null;
    const insulinType    = (s?.insulin_type as "rapid" | "regular" | "unknown") ?? "rapid";
    const userDiaMinutes = typeof s?.dia_minutes === "number" ? (s.dia_minutes as number) : undefined;
    const diaMinutes     = getDIAMinutes(insulinType, userDiaMinutes);

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

    const ago = minutesAgo((logs as InsulinLogRow[])[0].created_at);
    return `≈ ${iob.toFixed(1)} IE aktiv (letzter Bolus ${ago})`;
  } catch {
    return null;
  }
}
