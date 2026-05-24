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
 * Write-tools (log_meal_entry, log_bolus_entry, log_fingerstick,
 * add_appointment, Phase 3 Task 2) führen den eigentlichen Insert NICHT
 * direkt aus. Stattdessen legt der Executor eine ai_pending_actions-
 * Zeile mit den vorgeschlagenen Parametern an und gibt
 * `{ pending_action: { token, kind, summary } }` zurück. Der Chat-Route-
 * Handler erkennt das Pattern, schickt das Pending-Action-Objekt per
 * separatem SSE-Frame an die UI, und der Nutzer bestätigt manuell per
 * Button. Erst /api/ai/confirm-action {token} führt den Write aus.
 *
 * Compliance-Prinzip (DECISIONS.md D-003 + D-017): Glev darf nie selbst
 * Dosen vorschlagen oder „autonom" loggen. Jeder Write braucht einen
 * expliziten User-Tap.
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
        "Letzte Mahlzeiten mit Kohlenhydraten, Mahlzeittyp und Zeitstempel. Default Limit 5, max 20. Bei Gewohnheits- oder Musterfragen (z. B. 'was frühstücke ich häufig', 'was esse ich meistens abends') immer limit: 20 setzen und bei tageszeit-spezifischen Fragen hour_from/hour_to nutzen.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description:
              "Anzahl der zurückgegebenen Mahlzeiten (1-20, default 5). Für Muster- und Gewohnheitsfragen immer 20 verwenden.",
          },
          hour_from: {
            type: "integer",
            minimum: 0,
            maximum: 23,
            description:
              "Optionaler Filter: nur Mahlzeiten ab dieser Stunde (Lokalzeit, 0-23). Frühstück ≈ 5, Mittagessen ≈ 11, Abendessen ≈ 17.",
          },
          hour_to: {
            type: "integer",
            minimum: 0,
            maximum: 23,
            description:
              "Optionaler Filter: nur Mahlzeiten bis zu dieser Stunde einschließlich (Lokalzeit, 0-23). Frühstück ≈ 11, Mittagessen ≈ 15, Abendessen ≈ 22.",
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
      name: "get_basal_status",
      description:
        "Aktueller Basal-Insulin-Status: letzte Basal-Dosis (IE, Marken-Name, Zeitpunkt, Stunden seither) sowie das in den Einstellungen hinterlegte Basal-Präparat. Nutze dies für Fragen wie 'wie hoch ist mein basal insulin', 'welches basal nehme ich' oder 'wann habe ich zuletzt basal gespritzt'. Anders als Bolus-IOB hat Basal ein langes, flaches Wirkprofil (Tresiba ~42 h, Lantus ~24 h) — nenne keine IOB-Zahl, sondern beschreibe die letzte Dosis.",
      parameters: { type: "object", properties: {}, required: [] },
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
  {
    type: "function" as const,
    function: {
      name: "log_meal_entry",
      description:
        "Schlägt das Speichern einer Mahlzeit vor (Mahlzeiten-Log). WICHTIG: schreibt NICHT direkt — die UI zeigt dem Nutzer einen Bestätigen-Button, erst dann landet die Zeile in der DB. Nur aufrufen, wenn der Nutzer ausdrücklich eine konkrete Mahlzeit mit konkreten Werten loggen möchte (z. B. 'Trag mir 60g Pasta Bolognese ein', 'Speicher: Apfel, 20g KH'). Niemals aufrufen, wenn der Nutzer nur eine Mahlzeit beschreibt, eine Frage stellt oder die Werte unklar sind — dann lieber nachfragen.",
      parameters: {
        type: "object",
        properties: {
          input_text: {
            type: "string",
            description:
              "Kurzer beschreibender Text der Mahlzeit, max 200 Zeichen (z. B. 'Apfel mit Erdnussbutter').",
          },
          carbs_grams: {
            type: "number",
            description: "Kohlenhydrate in Gramm (0-500). Pflichtfeld.",
          },
          protein_grams: {
            type: "number",
            description: "Optional: Eiweiß in Gramm.",
          },
          fat_grams: {
            type: "number",
            description: "Optional: Fett in Gramm.",
          },
          meal_type: {
            type: "string",
            enum: ["FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED"],
            description: "Optional: Mahlzeit-Kategorie. Default BALANCED.",
          },
        },
        required: ["input_text", "carbs_grams"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_bolus_entry",
      description:
        "Schlägt das Speichern einer Bolus-Insulin-Dosis vor (insulin_logs). WICHTIG: schreibt NICHT direkt — Bestätigung erfolgt per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine bereits gespritzte Dosis dokumentieren will ('Log 5 IE Bolus', 'Trag bitte 4 Einheiten Novorapid ein'). Niemals selbst eine Dosis vorschlagen oder berechnen — die IE-Zahl muss vom Nutzer kommen.",
      parameters: {
        type: "object",
        properties: {
          units: {
            type: "number",
            description: "Anzahl IE (0-100). Pflichtfeld.",
          },
          insulin_name: {
            type: "string",
            description:
              "Optional: Marken-/Insulin-Name (z. B. 'NovoRapid', 'Fiasp'). Default 'Bolus'.",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz.",
          },
        },
        required: ["units"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_fingerstick",
      description:
        "Schlägt das Speichern einer manuell gemessenen Blutzucker-Messung vor (fingerstick_readings). WICHTIG: schreibt NICHT direkt — Bestätigung per UI. Nur aufrufen, wenn der Nutzer explizit einen gemessenen Wert dokumentieren will ('Trag 145 ein', 'Hab gerade 7.2 mmol gemessen, speicher das'). Bei mmol/L vorher in mg/dL umrechnen (mmol × 18).",
      parameters: {
        type: "object",
        properties: {
          value_mg_dl: {
            type: "number",
            description:
              "Blutzuckerwert in mg/dL (20-600). Pflichtfeld. Bei mmol/L vorher × 18 rechnen.",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz.",
          },
        },
        required: ["value_mg_dl"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_appointment",
      description:
        "Schlägt das Speichern eines Arzttermins vor (appointments). WICHTIG: schreibt NICHT direkt — Bestätigung per UI. Das Datum kommt als YYYY-MM-DD (kein Zeitpunkt). Relative Angaben ('nächsten Dienstag') auf das absolute Datum umrechnen — heutiges Datum steht im Kontext-Preamble.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "Datum als YYYY-MM-DD (z. B. '2026-06-15'). Pflichtfeld.",
          },
          note: {
            type: "string",
            description:
              "Optional: kurzes Label (z. B. 'Endo Q2', 'Diabetologe Müller').",
          },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_timeline_check",
      description:
        "Schlägt das Anlegen eines Post-Bolus-Checkpunkts für eine Mahlzeit vor (meal_timeline_checks). WICHTIG: schreibt NICHT direkt — Bestätigung per UI-Button. Nur aufrufen, wenn der Nutzer explizit einen Erinnerungszeitpunkt für eine bestimmte Mahlzeit plant ('erinner mich in 90 Minuten', 'setz Post-Check für die Pasta auf 14:30'). Die meal_id MUSS aus einem vorherigen get_meal_history-Ergebnis stammen — niemals raten oder erfinden. planned_at als ISO-8601-Datetime (z. B. '2026-05-24T14:30:00') — relative Angaben ('in 90 Minuten') auf die absolute Zeit umrechnen, heutiges Datum + Uhrzeit stehen im Kontext-Preamble.",
      parameters: {
        type: "object",
        properties: {
          meal_id: {
            type: "string",
            description:
              "UUID der Mahlzeit, für die der Check geplant wird. Muss aus get_meal_history stammen — niemals raten.",
          },
          meal_label: {
            type: "string",
            description:
              "Kurze Beschreibung der Mahlzeit für die Bestätigungs-Zusammenfassung (z. B. 'Pasta Bolognese'). Max 80 Zeichen.",
          },
          check_type: {
            type: "string",
            description:
              "Art des Checks: 'pre' für Prä-Bolus, 'post_1' für erster Post-Bolus-Check, 'post_2' für zweiten usw. Format: 'pre' oder 'post_N' (N = positive Ganzzahl).",
          },
          planned_at: {
            type: "string",
            description:
              "Geplanter Checkzeitpunkt als ISO-8601-Datetime (z. B. '2026-05-24T14:30:00'). Relative Angaben immer in absoluten Zeitpunkt umrechnen.",
          },
        },
        required: ["meal_id", "check_type", "planned_at"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_user_observation",
      description:
        "Speichert eine persönliche Beobachtung über den Nutzer dauerhaft als Key/Value, damit du sie in späteren Sessions ohne erneutes Nachfragen kennst. Nur aufrufen, wenn der Nutzer ein echtes, persönliches Muster, eine Reaktion oder eine Gewohnheit teilt (z. B. 'Bei mir wirkt Pizza erst nach 1,5 h', 'Mein Frühstück ist meistens Haferflocken mit Joghurt'). NICHT bei allgemeinen Wissensfragen, einmaligen Werten oder Small-Talk aufrufen. Key in snake_case, kurz und beschreibend (z. B. pizza_reaction, typical_breakfast, dawn_phenomenon). Beim erneuten Speichern desselben Keys wird der alte Value überschrieben.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "Stabiler snake_case-Identifier für diese Beobachtung (max 64 Zeichen). Wähle Keys, die du auch bei zukünftigen Sessions für dasselbe Thema wiederverwenden würdest.",
          },
          value: {
            type: "string",
            description:
              "Die Beobachtung in ein bis zwei Sätzen, formuliert wie eine Notiz an dich selbst (max 500 Zeichen).",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to",
      description:
        "Navigiert den Nutzer zu einem bestimmten Screen in der App. Aufrufen, wenn der Nutzer explizit darum bittet (z. B. 'Zeig mir das Dashboard', 'Geh zu den Einstellungen', 'Öffne Insights'). Nicht proaktiv aufrufen.",
      parameters: {
        type: "object",
        properties: {
          screen: {
            type: "string",
            enum: ["dashboard", "entries", "engine", "insights", "settings"],
            description:
              "Ziel-Screen: 'dashboard' (Übersicht), 'entries' (Mahlzeiten/Einträge), 'engine' (Glev Engine KI-Empfehlungen), 'insights' (Auswertungen), 'settings' (Einstellungen).",
          },
        },
        required: ["screen"],
      },
    },
  },
];

export type GlevToolName =
  | "get_glucose_status"
  | "get_active_iob"
  | "get_meal_history"
  | "get_bolus_history"
  | "get_basal_status"
  | "get_appointments"
  | "save_user_observation"
  | "log_meal_entry"
  | "log_bolus_entry"
  | "log_fingerstick"
  | "add_appointment"
  | "add_timeline_check"
  | "navigate_to";

/**
 * Marker shape returned by every WRITE-tool. The chat-route handler
 * sniffs for this and (a) emits the pending-action payload to the UI
 * via a separate SSE frame, (b) reduces the tool reply that goes back
 * to Mistral to a short "awaiting user confirmation" stub so the model
 * doesn't try to confirm itself or call more write tools in the same
 * round.
 */
export type PendingActionEnvelope = {
  pending_action: {
    token: string;
    kind: GlevToolName;
    summary: string;
  };
};

/**
 * Marker shape returned by navigate_to. The chat-route emits a
 * dedicated SSE frame; the client reads it and calls router.push.
 */
export type NavigateEnvelope = { navigate: string };

export function isNavigateEnvelope(v: unknown): v is NavigateEnvelope {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).navigate === "string"
  );
}

export function isPendingActionEnvelope(v: unknown): v is PendingActionEnvelope {
  if (!v || typeof v !== "object") return false;
  const pa = (v as { pending_action?: unknown }).pending_action;
  if (!pa || typeof pa !== "object") return false;
  const o = pa as Record<string, unknown>;
  return (
    typeof o.token === "string" &&
    typeof o.kind === "string" &&
    typeof o.summary === "string"
  );
}

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
  userTimezone: string | null,
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
        return await toolGetMealHistory(sb, args, userTimezone);
      case "get_bolus_history":
        return await toolGetBolusHistory(sb, args, userTimezone);
      case "get_basal_status":
        return await toolGetBasalStatus(sb, userId, userTimezone);
      case "get_appointments":
        return await toolGetAppointments(sb, userId);
      case "save_user_observation":
        return await toolSaveUserObservation(sb, userId, args);
      case "log_meal_entry":
        return await toolLogMealEntry(sb, userId, args);
      case "log_bolus_entry":
        return await toolLogBolusEntry(sb, userId, args);
      case "log_fingerstick":
        return await toolLogFingerstick(sb, userId, args);
      case "add_appointment":
        return await toolAddAppointment(sb, userId, args);
      case "add_timeline_check":
        return await toolAddTimelineCheck(sb, userId, args, userTimezone);
      case "navigate_to": {
        const screenMap: Record<string, string> = {
          dashboard: "/dashboard",
          entries: "/entries",
          engine: "/engine",
          insights: "/insights",
          settings: "/settings",
        };
        const screen = typeof args.screen === "string" ? args.screen : "";
        const path = screenMap[screen];
        if (!path) return { error: `unknown screen: ${screen}` };
        return { navigate: path } satisfies NavigateEnvelope;
      }
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
  userTimezone: string | null,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5);
  const hourFrom =
    typeof args.hour_from === "number" ? Math.floor(args.hour_from) : null;
  const hourTo =
    typeof args.hour_to === "number" ? Math.floor(args.hour_to) : null;

  // Fetch a larger set when an hour filter is active so we have enough
  // rows to filter down to `limit` entries. Cap at 200 to avoid blowing
  // the context budget.
  const fetchLimit =
    hourFrom !== null || hourTo !== null ? Math.min(limit * 10, 200) : limit;

  const { data, error } = await sb
    .from("meals")
    .select(
      "id, input_text, parsed_json, carbs_grams, protein_grams, fat_grams, meal_type, meal_time, created_at, insulin_units",
    )
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) return { error: error.message, meals: [] };

  const tz =
    userTimezone && isValidTimezone(userTimezone)
      ? userTimezone
      : "Europe/Berlin";

  let rows = (data ?? []) as Array<Record<string, unknown>>;

  // Apply hour-of-day filter in local time when hour_from / hour_to are set.
  if (hourFrom !== null || hourTo !== null) {
    rows = rows.filter((m) => {
      const atIso = (m.meal_time as string | null) ?? (m.created_at as string);
      const localHour = new Date(atIso).toLocaleString("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      });
      const h = parseInt(localHour, 10);
      if (hourFrom !== null && h < hourFrom) return false;
      if (hourTo !== null && h > hourTo) return false;
      return true;
    });
  }

  // Respect the original limit after filtering.
  rows = rows.slice(0, limit);

  const meals = rows.map((m) => {
    const atIso = (m.meal_time as string | null) ?? (m.created_at as string);
    const atMs = new Date(atIso).getTime();
    return {
      id: m.id as string,
      description: resolveMealDescription(
        m.input_text as string | null,
        m.parsed_json as Array<{ name?: string }> | null,
      ),
      carbs: m.carbs_grams as number | null,
      protein: m.protein_grams as number | null,
      fat: m.fat_grams as number | null,
      mealType: m.meal_type as string | null,
      insulinUnits: m.insulin_units as number | null,
      // Lokal formatierter String — Mistral zeigt diesen direkt dem User.
      // Meal-Einträge können mehrere Tage alt sein, daher dateTime statt
      // nur Uhrzeit.
      at: formatInUserTimezone(atMs, userTimezone).dateTime,
    };
  });
  return { count: meals.length, meals };
}

/**
 * Resolve a human-readable meal description for the AI.
 *
 * Priority order:
 *  1. `input_text` (the raw user input, e.g. "Pasta mit Tomatensoße")
 *     — most natural phrasing, capped at 160 chars.
 *  2. Fallback: join the first 4 food names from `parsed_json` (e.g.
 *     image-only entries or voice-entries that bypass input_text) into
 *     "Pasta, Tomatensoße, Parmesan, Basilikum".
 *  3. `null` only if both sources are empty — never invent a label.
 *
 * The 160-char cap is comfortably above the typical "Pasta mit
 * Tomatensoße" phrasing but still short enough that 5–20 meals fit in
 * Mistral's context budget without truncating the rest of the payload.
 */
function resolveMealDescription(
  inputText: string | null,
  parsedJson: Array<{ name?: string }> | null,
): string | null {
  const fromInput = shorten(inputText, 160);
  if (fromInput) return fromInput;

  if (Array.isArray(parsedJson) && parsedJson.length > 0) {
    const names = parsedJson
      .map((f) => (typeof f?.name === "string" ? f.name.trim() : ""))
      .filter((n) => n.length > 0)
      .slice(0, 4);
    if (names.length > 0) return shorten(names.join(", "), 160);
  }

  return null;
}

async function toolGetBolusHistory(
  sb: SupabaseClient,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const limit = clampLimit(args.limit, 5);
  const { data, error } = await sb
    .from("insulin_logs")
    .select("id, insulin_type, insulin_name, units, created_at, notes")
    .eq("insulin_type", "bolus")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message, boluses: [] };
  const boluses = (data ?? []).map((r) => {
    const atMs = new Date(r.created_at as string).getTime();
    return {
      id: r.id as string,
      units: r.units as number,
      name: (r.insulin_name as string | null) ?? "Bolus",
      // Lokal formatierter String (Device-TZ); kann Tage alt sein
      // → dateTime statt nur Uhrzeit.
      at: formatInUserTimezone(atMs, userTimezone).dateTime,
      note: (r.notes as string | null) ?? null,
    };
  });
  return { count: boluses.length, boluses };
}

async function toolGetBasalStatus(
  sb: SupabaseClient,
  userId: string,
  userTimezone: string | null,
): Promise<unknown> {
  // Look back 72 h — covers the longest plausible basal interval
  // (Tresiba is once-daily, Lantus split is usually 12 h, but
  // missed doses or shift workers can stretch beyond 24 h).
  const sinceIso = new Date(Date.now() - 72 * 60 * 60_000).toISOString();

  const [lastBasalRes, settingsRes] = await Promise.all([
    sb
      .from("insulin_logs")
      .select("id, units, insulin_name, created_at, notes")
      .eq("user_id", userId)
      .eq("insulin_type", "basal")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("user_settings")
      .select("insulin_brand_basal, basal_action_window_h")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const configuredBrand =
    (settingsRes.data?.insulin_brand_basal as string | null) ?? null;
  const actionWindowH =
    (settingsRes.data?.basal_action_window_h as number | null) ?? null;

  const last = lastBasalRes.data;
  if (!last) {
    return {
      available: false,
      configuredBrand,
      actionWindowHours: actionWindowH,
      hint: "Keine Basal-Dosis in den letzten 72 h gefunden.",
    };
  }

  const atMs = new Date(last.created_at as string).getTime();
  const hoursSince = (Date.now() - atMs) / (60 * 60_000);
  const formatted = formatInUserTimezone(atMs, userTimezone);

  return {
    available: true,
    lastDose: {
      units: last.units as number,
      name: (last.insulin_name as string | null) ?? configuredBrand ?? "Basal",
      // Lokal formatierte Strings (Berlin-Default) — direkt anzeigbar.
      // Kein roher UTC-ISO mehr, kein timezone-Suffix.
      at: formatted.dateTime,
      localTime: formatted.timeOnly,
      hoursSince: Math.round(hoursSince * 10) / 10,
      note: (last.notes as string | null) ?? null,
    },
    configuredBrand,
    actionWindowHours: actionWindowH,
  };
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

/**
 * Upsert a personal observation about the user into `ai_user_memory`.
 *
 * Key/Value-Längenlimits sind bewusst eng (key ≤ 64, value ≤ 500), damit
 * der Memory-Block beim späteren Injizieren in den System-Prompt nicht
 * unbegrenzt wächst — der Prompt-Budget-Schutz lebt also schon hier am
 * Eingang und nicht erst beim Load.
 *
 * Fehler werden als `{ ok: false, error }` zurückgegeben (kein throw),
 * damit Mistral gracefully reagieren kann („Konnte mir das gerade nicht
 * merken").
 */
async function toolSaveUserObservation(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const rawKey = typeof args.key === "string" ? args.key.trim() : "";
  const rawValue = typeof args.value === "string" ? args.value.trim() : "";

  if (!rawKey) {
    return { ok: false, error: "key is required (non-empty string)." };
  }
  if (!rawValue) {
    return { ok: false, error: "value is required (non-empty string)." };
  }
  if (rawKey.length > 64) {
    return { ok: false, error: "key too long (max 64 chars)." };
  }
  if (rawValue.length > 500) {
    return { ok: false, error: "value too long (max 500 chars)." };
  }

  const { error } = await sb
    .from("ai_user_memory")
    .upsert(
      {
        user_id: userId,
        key: rawKey,
        value: rawValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, key: rawKey };
}

// ── WRITE-tools (UI-confirmation gate, Phase 3 Task 2) ──────────────
//
// Jede WRITE-Funktion validiert die vom Modell vorgeschlagenen Args,
// baut eine kompakte deutsche `summary` für die UI-Bubble, legt eine
// ai_pending_actions-Zeile an und gibt den Token zurück. Der eigentliche
// Insert in meals/insulin_logs/fingerstick_readings/appointments
// passiert erst in /api/ai/confirm-action nach manuellem User-Tap.
//
// Validierungs-Fehler geben `{ error: "…" }` zurück (kein throw), damit
// Mistral gracefully eine Klärung formulieren kann statt der Request
// hart fehlzuschlagen.

const PENDING_TTL_MS = 5 * 60_000;

async function createPendingAction(
  sb: SupabaseClient,
  userId: string,
  kind: GlevToolName,
  params: Record<string, unknown>,
  summary: string,
): Promise<PendingActionEnvelope | { error: string }> {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  const { data, error } = await sb
    .from("ai_pending_actions")
    .insert({
      user_id: userId,
      kind,
      params,
      summary,
      expires_at: expiresAt,
    })
    .select("token")
    .single();
  if (error || !data?.token) {
    return { error: error?.message ?? "Konnte Aktion nicht vorbereiten." };
  }
  return {
    pending_action: {
      token: data.token as string,
      kind,
      summary,
    },
  };
}

async function toolLogMealEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const inputText =
    typeof args.input_text === "string" ? args.input_text.trim().slice(0, 200) : "";
  const carbs = Number(args.carbs_grams);
  if (!inputText) return { error: "input_text fehlt" };
  if (!Number.isFinite(carbs) || carbs < 0 || carbs > 500) {
    return { error: "carbs_grams ungültig (0-500 erwartet)" };
  }
  const protein =
    Number.isFinite(Number(args.protein_grams)) && args.protein_grams !== undefined
      ? Number(args.protein_grams)
      : null;
  const fat =
    Number.isFinite(Number(args.fat_grams)) && args.fat_grams !== undefined
      ? Number(args.fat_grams)
      : null;
  const allowedTypes = ["FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED"];
  const mealType =
    typeof args.meal_type === "string" && allowedTypes.includes(args.meal_type)
      ? args.meal_type
      : "BALANCED";

  const params = {
    input_text: inputText,
    carbs_grams: carbs,
    protein_grams: protein,
    fat_grams: fat,
    meal_type: mealType,
  };
  const macroBits: string[] = [`${carbs}g KH`];
  if (protein !== null) macroBits.push(`${protein}g Eiweiß`);
  if (fat !== null) macroBits.push(`${fat}g Fett`);
  const summary = `Mahlzeit: ${inputText} (${macroBits.join(", ")})`;

  return await createPendingAction(sb, userId, "log_meal_entry", params, summary);
}

async function toolLogBolusEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const units = Number(args.units);
  if (!Number.isFinite(units) || units <= 0 || units > 100) {
    return { error: "units ungültig (0-100 IE erwartet)" };
  }
  const insulinName =
    typeof args.insulin_name === "string" && args.insulin_name.trim()
      ? args.insulin_name.trim().slice(0, 60)
      : "Bolus";
  const notes =
    typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim().slice(0, 200)
      : null;

  const params = {
    units,
    insulin_name: insulinName,
    notes,
  };
  const summary = `Bolus: ${units} IE ${insulinName}${notes ? ` (${notes})` : ""}`;

  return await createPendingAction(sb, userId, "log_bolus_entry", params, summary);
}

async function toolLogFingerstick(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const value = Number(args.value_mg_dl);
  if (!Number.isFinite(value) || value < 20 || value > 600) {
    return { error: "value_mg_dl ungültig (20-600 mg/dL erwartet)" };
  }
  const notes =
    typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim().slice(0, 200)
      : null;

  const params = {
    value_mg_dl: Math.round(value),
    notes,
  };
  const summary = `Fingerstick: ${Math.round(value)} mg/dL${notes ? ` (${notes})` : ""}`;

  return await createPendingAction(sb, userId, "log_fingerstick", params, summary);
}

async function toolAddTimelineCheck(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const mealId = typeof args.meal_id === "string" ? args.meal_id.trim() : "";
  if (!mealId) return { error: "meal_id fehlt — muss aus get_meal_history stammen" };

  const checkType = typeof args.check_type === "string" ? args.check_type.trim() : "";
  if (!/^(pre|post_\d+)$/.test(checkType)) {
    return { error: "check_type ungültig — erwartet 'pre' oder 'post_N' (z. B. 'post_1')" };
  }

  const plannedAtRaw = typeof args.planned_at === "string" ? args.planned_at.trim() : "";
  if (!plannedAtRaw) return { error: "planned_at fehlt (ISO-Datetime erwartet)" };
  const plannedMs = new Date(plannedAtRaw).getTime();
  if (!Number.isFinite(plannedMs)) {
    return { error: "planned_at ist kein gültiger Zeitpunkt (ISO-Datetime erwartet)" };
  }

  const mealLabel =
    typeof args.meal_label === "string" && args.meal_label.trim()
      ? args.meal_label.trim().slice(0, 80)
      : "Mahlzeit";

  // Verify the meal actually belongs to this user (RLS on SELECT confirms ownership).
  const { data: mealRow, error: mealErr } = await sb
    .from("meals")
    .select("id")
    .eq("id", mealId)
    .maybeSingle();
  if (mealErr || !mealRow) {
    return { error: "Mahlzeit nicht gefunden — meal_id muss aus get_meal_history stammen" };
  }

  const formatted = formatInUserTimezone(plannedMs, userTimezone);
  const typeLabel = checkType === "pre" ? "Prä-Check" : `Post-Check (${checkType.replace("_", " ")})`;
  const summary = `${typeLabel} für „${mealLabel}" um ${formatted.timeOnly} anlegen`;

  const params = {
    meal_id: mealId,
    meal_label: mealLabel,
    check_type: checkType,
    planned_at: new Date(plannedMs).toISOString(),
  };

  return await createPendingAction(sb, userId, "add_timeline_check", params, summary);
}

async function toolAddAppointment(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const date = typeof args.date === "string" ? args.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date ungültig (YYYY-MM-DD erwartet)" };
  }
  // Regex lets through semantically invalid dates like 2026-99-99 oder
  // 2026-02-31. Round-trip through Date and compare to catch them
  // before they hit the appointments-table INSERT and produce a generic
  // 500 the user has no chance to recover from.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    return { error: "date ist kein gültiges Kalenderdatum" };
  }
  const note =
    typeof args.note === "string" && args.note.trim()
      ? args.note.trim().slice(0, 120)
      : null;

  const params = { date, note };
  const summary = `Termin: ${date}${note ? ` — ${note}` : ""}`;

  return await createPendingAction(sb, userId, "add_appointment", params, summary);
}

// ── Helpers ──────────────────────────────────────────────────────────

function clampLimit(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(20, Math.round(n)));
}

/**
 * Format a UTC timestamp in the user's local timezone, ready for direct
 * AI/user display. Returns two views so Mistral can pick the right one
 * for the answer:
 *  - `timeOnly`  e.g. "23:02 Uhr"           → for same-day phrasing
 *  - `dateTime`  e.g. "23.05., 23:02 Uhr"   → for cross-day phrasing
 *
 * `userTimezone` kommt vom Client (Intl.DateTimeFormat().resolvedOptions()
 * .timeZone) bei jeder Anfrage frisch mit — single source of truth, weil
 * Nutzer reisen und ein DB-gespeicherter Wert dann veraltet ist.
 * Fallback `Europe/Berlin` greift nur, wenn der Client nichts schickt
 * oder der String keine gültige IANA-TZ ist (Primärzielgruppe ist
 * deutschsprachig, kein unerwarteter UTC-Shift im Chat).
 * Kein `zoneLabel` mehr im Output — Mistral soll die Uhrzeit ohne
 * Zeitzonen-Suffix zeigen (die App selbst rechnet ja auch in Lokalzeit).
 */
function formatInUserTimezone(
  atMs: number,
  userTimezone: string | null,
): { timeOnly: string; dateTime: string } {
  const tz =
    userTimezone && isValidTimezone(userTimezone)
      ? userTimezone
      : "Europe/Berlin";
  const d = new Date(atMs);
  const hhmm = d.toLocaleTimeString("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
  const datePart = d.toLocaleDateString("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  });
  return {
    timeOnly: `${hhmm} Uhr`,
    dateTime: `${datePart}, ${hhmm} Uhr`,
  };
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function shorten(s: string | null, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}
