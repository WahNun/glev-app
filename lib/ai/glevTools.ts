/**
 * Glev AI function-calling tools (Phase 3, Task 1 — READ-only).
 *
 * Each tool is split into a Mistral-facing *definition* (used in the
 * `tools` array of `client.chat.complete`) and a *server-side executor*
 * that runs against the authed Supabase client so RLS scopes every
 * query to the signed-in user. Raw time-series (CGM samples, full
 * insulin-log rows) never leave the server — executors return small
 * summarized strings or compact aggregate objects.
 *
 * Adding a new tool: append it to `GLEV_TOOLS` AND add a matching
 * branch in `executeGlevTool`. The two stay in sync via the
 * `GlevToolName` union.
 *
 * Write-tools (log_meal_entry, log_bolus_entry, add_timeline_check,
 * create_appointment) are intentionally *not* in this file — they
 * land in Task 2 behind a structured UI-confirmation gate. Mixing
 * read+write here would invite accidental wiring before the gate is
 * built.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHistory } from "@/lib/cgm";
import {
  buildDoses,
  calcTotalIOB,
  getDIAMinutes,
  type InsulinType,
  type InsulinLike,
  type MealLike,
} from "@/lib/iob";

// ── Tool definitions (Mistral function-calling schema) ───────────────
export const GLEV_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_glucose_status",
      description:
        "Aktueller Glukosewert + Trend (Pfeil). Nur sinnvoll wenn der Nutzer ein CGM verbunden hat. Liefert null wenn keine frische Messung vorliegt.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_active_iob",
      description:
        "Aktives IOB (Insulin on Board) in IE plus geschätzte verbleibende Wirkdauer in Minuten. Berechnet aus insulin_logs + meals.insulin_units der letzten Wirkdauer-Spanne.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_meal_history",
      description:
        "Letzte Mahlzeiten mit Kohlenhydraten, Mahlzeittyp und Zeitstempel. Default Limit 5, max 20.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Anzahl der zurückgegebenen Mahlzeiten (1-20, default 5).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_bolus_history",
      description:
        "Letzte Bolus-Insulin-Dosen aus insulin_logs (insulin_type='bolus') mit IE, Marken-Name und Zeitstempel. Default Limit 5, max 20.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Anzahl der zurückgegebenen Boli (1-20, default 5).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_appointments",
      description:
        "Alle gespeicherten Arzttermine des Nutzers (neueste zuerst). Liefert leere Liste wenn nichts gespeichert ist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export type GlevToolName =
  | "get_glucose_status"
  | "get_active_iob"
  | "get_meal_history"
  | "get_bolus_history"
  | "get_appointments";

// ── Executor ─────────────────────────────────────────────────────────

/**
 * Dispatches a tool-call coming back from Mistral. Returns a JSON-
 * serializable plain object that the route handler will stringify
 * into the `content` field of the `role: "tool"` reply message.
 *
 * Errors are caught and returned as `{ error: "..." }` payloads so
 * Mistral can phrase a graceful "I couldn't look that up" reply
 * instead of the request failing outright. Each branch is paranoid
 * about RLS / missing-table failures because PostgREST schema-cache
 * lag is a recurring source of false-empty reads in this repo.
 */
export async function executeGlevTool(
  name: string,
  rawArgs: string,
  sb: SupabaseClient,
  userId: string,
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }

  try {
    switch (name as GlevToolName) {
      case "get_glucose_status":
        return await toolGetGlucoseStatus(userId);
      case "get_active_iob":
        return await toolGetActiveIOB(sb, userId);
      case "get_meal_history":
        return await toolGetMealHistory(sb, args);
      case "get_bolus_history":
        return await toolGetBolusHistory(sb, args);
      case "get_appointments":
        return await toolGetAppointments(sb, userId);
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tool execution failed";
    return { error: msg };
  }
}

// ── Tool implementations ─────────────────────────────────────────────

async function toolGetGlucoseStatus(userId: string): Promise<unknown> {
  const out = await getHistory(userId).catch(() => null);
  const current = out?.current ?? null;
  if (!current) {
    return {
      available: false,
      hint: "Kein aktueller CGM-Wert verfügbar (CGM nicht verbunden oder keine frische Messung).",
    };
  }
  return {
    available: true,
    value: current.value,
    unit: current.unit,
    trend: current.trend ?? null,
    measuredAt: current.timestamp,
  };
}

async function toolGetActiveIOB(
  sb: SupabaseClient,
  userId: string,
): Promise<unknown> {
  // Look back over the longest plausible DIA-window (6 h = 360 min)
  // so doses that may still be active are included. The IOB-decay
  // model in `calcTotalIOB` returns 0 for anything past the window
  // anyway, so over-fetching here is safe.
  const sinceIso = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

  const [insulinRes, mealsRes, settingsRes] = await Promise.all([
    sb
      .from("insulin_logs")
      .select("id, insulin_type, insulin_name, units, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false }),
    sb
      .from("meals")
      .select("id, insulin_units, meal_time, created_at, input_text")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false }),
    sb
      .from("user_settings")
      .select("dia_minutes, insulin_type")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const insulin = (insulinRes.data ?? []) as InsulinLike[];
  const meals = (mealsRes.data ?? []) as MealLike[];
  const diaMinutes = (settingsRes.data?.dia_minutes ?? undefined) as
    | number
    | undefined;
  const rawType = settingsRes.data?.insulin_type as string | undefined;
  const insulinType: InsulinType =
    rawType === "rapid" || rawType === "regular" ? rawType : "rapid";

  const doses = buildDoses(insulin, meals);
  const iob = calcTotalIOB(doses, insulinType, Date.now(), diaMinutes);
  const effectiveDia = getDIAMinutes(insulinType, diaMinutes);

  // Time until the most-recent active dose fully decays — a useful
  // proxy for "wie lange wirkt noch was?".
  const now = Date.now();
  let minutesRemaining = 0;
  for (const d of doses) {
    const elapsedMin = (now - new Date(d.administeredAt).getTime()) / 60_000;
    if (elapsedMin < 0 || elapsedMin >= effectiveDia) continue;
    const remaining = effectiveDia - elapsedMin;
    if (remaining > minutesRemaining) minutesRemaining = remaining;
  }

  return {
    iobUnits: iob,
    minutesRemaining: Math.round(minutesRemaining),
    diaMinutes: effectiveDia,
    insulinType,
    activeDoseCount: doses.filter((d) => {
      const elapsedMin = (now - new Date(d.administeredAt).getTime()) / 60_000;
      return elapsedMin >= 0 && elapsedMin < effectiveDia;
    }).length,
  };
}

async function toolGetMealHistory(
  sb: SupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5);
  const { data, error } = await sb
    .from("meals")
    .select(
      "id, input_text, carbs_grams, protein_grams, fat_grams, meal_type, meal_time, created_at, insulin_units",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message, meals: [] };
  const meals = (data ?? []).map((m) => ({
    id: m.id as string,
    description: shorten(m.input_text as string | null, 80),
    carbs: m.carbs_grams as number | null,
    protein: m.protein_grams as number | null,
    fat: m.fat_grams as number | null,
    mealType: m.meal_type as string | null,
    insulinUnits: m.insulin_units as number | null,
    at: (m.meal_time as string | null) ?? (m.created_at as string),
  }));
  return { count: meals.length, meals };
}

async function toolGetBolusHistory(
  sb: SupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5);
  const { data, error } = await sb
    .from("insulin_logs")
    .select("id, insulin_type, insulin_name, units, created_at, notes")
    .eq("insulin_type", "bolus")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message, boluses: [] };
  const boluses = (data ?? []).map((r) => ({
    id: r.id as string,
    units: r.units as number,
    name: (r.insulin_name as string | null) ?? "Bolus",
    at: r.created_at as string,
    note: (r.notes as string | null) ?? null,
  }));
  return { count: boluses.length, boluses };
}

async function toolGetAppointments(
  sb: SupabaseClient,
  userId: string,
): Promise<unknown> {
  const { data, error } = await sb
    .from("appointments")
    .select("id, appointment_at, note")
    .eq("user_id", userId)
    .order("appointment_at", { ascending: false });

  if (error) return { error: error.message, appointments: [] };
  const appointments = (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.appointment_at as string,
    note: (r.note as string | null) ?? null,
  }));
  return { count: appointments.length, appointments };
}

// ── Helpers ──────────────────────────────────────────────────────────

function clampLimit(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, Math.round(n)));
}

function shorten(s: string | null, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}
