// TODO(voice-control): When app-wide voice control is added, intent-routing belongs here.
// This file owns the tool schema + executors that produce structured actions from AI responses.
// A future voice intent layer would classify the user's spoken input into one of the planned
// intent types (log_bolus, log_meal, log_exercise, log_symptom, edit_macro) and map it onto
// the appropriate tool call here — bypassing the free-text chat path for common quick-log intents.
// All write-tool calls MUST still go through the Confirmation-Gate (no auto-save; see D-003).
// See docs/VOICE_ARCHITECTURE.md for the full design.

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
import { aggregateNutrition } from "@/lib/nutrition/aggregate";
import { getCachedUserHistory } from "@/lib/nutrition/userHistoryCache";
import type { ParsedFoodItem } from "@/lib/nutrition/types";

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
      name: "get_check_history",
      description:
        "Letzte Post-Bolus-Checks aus meal_timeline_checks, die bereits einen gemessenen BZ-Wert (bg_at_check) haben. Nutze dies für Fragen wie 'wie war mein BZ nach dem Frühstück', 'zeig meine letzten Post-Bolus-Ergebnisse' oder 'wie gut treffe ich meinen Zielbereich nach dem Essen'. Liefert zu jedem Check: Mahlzeitbeschreibung, Check-Typ (pre/post_1/…), geplanten Zeitpunkt und gemessenen BZ-Wert. Default Limit 10, max 20.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Anzahl der zurückgegebenen Checks (1-20, default 10).",
          },
          check_type: {
            type: "string",
            description:
              "Optional: Filter auf bestimmten Check-Typ ('pre', 'post_1', 'post_2', …). Ohne Filter werden alle Typen zurückgegeben.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_meal_entry",
      description:
        "Öffnet den Mahlzeit-Eingabe-Screen und füllt die Makros vor. WICHTIG: speichert NICHT direkt — der Nutzer bestätigt per UI-Button. Aufrufen, wenn der Nutzer eine Mahlzeit beschreibt oder loggen möchte. Bei unklaren Werten schätze die Makros nach bestem Wissen. Niemals aufrufen bei reinen Fragen oder beim set_macro-Einsatz. PFLICHT: items[] muss immer geliefert werden — eine Zeile pro Zutat/Komponente (NIE die gesamte Mahlzeit als ein Block). Beispiel: 'Hähnchen mit Reis' → [{name:'Hähnchenbrust',grams:180},{name:'Basmatireis',grams:150}].",
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
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt der Mahlzeit als ISO-8601-String (z. B. '2026-06-04T10:30:00'). Wenn der Nutzer eine Uhrzeit nennt oder die Mahlzeit in der Vergangenheit liegt, hier eintragen; sonst weglassen — das System verwendet dann den aktuellen Zeitpunkt.",
          },
          items: {
            type: "array",
            description:
              "PFLICHT: Eine Zeile pro Zutat/Komponente. NIE die gesamte Mahlzeit als ein Item. Beispiele: 'Hähnchen mit Reis und Salat' → [{name:'Hähnchenbrust',grams:180},{name:'Basmatireis',grams:150},{name:'Salat',grams:80}]. 'Croissant' → [{name:'Croissant',grams:70}]. Gramm = Schätzung typischer Portionsgröße.",
            items: {
              type: "object",
              properties: {
                name:  { type: "string",  description: "Name der Zutat/Komponente (Deutsch oder Englisch)." },
                grams: { type: "number",  description: "Menge in Gramm." },
              },
              required: ["name", "grams"],
            },
          },
        },
        required: ["input_text", "carbs_grams", "items"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_bolus_entry",
      description:
        "Schlägt das Speichern einer schnell-wirkenden (Bolus-)Insulin-Dosis vor — z. B. NovoRapid, Fiasp, Humalog, Apidra (insulin_logs). WICHTIG: schreibt NICHT direkt — Bestätigung erfolgt per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine bereits gespritzte Dosis dokumentieren will ('Log 5 IE Bolus', 'Trag bitte 4 Einheiten Novorapid ein'). Niemals selbst eine Dosis vorschlagen oder berechnen — die IE-Zahl muss vom Nutzer kommen. Für lang-wirkende Insuline (Tresiba, Lantus, Toujeo, Levemir, Degludec) stattdessen log_basal_entry verwenden.",
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
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt der Injektion als ISO-8601-String (z. B. '2026-06-03T22:30:00'). Wenn der Nutzer eine Uhrzeit nennt, hier eintragen; sonst weglassen — das System verwendet dann den aktuellen Zeitpunkt.",
          },
        },
        required: ["units"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_basal_entry",
      description:
        "Schlägt das Speichern einer lang-wirkenden (Basal-)Insulin-Dosis vor — z. B. Tresiba, Lantus, Toujeo, Levemir, Degludec (insulin_logs). WICHTIG: schreibt NICHT direkt — Bestätigung erfolgt per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine bereits gespritzte Dosis dokumentieren will ('Log 20 IE Tresiba', '12 Einheiten Lantus gespritzt'). Niemals selbst eine Dosis vorschlagen oder berechnen — die IE-Zahl muss vom Nutzer kommen. Für schnell-wirkende Insuline (NovoRapid, Fiasp, Humalog, Apidra) stattdessen log_bolus_entry verwenden.",
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
              "Optional: Marken-/Insulin-Name (z. B. 'Tresiba', 'Lantus'). Default 'Basal'.",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz.",
          },
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt der Injektion als ISO-8601-String (z. B. '2026-06-03T22:30:00'). Wenn der Nutzer eine Uhrzeit nennt, hier eintragen; sonst weglassen — das System verwendet dann den aktuellen Zeitpunkt.",
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
      name: "set_macro",
      description:
        "Korrigiert einen einzelnen Makronährstoff-Wert auf dem aktiven Mahlzeit-Eingabe-Screen (Engine Step 2 — Macros bearbeiten). Nur aufrufen, wenn der Nutzer explizit einen Wert korrigiert ('80g Fett nicht 60', 'Kohlenhydrate auf 45'). Der Screen muss bereits offen sein; sonst navigate_to('engine') zuerst. Das Schreiben in die DB erfolgt weiterhin durch den Nutzer über den bestehenden Speichern-Button — dieses Tool ändert nur den lokalen Formularwert.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["carbs", "protein", "fat", "calories"],
            description: "Das Makro-Feld das gesetzt werden soll.",
          },
          value: {
            type: "number",
            description: "Neuer Wert in Gramm (für carbs/protein/fat) oder kcal (für calories). Muss ≥ 0 sein.",
          },
        },
        required: ["field", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_glucose_history",
      description:
        "Historische Glukosewerte für einen Zeitraum als Aggregat (Durchschnitt, Min, Max, Time-in-Range). Nutze für Fragen wie 'wie war mein BZ heute Morgen', 'was war mein Durchschnitt gestern', 'wie oft war ich heute zu hoch/zu niedrig'. Für den aktuellen Wert lieber get_glucose_status nutzen — das ist schneller.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["last_hour", "last_3h", "last_6h", "today", "yesterday", "last_7_days"],
            description:
              "'last_hour' / 'last_3h' / 'last_6h' für kurze Rückblicke; 'today' für den heutigen Tag ab Mitternacht; 'yesterday' für gestern; 'last_7_days' für den 7-Tage-Durchschnitt.",
          },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_setting",
      description:
        "Ändert eine App-Einstellung per Sprachbefehl (ICR, Zielbereich, Korrekturfaktor, Kohlenhydrat-Einheit). WICHTIG: schreibt NICHT direkt — Nutzer bestätigt per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine Einstellung ändern möchte ('stell ICR auf 1:10', 'Zielbereich 80 bis 140', 'Korrekturfaktor 2'). Bei reinen Abfragen ('was ist mein ICR?') stattdessen die Kontext-Daten aus dem System-Prompt nutzen.",
      parameters: {
        type: "object",
        properties: {
          setting: {
            type: "string",
            enum: ["icr", "target_low_mg_dl", "target_high_mg_dl", "correction_factor", "carb_unit", "dia_minutes"],
            description:
              "'icr' = Insulin-Kohlenhydrat-Verhältnis (z. B. 10 für 1:10); 'target_low_mg_dl' / 'target_high_mg_dl' = Zielbereich Untere/Obere Grenze in mg/dL; 'correction_factor' = Korrekturfaktor (IE pro X mg/dL); 'carb_unit' = Einheit 'g' | 'BE' | 'KE'; 'dia_minutes' = Insulinwirkdauer in Minuten.",
          },
          value: {
            type: "string",
            description:
              "Neuer Wert als String. Für numerische Einstellungen die Zahl als String ('10', '80', '2.5'). Für carb_unit: 'g', 'BE' oder 'KE'. Einheit weglassen — nur den Zahlwert oder den Enum-Wert.",
          },
        },
        required: ["setting", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_exercise_entry",
      description:
        "Schlägt das Speichern einer Sporteinheit vor (exercise_logs). WICHTIG: schreibt NICHT direkt — Bestätigung per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine abgeschlossene Einheit loggen möchte ('ich war heute joggen', 'hab gerade 45 min Krafttraining gemacht'). Niemals für geplante oder hypothetische Aktivitäten.",
      parameters: {
        type: "object",
        properties: {
          exercise_type: {
            type: "string",
            enum: [
              "cardio", "strength", "hiit", "yoga", "cycling", "run",
              "swimming", "football", "tennis", "volleyball", "basketball",
              "breathwork", "hot_shower", "cold_shower", "hypertrophy",
            ],
            description:
              "Sportart. Wähle den passendsten Typ: cardio (allgemeines Cardio), strength (Kraft/Gym), hiit, yoga, cycling (Fahrrad), run (Laufen), swimming (Schwimmen), football/tennis/volleyball/basketball (Teamsport), breathwork (Atemübungen), hot_shower/cold_shower (Temperaturreize).",
          },
          duration_minutes: {
            type: "integer",
            description: "Dauer in Minuten (1-600). Pflichtfeld.",
          },
          intensity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Intensität: low (locker), medium (moderat), high (anstrengend).",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz (z. B. 'Intervalle 5×1 min').",
          },
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt der Einheit als ISO-8601-String. Wenn der Nutzer eine Uhrzeit nennt ('heute um 8 Uhr'), hier eintragen; sonst weglassen.",
          },
        },
        required: ["exercise_type", "duration_minutes", "intensity"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_symptom_entry",
      description:
        "Schlägt das Speichern eines Symptom-Eintrags vor (symptom_logs). WICHTIG: schreibt NICHT direkt — Bestätigung per UI-Button. Nur aufrufen, wenn der Nutzer explizit Symptome schildert ('ich habe Kopfschmerzen', 'mir ist schwindelig', 'ich bin total müde'). Wähle alle passenden symptom_types aus der Liste. Wenn der Nutzer Zyklus-Logging aktiviert hat und PMS-typische Symptome schildert (Krämpfe, Brustspannen, gedrückte Stimmung, Wassereinlagerungen, Blähungen, Reizbarkeit), wird die PMS-Kategorie automatisch vorausgewählt.",
      parameters: {
        type: "object",
        properties: {
          symptom_types: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "headache", "fatigue", "cramps", "nausea", "cravings",
                "low_mood", "sleep_disturbance", "brain_fog", "bloating",
                "anxiety", "irritability", "back_pain", "breast_tenderness",
                "dizziness", "mouth_dryness", "polyuria", "water_retention",
              ],
            },
            description:
              "Liste der Symptom-Tokens (mindestens 1). headache=Kopfschmerz, fatigue=Müdigkeit, cramps=Krämpfe, nausea=Übelkeit, cravings=Heißhunger, low_mood=gedrückte Stimmung, sleep_disturbance=Schlafprobleme, brain_fog=Konzentrationsprobleme, bloating=Blähungen, anxiety=Angst, irritability=Reizbarkeit, back_pain=Rückenschmerzen, breast_tenderness=Brustspannen, dizziness=Schwindel, mouth_dryness=Mundtrockenheit, polyuria=häufiges Wasserlassen, water_retention=Wassereinlagerungen.",
          },
          severity: {
            type: "integer",
            description:
              "Schweregrad 1 (sehr leicht) bis 5 (stark) — gilt für alle genannten Symptome. Wenn der Nutzer keinen Grad nennt, wähle 3 (moderat).",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Beschreibung oder Kontext.",
          },
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt des Auftretens als ISO-8601-String. Wenn der Nutzer eine Zeit nennt, hier eintragen; sonst weglassen.",
          },
        },
        required: ["symptom_types", "severity"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_influence_entry",
      description:
        "Schlägt das Speichern eines Einflussfaktor-Eintrags vor (influence_logs) — für Dinge, die den Blutzucker beeinflussen können: Alkohol, Stress (Prüfung, Arbeit, emotionale Belastung), Erkrankung (Erkältung, Grippe, Infektion), Medikamente (Nicht-Insulin), Schlafmangel, Cannabis, sonstiges. WICHTIG: schreibt NICHT direkt — Bestätigung per UI-Button. Rein dokumentarisch — die Engine ändert Dosierungen NICHT aufgrund dieser Einträge. Aufrufen wenn der Nutzer explizit über Alkohol-, Stress-, Krankheits-, Medikamenten- oder Schlaf-Situationen berichtet.",
      parameters: {
        type: "object",
        properties: {
          influence_type: {
            type: "string",
            enum: ["alcohol", "stress", "illness", "medication", "sleep_deprivation", "cannabis", "other"],
            description:
              "Typ: alcohol (Alkohol), stress (Stress, z. B. Prüfung, Arbeitsdruck), illness (Erkrankung, z. B. Erkältung, Grippe), medication (Medikamente, z. B. Kortison, Antibiotika), sleep_deprivation (Schlafmangel), cannabis, other (sonstiges).",
          },
          details: {
            type: "string",
            description:
              "Optional: Was genau (z. B. 'Rotwein', 'Ibuprofen 400mg', 'Stressphase').",
          },
          amount: {
            type: "string",
            description: "Optional: Menge als Freitext (z. B. '2 Gläser', '400mg', '1 Zug').",
          },
          notes: {
            type: "string",
            description: "Optional: weitere Notiz.",
          },
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt als ISO-8601-String. Wenn der Nutzer eine Zeit nennt, hier eintragen; sonst weglassen.",
          },
        },
        required: ["influence_type"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_cycle_entry",
      description:
        "Schlägt das Speichern eines Zyklus-Eintrags vor (menstrual_logs). WICHTIG: schreibt NICHT direkt — Bestätigung per UI-Button. NUR aufrufen, wenn der Nutzer das Zyklus-Logging aktiviert hat (cycle_logging_enabled = true im Kontext-Preamble) UND explizit einen Zyklus-Eintrag loggen möchte. Für Blutungs-Einträge: flow_intensity setzen. Für Phasen-Marker: phase_marker setzen. Mindestens eines der beiden Felder ist Pflicht.",
      parameters: {
        type: "object",
        properties: {
          start_date: {
            type: "string",
            description: "Datum als YYYY-MM-DD (Pflichtfeld). Startdatum der Blutung oder des Phasen-Markers.",
          },
          end_date: {
            type: "string",
            description:
              "Optional: Enddatum als YYYY-MM-DD (nur für Blutungseinträge mit bekanntem Ende). Muss >= start_date sein.",
          },
          flow_intensity: {
            type: "string",
            enum: ["light", "medium", "heavy"],
            description:
              "Blutungsintensität: light (leicht), medium (mittel), heavy (stark). Für Blutungseinträge Pflicht; für Phasen-Marker weglassen.",
          },
          phase_marker: {
            type: "string",
            enum: ["ovulation", "pms", "other"],
            description:
              "Phasen-Marker: ovulation (Eisprung), pms (PMS), other (sonstiges). Für Phasen-Einträge Pflicht; für Blutungseinträge weglassen.",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz.",
          },
        },
        required: ["start_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "log_insulin",
      description: `Schlägt das Speichern einer Insulin-Dosis vor (insulin_logs) — EINHEITLICHES Tool für Bolus und Basal. WICHTIG: schreibt NICHT direkt — Bestätigung erfolgt per UI-Button. Nur aufrufen, wenn der Nutzer explizit eine bereits gespritzte Dosis dokumentieren will.

Bolus-Insuline (schnell wirkend → insulin_type: "bolus"):
Fiasp, NovoRapid, Novolog, Humalog, Apidra, Lyumjev, Admelog

Basal-Insuline (lang wirkend → insulin_type: "basal"):
Tresiba, Degludec, Lantus, Glargine, Toujeo, Basaglar, Levemir, Detemir

Wenn der Nutzer einen Markennamen nennt, leite insulin_type automatisch aus der obigen Liste ab. Niemals eine Dosis vorschlagen oder berechnen — IE-Zahl muss vom Nutzer kommen.`,
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
              "Marken-/Insulin-Name (z. B. 'Fiasp', 'Tresiba'). Wenn der Nutzer einen Markennamen nennt, immer angeben.",
          },
          insulin_type: {
            type: "string",
            enum: ["bolus", "basal"],
            description:
              "Typ: 'bolus' für schnell wirkende Insuline (Fiasp, NovoRapid, Humalog, Apidra, Lyumjev, Novolog, Admelog), 'basal' für lang wirkende Insuline (Tresiba, Degludec, Lantus, Glargine, Toujeo, Basaglar, Levemir, Detemir). Pflichtfeld — aus Markenname ableiten wenn nicht explizit genannt.",
          },
          logged_at: {
            type: "string",
            description:
              "Optional: Zeitpunkt der Injektion als ISO-8601-String (z. B. '2026-06-04T08:30:00'). Wenn der Nutzer eine Uhrzeit nennt, hier eintragen; sonst weglassen.",
          },
          notes: {
            type: "string",
            description: "Optional: kurze Notiz.",
          },
        },
        required: ["units", "insulin_type"],
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
            enum: ["dashboard", "entries", "engine", "engine_bolus", "insights", "settings"],
            description:
              "Ziel-Screen: 'dashboard' (Übersicht), 'entries' (Mahlzeiten/Einträge), 'engine' (Glev Engine — Makros prüfen / KI-Empfehlungen), 'engine_bolus' (Bolus-Insulin eintragen — öffnet das Insulin-Formular direkt), 'insights' (Auswertungen), 'settings' (Einstellungen).",
          },
        },
        required: ["screen"],
      },
    },
  },
];

export type GlevToolName =
  | "get_glucose_status"
  | "get_glucose_history"
  | "get_active_iob"
  | "get_meal_history"
  | "get_bolus_history"
  | "get_basal_status"
  | "get_appointments"
  | "get_check_history"
  | "save_user_observation"
  | "log_meal_entry"
  | "log_bolus_entry"
  | "log_basal_entry"
  | "log_insulin"
  | "log_fingerstick"
  | "log_exercise_entry"
  | "log_symptom_entry"
  | "log_influence_entry"
  | "log_cycle_entry"
  | "add_appointment"
  | "add_timeline_check"
  | "set_macro"
  | "update_setting"
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
    /** Serialised tool params — forwarded to the client so the
     *  "Detail →" button can pre-populate the matching log form
     *  via sessionStorage without an extra server round-trip. */
    payload?: Record<string, unknown>;
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

/**
 * Marker shape returned by set_macro (Phase 2 voice assistant).
 * The chat-route emits a dedicated SSE frame; useGlevAI dispatches it
 * as CustomEvent("glev:set-macro") so the active engine-macros screen
 * can update its local form state without a full re-mount.
 */
export type SetMacroEnvelope = { set_macro: { field: string; value: number } };

export function isSetMacroEnvelope(v: unknown): v is SetMacroEnvelope {
  if (!v || typeof v !== "object") return false;
  const sm = (v as { set_macro?: unknown }).set_macro;
  if (!sm || typeof sm !== "object") return false;
  const o = sm as Record<string, unknown>;
  return typeof o.field === "string" && typeof o.value === "number";
}

/**
 * Marker shape returned by update_setting (Phase 3 voice assistant).
 * The chat-route emits this as a pending_action SSE frame (same flow as
 * write-tools). After user confirmation via /api/ai/confirm-action, the
 * server patches user_settings with the new value.
 *
 * Note: update_setting goes through the pending_action flow (not a direct
 * CustomEvent like set_macro) because it persists to the DB and the
 * compliance principle requires an explicit user tap for every write.
 */
export type UpdateSettingEnvelope = {
  update_setting: { setting: string; value: string };
};

/**
 * Returned by log_meal_entry instead of a pending_action.
 * The chat-route sends this as a { meal_prep: {...} } SSE frame.
 * useGlevAI stores the macros in sessionStorage then navigates to /engine,
 * where the engine page reads and pre-fills the form on mount.
 */
export type MealPrepEnvelope = {
  meal_prep: {
    input_text: string;
    carbs: number;
    protein: number | null;
    fat: number | null;
    fiber: number | null;
  };
};

export function isMealPrepEnvelope(v: unknown): v is MealPrepEnvelope {
  if (!v || typeof v !== "object") return false;
  const mp = (v as { meal_prep?: unknown }).meal_prep;
  if (!mp || typeof mp !== "object") return false;
  const o = mp as Record<string, unknown>;
  return typeof o.input_text === "string" && typeof o.carbs === "number";
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
      case "get_glucose_history":
        return await toolGetGlucoseHistory(userId, args, userTimezone);
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
      case "get_check_history":
        return await toolGetCheckHistory(sb, userId, args, userTimezone);
      case "save_user_observation":
        return await toolSaveUserObservation(sb, userId, args);
      case "log_meal_entry":
        return await toolLogMealEntry(sb, userId, args, userTimezone);
      case "log_bolus_entry":
        return await toolLogBolusEntry(sb, userId, args, userTimezone);
      case "log_basal_entry":
        return await toolLogBasalEntry(sb, userId, args, userTimezone);
      case "log_insulin":
        return await toolLogInsulinEntry(sb, userId, args, userTimezone);
      case "log_fingerstick":
        return await toolLogFingerstick(sb, userId, args);
      case "log_exercise_entry":
        return await toolLogExerciseEntry(sb, userId, args, userTimezone);
      case "log_symptom_entry":
        return await toolLogSymptomEntry(sb, userId, args, userTimezone);
      case "log_influence_entry":
        return await toolLogInfluenceEntry(sb, userId, args, userTimezone);
      case "log_cycle_entry":
        return await toolLogCycleEntry(sb, userId, args, userTimezone);
      case "add_appointment":
        return await toolAddAppointment(sb, userId, args);
      case "add_timeline_check":
        return await toolAddTimelineCheck(sb, userId, args, userTimezone);
      case "update_setting":
        return await toolUpdateSetting(sb, userId, args);
      case "set_macro": {
        // Server just validates + returns the envelope — the actual state
        // update happens client-side via the glev:set-macro CustomEvent
        // dispatched by useGlevAI when it reads this SSE frame.
        const allowed = ["carbs", "protein", "fat", "calories"];
        const field = typeof args.field === "string" ? args.field : "";
        if (!allowed.includes(field)) {
          return { error: `Unbekanntes Feld: ${field}. Erlaubt: carbs, protein, fat, calories.` };
        }
        const value = Number(args.value);
        if (!Number.isFinite(value) || value < 0) {
          return { error: "value muss eine nicht-negative Zahl sein." };
        }
        return { set_macro: { field, value: Math.round(value * 10) / 10 } } satisfies SetMacroEnvelope;
      }
      case "navigate_to": {
        const screenMap: Record<string, string> = {
          dashboard: "/dashboard",
          entries: "/entries",
          engine: "/engine",
          engine_bolus: "/engine?tab=bolus",
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
 * Fetch completed post-bolus checks (rows where bg_at_check IS NOT NULL)
 * joined with their parent meal for context. Returns a compact list the
 * AI can use to answer questions about post-meal glucose outcomes.
 */
async function toolGetCheckHistory(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const limit = clampLimit(args.limit ?? 10, 10);
  const checkTypeFilter =
    typeof args.check_type === "string" && args.check_type.trim()
      ? args.check_type.trim()
      : null;

  let query = sb
    .from("meal_timeline_checks")
    .select(
      "id, meal_id, check_type, planned_at, confirmed_at, bg_at_check, created_at",
    )
    .eq("user_id", userId)
    .not("bg_at_check", "is", null)
    .order("planned_at", { ascending: false })
    .limit(limit);

  if (checkTypeFilter) {
    query = query.eq("check_type", checkTypeFilter);
  }

  const { data: checks, error: checksErr } = await query;
  if (checksErr) return { error: checksErr.message, checks: [] };
  if (!checks || checks.length === 0) return { count: 0, checks: [] };

  // Fetch meal descriptions AND meal_type for the check rows in one batch query.
  // meal_type is used to build per-type aggregates (avg/min/max BG) so the AI
  // can answer "how do I usually land after pasta (FAST_CARBS)?"
  const mealIds = [...new Set((checks as Array<{ meal_id: string }>).map((c) => c.meal_id))];
  const { data: meals } = await sb
    .from("meals")
    .select("id, input_text, parsed_json, meal_type")
    .in("id", mealIds);

  const mealMap = new Map<string, { input_text: string | null; parsed_json: unknown; meal_type: string | null }>();
  for (const m of (meals ?? []) as Array<{ id: string; input_text: string | null; parsed_json: unknown; meal_type: string | null }>) {
    mealMap.set(m.id, m);
  }

  type CheckRaw = {
    id: string;
    meal_id: string;
    check_type: string;
    planned_at: string | null;
    confirmed_at: string | null;
    bg_at_check: number | null;
  };

  const result = (checks as CheckRaw[]).map((c) => {
    const meal = mealMap.get(c.meal_id);
    const description = meal
      ? resolveMealDescription(
          meal.input_text as string | null,
          meal.parsed_json as Array<{ name?: string }> | null,
        )
      : null;
    const plannedMs = c.planned_at ? new Date(c.planned_at).getTime() : null;
    return {
      checkType: c.check_type,
      mealDescription: description,
      mealType: meal?.meal_type ?? null,
      plannedAt: plannedMs ? formatInUserTimezone(plannedMs, userTimezone).dateTime : null,
      bgMgDl: c.bg_at_check,
    };
  });

  // Aggregate avg/min/max BG per meal type so the AI can surface patterns like
  // "your FAST_CARBS checks average 198 mg/dL vs 148 mg/dL for HIGH_PROTEIN".
  const typeAgg = new Map<string, { sum: number; min: number; max: number; count: number }>();
  for (const r of result) {
    if (r.bgMgDl == null || !r.mealType) continue;
    const bg = r.bgMgDl;
    const prev = typeAgg.get(r.mealType);
    if (prev) {
      prev.sum += bg;
      prev.min = Math.min(prev.min, bg);
      prev.max = Math.max(prev.max, bg);
      prev.count += 1;
    } else {
      typeAgg.set(r.mealType, { sum: bg, min: bg, max: bg, count: 1 });
    }
  }
  const byMealType = [...typeAgg.entries()].map(([type, agg]) => ({
    type,
    count: agg.count,
    avgBgMgDl: Math.round(agg.sum / agg.count),
    minBgMgDl: agg.min,
    maxBgMgDl: agg.max,
  })).sort((a, b) => b.avgBgMgDl - a.avgBgMgDl);

  return { count: result.length, checks: result, byMealType };
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
  clientPayload?: Record<string, unknown>,
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
      payload: params,
    },
  };
}

async function toolLogMealEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
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
  const fiber =
    Number.isFinite(Number(args.fiber_grams)) && args.fiber_grams !== undefined
      ? Number(args.fiber_grams)
      : null;

  // Resolve logged_at: use provided ISO string or default to now.
  const loggedAtRaw = typeof args.logged_at === "string" ? args.logged_at.trim() : "";
  const loggedAtMs = loggedAtRaw ? new Date(loggedAtRaw).getTime() : Date.now();
  const loggedAtIso = Number.isFinite(loggedAtMs)
    ? new Date(loggedAtMs).toISOString()
    : new Date().toISOString();

  // Try to find nearest CGM reading ±60 min for glucose_before (best-effort).
  let glucoseBefore: number | null = null;
  try {
    const hist = await getHistory(userId);
    if (hist?.history?.length) {
      const candidates = hist.history
        .filter((r) => r.timestamp && r.value != null)
        .map((r) => ({
          value: r.value as number,
          dist: Math.abs(new Date(r.timestamp!).getTime() - loggedAtMs),
        }))
        .filter((r) => r.dist <= 60 * 60_000);
      candidates.sort((a, b) => a.dist - b.dist);
      if (candidates[0]) glucoseBefore = candidates[0].value;
    }
  } catch {
    /* best-effort — no CGM should not block meal logging */
  }

  // ── Smart Aggregator + Two-Phase Optimistic Emit ──────────────────
  // Flags:
  //   MACRO_AGGREGATOR_V2     — resolve per-item sources via OFF/USDA/GPT.
  //   OPTIMISTIC_REFINEMENT   — emit meal_prep IMMEDIATELY with Mistral
  //     estimates, run aggregator detached, write result to
  //     meal_prep_refinements. Client subscribes via Realtime / polling.
  const aggregatorEnabled =
    process.env.MACRO_AGGREGATOR_V2 === "true" ||
    process.env.NEXT_PUBLIC_MACRO_AGGREGATOR_V2 === "true";
  const optimisticEnabled =
    process.env.OPTIMISTIC_REFINEMENT === "true" ||
    process.env.NEXT_PUBLIC_OPTIMISTIC_REFINEMENT === "true";

  const rawItems = Array.isArray(args.items)
    ? (args.items as Array<{ name?: unknown; grams?: unknown }>).filter(
        (i) => typeof i?.name === "string" && typeof i?.grams === "number" && i.grams > 0,
      )
    : [];

  const timeLabel = formatInUserTimezone(loggedAtMs, userTimezone);
  const macroBits = [`${carbs}g KH`];
  if (protein != null) macroBits.push(`${protein}g P`);
  if (fat != null) macroBits.push(`${fat}g F`);
  if (fiber != null) macroBits.push(`${fiber}g Bal`);
  const summary = `Mahlzeit: ${inputText} (${macroBits.join(", ")}) um ${timeLabel.dateTime}`;

  // Generate a stable ID so the client can subscribe before the aggregator runs.
  const mealPrepId = crypto.randomUUID();

  // Helper: run aggregator, log metrics, write refinement row.
  async function runAggregator(targetId: string): Promise<import("@/lib/meals").ParsedFood[] | undefined> {
    if (!aggregatorEnabled || rawItems.length === 0) return undefined;
    const t0 = Date.now();
    try {
      const parsedItems: ParsedFoodItem[] = rawItems.map((i) => ({
        name:               String(i.name),
        grams:              Number(i.grams),
        is_branded:         false,
        search_term_en:     String(i.name),
        search_term_de:     String(i.name),
        quantity_specified: true,
      }));
      const userHistory = await getCachedUserHistory(
        sb, userId, parsedItems.map((p) => p.name),
      ).catch(() => new Map());

      const agg = await aggregateNutrition(parsedItems, { userHistory });
      const resolved: import("@/lib/meals").ParsedFood[] = agg.items.map((it) => ({
        name: it.name, grams: it.grams, carbs: it.carbs,
        protein: it.protein, fat: it.fat, fiber: it.fiber, source: it.source,
      }));

      const dbHits  = agg.items.filter((i) => i.source !== "estimated" && i.source !== "unknown").length;
      const estCnt  = agg.items.length - dbHits;
      const elapsed = Date.now() - t0;
      console.log(`[meal_prep] id=${targetId} aggregator: ${agg.items.length} items, ${dbHits} db-hits, ${estCnt} estimates, ${elapsed}ms`);

      if (optimisticEnabled) {
        // Fire-and-forget: write refinement row; Realtime notifies the client.
        sb.from("meal_prep_refinements")
          .upsert({ id: targetId, user_id: userId, items_refined: resolved, status: "completed", completed_at: new Date().toISOString() }, { onConflict: "id" })
          .then(() => {})
          .catch((e: unknown) => console.error("[meal_prep] refinement write failed:", e));
      }
      return resolved;
    } catch (aggErr) {
      console.error(`[meal_prep] id=${targetId} aggregator error (fallback to Mistral macros):`, aggErr);
      if (optimisticEnabled) {
        sb.from("meal_prep_refinements")
          .upsert({ id: targetId, user_id: userId, status: "failed", completed_at: new Date().toISOString() }, { onConflict: "id" })
          .then(() => {})
          .catch(() => {});
      }
      return undefined;
    }
  }

  let resolvedItems: import("@/lib/meals").ParsedFood[] | undefined;
  let resolvedCarbs   = carbs;
  let resolvedProtein = protein;
  let resolvedFat     = fat;
  let resolvedFiber   = fiber;

  if (aggregatorEnabled && !optimisticEnabled) {
    // Synchronous path (Phase 2): await aggregator before returning.
    resolvedItems = await runAggregator(mealPrepId);
    if (resolvedItems) {
      const totals = resolvedItems.reduce(
        (acc, it) => ({ carbs: acc.carbs + it.carbs, protein: acc.protein + it.protein, fat: acc.fat + it.fat, fiber: acc.fiber + it.fiber }),
        { carbs: 0, protein: 0, fat: 0, fiber: 0 },
      );
      resolvedCarbs   = Math.round(totals.carbs   * 10) / 10;
      resolvedProtein = Math.round(totals.protein  * 10) / 10;
      resolvedFat     = Math.round(totals.fat      * 10) / 10;
      resolvedFiber   = Math.round(totals.fiber    * 10) / 10;
    }
  } else if (optimisticEnabled && aggregatorEnabled) {
    // Optimistic path (Phase 3): return immediately, run aggregator detached.
    // Pre-insert a 'pending' row so the client can subscribe before results arrive.
    void sb.from("meal_prep_refinements")
      .insert({ id: mealPrepId, user_id: userId, status: "pending" })
      .then(() => {})
      .catch(() => {});
    // Detach — never await this.
    void runAggregator(mealPrepId);
    // Use Mistral estimates as-is; items get source='estimated' placeholder.
    resolvedItems = rawItems.length > 0
      ? rawItems.map((i) => ({
          name: String(i.name), grams: Number(i.grams),
          carbs: 0, protein: 0, fat: 0, fiber: 0, source: "estimated" as const,
        }))
      : undefined;
  }

  const params: import("@/lib/useGlevAI").MealPendingPayload = {
    input_text:     inputText,
    carbs_grams:    resolvedCarbs,
    protein_grams:  resolvedProtein,
    fat_grams:      resolvedFat,
    fiber_grams:    resolvedFiber,
    logged_at:      loggedAtIso,
    glucose_before: glucoseBefore,
    meal_prep_id:   mealPrepId,
    ...(resolvedItems ? { items: resolvedItems } : {}),
  };

  return await createPendingAction(sb, userId, "log_meal_entry", params, summary);
}

async function toolLogInsulinEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const units = Number(args.units);
  if (!Number.isFinite(units) || units <= 0 || units > 100) {
    return { error: "units ungültig (0-100 IE erwartet)" };
  }
  const insulinType = args.insulin_type === "basal" ? "basal" : "bolus";
  const insulinName =
    typeof args.insulin_name === "string" && args.insulin_name.trim()
      ? args.insulin_name.trim().slice(0, 60)
      : insulinType === "bolus" ? "Bolus" : "Basal";
  const notes =
    typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim().slice(0, 200)
      : null;

  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatLoggedAt(new Date(loggedAt).getTime(), userTimezone);
  const typeLabel = insulinType === "bolus" ? "Bolus" : "Basal";

  const params = {
    units,
    insulin_name: insulinName,
    insulin_type: insulinType,
    notes,
    logged_at: loggedAt,
  };
  const summary = `${typeLabel}: ${units} IE ${insulinName}${notes ? ` (${notes})` : ""} — ${timeLabel}`;

  return await createPendingAction(sb, userId, "log_insulin", params, summary, params);
}

async function toolLogBolusEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
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

  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatLoggedAt(new Date(loggedAt).getTime(), userTimezone);

  const params = {
    units,
    insulin_name: insulinName,
    notes,
    logged_at: loggedAt,
  };
  const summary = `Bolus: ${units} IE ${insulinName}${notes ? ` (${notes})` : ""} — ${timeLabel}`;

  return await createPendingAction(sb, userId, "log_bolus_entry", params, summary);
}

async function toolLogBasalEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const units = Number(args.units);
  if (!Number.isFinite(units) || units <= 0 || units > 100) {
    return { error: "units ungültig (0-100 IE erwartet)" };
  }
  const insulinName =
    typeof args.insulin_name === "string" && args.insulin_name.trim()
      ? args.insulin_name.trim().slice(0, 60)
      : "Basal";
  const notes =
    typeof args.notes === "string" && args.notes.trim()
      ? args.notes.trim().slice(0, 200)
      : null;

  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatLoggedAt(new Date(loggedAt).getTime(), userTimezone);

  const params = {
    units,
    insulin_name: insulinName,
    notes,
    logged_at: loggedAt,
  };
  const summary = `Basal: ${units} IE ${insulinName}${notes ? ` (${notes})` : ""} — ${timeLabel}`;

  return await createPendingAction(sb, userId, "log_basal_entry", params, summary);
}

/**
 * Resolves the `logged_at` arg from a tool call.
 * Accepts an ISO-8601 string; falls back to the current moment if absent or invalid.
 */
function resolveLoggedAt(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) {
    const ms = new Date(raw.trim()).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Formats a timestamp for the chip summary.
 * Returns "heute HH:MM Uhr" when the timestamp falls on today in the
 * user's timezone, or "DD.MM. HH:MM Uhr" for any other day.
 */
function formatLoggedAt(atMs: number, userTimezone: string | null): string {
  const tz =
    userTimezone && isValidTimezone(userTimezone) ? userTimezone : "Europe/Berlin";
  const d = new Date(atMs);
  const hhmm = d.toLocaleTimeString("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
  const todayStr = new Date().toLocaleDateString("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const entryStr = d.toLocaleDateString("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (todayStr === entryStr) {
    return `heute ${hhmm} Uhr`;
  }
  const datePart = d.toLocaleDateString("de-DE", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
  });
  return `${datePart} ${hhmm} Uhr`;
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

// ── Universal Logging tools ───────────────────────────────────────────

const VALID_EXERCISE_TYPES_SET = new Set([
  "cardio", "strength", "hiit", "yoga", "cycling", "run",
  "swimming", "football", "tennis", "volleyball", "basketball",
  "breathwork", "hot_shower", "cold_shower", "hypertrophy",
]);

async function toolLogExerciseEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const exerciseType = typeof args.exercise_type === "string" ? args.exercise_type.trim() : "";
  if (!VALID_EXERCISE_TYPES_SET.has(exerciseType)) {
    return { error: `Unbekannter Sporttyp: ${exerciseType}` };
  }

  const durationRaw = Number(args.duration_minutes);
  if (!Number.isFinite(durationRaw) || durationRaw < 1 || durationRaw > 600) {
    return { error: "duration_minutes muss zwischen 1 und 600 liegen" };
  }
  const duration = Math.round(durationRaw);

  const intensity = typeof args.intensity === "string" ? args.intensity.trim() : "";
  if (!["low", "medium", "high"].includes(intensity)) {
    return { error: "intensity muss 'low', 'medium' oder 'high' sein" };
  }

  const notes = shorten(typeof args.notes === "string" ? args.notes : null, 200);
  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatInUserTimezone(new Date(loggedAt).getTime(), userTimezone);

  const typeLabel: Record<string, string> = {
    cardio: "Cardio", strength: "Krafttraining", hiit: "HIIT", yoga: "Yoga",
    cycling: "Radfahren", run: "Laufen", swimming: "Schwimmen",
    football: "Fußball", tennis: "Tennis", volleyball: "Volleyball",
    basketball: "Basketball", breathwork: "Atemübungen",
    hot_shower: "Warme Dusche", cold_shower: "Kalte Dusche",
    hypertrophy: "Hypertrophie",
  };
  const intensityLabel: Record<string, string> = {
    low: "locker", medium: "moderat", high: "intensiv",
  };
  const label = typeLabel[exerciseType] ?? exerciseType;
  const intLabel = intensityLabel[intensity] ?? intensity;
  const summary = `Sport: ${label} ${duration} min (${intLabel}) um ${timeLabel.dateTime}`;

  return await createPendingAction(sb, userId, "log_exercise_entry", {
    exercise_type: exerciseType,
    duration_minutes: duration,
    intensity,
    notes,
    logged_at: loggedAt,
  }, summary);
}

const VALID_SYMPTOM_TYPES_SET = new Set([
  "headache", "fatigue", "cramps", "nausea", "cravings",
  "low_mood", "sleep_disturbance", "brain_fog", "bloating",
  "anxiety", "irritability", "back_pain", "breast_tenderness",
  "dizziness", "mouth_dryness", "polyuria", "water_retention",
]);

/**
 * Symptoms that signal a PMS context when cycle logging is enabled.
 * Mirrors the task spec: cramps, breast_tenderness, low_mood,
 * water_retention, bloating, irritability.
 */
const PMS_TRIGGER_SYMPTOMS = new Set([
  "cramps", "breast_tenderness", "low_mood",
  "water_retention", "bloating", "irritability",
]);

async function toolLogSymptomEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const typesRaw = Array.isArray(args.symptom_types) ? args.symptom_types : [];
  const validTypes = typesRaw.filter(
    (t): t is string => typeof t === "string" && VALID_SYMPTOM_TYPES_SET.has(t),
  );
  if (!validTypes.length) {
    return { error: "symptom_types muss mindestens einen gültigen Token enthalten" };
  }

  const severityRaw = Number(args.severity);
  if (!Number.isFinite(severityRaw) || severityRaw < 1 || severityRaw > 5) {
    return { error: "severity muss zwischen 1 und 5 liegen" };
  }
  const severity = Math.round(severityRaw);

  const notes = shorten(typeof args.notes === "string" ? args.notes : null, 200);
  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatInUserTimezone(new Date(loggedAt).getTime(), userTimezone);

  // Detect PMS context: if the user has cycle logging enabled and at least
  // one of the reported symptoms is PMS-typical, pre-select the PMS category
  // so the SymptomForm opens on the right tab.
  let category: "pms" | undefined;
  const hasPmsTrigger = validTypes.some((t) => PMS_TRIGGER_SYMPTOMS.has(t));
  if (hasPmsTrigger) {
    const { data: settings } = await sb
      .from("user_settings")
      .select("cycle_logging_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if ((settings as { cycle_logging_enabled?: boolean } | null)?.cycle_logging_enabled) {
      category = "pms";
    }
  }

  const summary =
    `Symptome: ${validTypes.join(", ")} (Schweregrad ${severity}/5) um ${timeLabel.timeOnly}`;

  return await createPendingAction(sb, userId, "log_symptom_entry", {
    symptom_types: validTypes,
    severity,
    notes,
    logged_at: loggedAt,
    ...(category ? { category } : {}),
  }, summary);
}

async function toolLogInfluenceEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const influenceType = typeof args.influence_type === "string" ? args.influence_type.trim() : "";
  const VALID_INFLUENCE_TYPES = [
    "alcohol", "stress", "illness", "medication",
    "sleep_deprivation", "cannabis", "other",
  ];
  if (!VALID_INFLUENCE_TYPES.includes(influenceType)) {
    return {
      error: `influence_type muss einer von: ${VALID_INFLUENCE_TYPES.join(", ")} sein`,
    };
  }

  const details = shorten(typeof args.details === "string" ? args.details : null, 200);
  const amount = shorten(typeof args.amount === "string" ? args.amount : null, 100);
  const notes = shorten(typeof args.notes === "string" ? args.notes : null, 200);
  const loggedAt = resolveLoggedAt(args.logged_at);
  const timeLabel = formatInUserTimezone(new Date(loggedAt).getTime(), userTimezone);

  const typeLabel: Record<string, string> = {
    alcohol: "Alkohol",
    stress: "Stress",
    illness: "Erkrankung",
    medication: "Medikamente",
    sleep_deprivation: "Schlafmangel",
    cannabis: "Cannabis",
    other: "Sonstiges",
  };
  const label = typeLabel[influenceType] ?? influenceType;
  const amountPart = amount ? ` · ${amount}` : "";
  const timePart = timeLabel.timeOnly;
  const summary = `${label}${amountPart} · ${timePart}`;

  return await createPendingAction(sb, userId, "log_influence_entry", {
    influence_type: influenceType,
    details,
    amount,
    notes,
    logged_at: loggedAt,
  }, summary);
}

async function toolLogCycleEntry(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  _userTimezone: string | null,
): Promise<unknown> {
  // Feature-flag guard: user must have opted in to cycle logging.
  const { data: settings } = await sb
    .from("user_settings")
    .select("cycle_logging_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !(settings as { cycle_logging_enabled?: boolean } | null)?.cycle_logging_enabled
  ) {
    return {
      error:
        "Zyklus-Logging ist nicht aktiviert. Der Nutzer kann es in den Einstellungen unter 'Zyklus & Hormone' einschalten.",
    };
  }

  const startDate = typeof args.start_date === "string" ? args.start_date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { error: "start_date muss YYYY-MM-DD sein" };
  }

  const endDate =
    typeof args.end_date === "string" && args.end_date.trim()
      ? args.end_date.trim()
      : null;
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { error: "end_date muss YYYY-MM-DD sein" };
  }
  if (endDate && endDate < startDate) {
    return { error: "end_date darf nicht vor start_date liegen" };
  }

  const flowIntensity =
    typeof args.flow_intensity === "string" && args.flow_intensity.trim()
      ? args.flow_intensity.trim()
      : null;
  if (flowIntensity && !["light", "medium", "heavy"].includes(flowIntensity)) {
    return { error: "flow_intensity muss 'light', 'medium' oder 'heavy' sein" };
  }

  const phaseMarker =
    typeof args.phase_marker === "string" && args.phase_marker.trim()
      ? args.phase_marker.trim()
      : null;
  if (phaseMarker && !["ovulation", "pms", "other"].includes(phaseMarker)) {
    return { error: "phase_marker muss 'ovulation', 'pms' oder 'other' sein" };
  }

  if (!flowIntensity && !phaseMarker) {
    return {
      error:
        "Mindestens flow_intensity (Blutungsintensität) oder phase_marker muss angegeben werden.",
    };
  }

  const notes = shorten(typeof args.notes === "string" ? args.notes : null, 200);

  const intensityLabel: Record<string, string> = {
    light: "Leichte", medium: "Mittlere", heavy: "Starke",
  };
  const phaseLabel: Record<string, string> = {
    ovulation: "Eisprung", pms: "PMS", other: "Phasen-Marker",
  };
  const typeLabel = flowIntensity
    ? `${intensityLabel[flowIntensity] ?? flowIntensity} Blutung`
    : phaseLabel[phaseMarker!] ?? "Phasen-Marker";
  const endBit = endDate ? ` bis ${endDate}` : "";
  const summary = `Zyklus: ${typeLabel} ab ${startDate}${endBit}`;

  return await createPendingAction(sb, userId, "log_cycle_entry", {
    start_date: startDate,
    end_date: endDate,
    flow_intensity: flowIntensity,
    phase_marker: phaseMarker,
    notes,
  }, summary);
}

// ── Phase 3 tools ────────────────────────────────────────────────────

/**
 * Historical CGM aggregates for a given time window.
 *
 * Uses the same getHistory() call as get_glucose_status so we re-use the
 * adapter (LLU / Nightscout / Apple Health) and its cache. The returned
 * `history` array covers the last ~24 h in most adapters, so periods
 * longer than that (last_7_days) will show what's available rather than
 * a full week. Mistral should phrase the answer accordingly.
 */
async function toolGetGlucoseHistory(
  userId: string,
  args: Record<string, unknown>,
  userTimezone: string | null,
): Promise<unknown> {
  const period = typeof args.period === "string" ? args.period : "today";

  const out = await getHistory(userId).catch(() => null);
  if (!out?.history?.length) {
    return {
      available: false,
      period,
      hint: "Keine CGM-Daten verfügbar (CGM nicht verbunden oder Cache leer).",
    };
  }

  const tz =
    userTimezone && isValidTimezone(userTimezone)
      ? userTimezone
      : "Europe/Berlin";

  const now = Date.now();

  /** Returns local midnight (ms) for the given date in the user's tz. */
  function localMidnight(offsetDays = 0): number {
    const d = new Date(now);
    const dateStr = d.toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
    const base = new Date(`${dateStr}T00:00:00`).getTime();
    return Number.isFinite(base) ? base + offsetDays * 86_400_000 : now;
  }

  const start: number = (() => {
    switch (period) {
      case "last_hour":   return now - 3_600_000;
      case "last_3h":     return now - 3 * 3_600_000;
      case "last_6h":     return now - 6 * 3_600_000;
      case "last_7_days": return now - 7 * 86_400_000;
      case "yesterday":   return localMidnight(-1);
      default:            return localMidnight(0); // "today"
    }
  })();

  const end: number = period === "yesterday" ? localMidnight(0) : now;

  // Filter by time window; skip readings with null timestamp or null value.
  const samples = out.history.filter((r) => {
    if (!r.timestamp || r.value == null) return false;
    const ts = new Date(r.timestamp).getTime();
    return ts >= start && ts <= end;
  });

  if (!samples.length) {
    return {
      available: false,
      period,
      hint: "Keine CGM-Messungen im gewählten Zeitraum gefunden (Sensor-Ausfall oder zu langer Zeitraum).",
    };
  }

  // Safe to cast: null values were filtered out above.
  const values = samples.map((r) => r.value as number);
  const avg    = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const min    = Math.min(...values);
  const max    = Math.max(...values);

  // Time-in-range: 70-180 mg/dL (ADA standard range)
  const inRange  = values.filter((v) => v >= 70 && v <= 180).length;
  const tooLow   = values.filter((v) => v < 70).length;
  const tooHigh  = values.filter((v) => v > 180).length;
  const tirPct   = Math.round((inRange / values.length) * 100);

  return {
    available: true,
    period,
    sampleCount: samples.length,
    avgMgDl: avg,
    minMgDl: min,
    maxMgDl: max,
    timeInRangePct: tirPct,
    tooLowPct:  Math.round((tooLow  / values.length) * 100),
    tooHighPct: Math.round((tooHigh / values.length) * 100),
    unit: out.history[0]?.unit ?? "mg/dL",
    note: "Time-in-Range basiert auf ADA-Standard 70–180 mg/dL.",
  };
}

/**
 * update_setting — validates the requested change, then creates a
 * pending_action row for user confirmation. The confirmed action is
 * executed by /api/ai/confirm-action (case "update_setting") which
 * PATCHes user_settings.
 *
 * Allowed settings + value formats:
 *   icr              → positive number (e.g. "10" = 1:10)
 *   target_low_mg_dl → 40-200 mg/dL
 *   target_high_mg_dl→ 40-400 mg/dL
 *   correction_factor→ positive number
 *   carb_unit        → "g" | "BE" | "KE"
 *   dia_minutes      → 120-480 minutes
 */
async function toolUpdateSetting(
  sb: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const allowedSettings = [
    "icr", "target_low_mg_dl", "target_high_mg_dl",
    "correction_factor", "carb_unit", "dia_minutes",
  ];
  const setting = typeof args.setting === "string" ? args.setting : "";
  if (!allowedSettings.includes(setting)) {
    return { error: `Unbekannte Einstellung: ${setting}.` };
  }
  const rawValue = typeof args.value === "string" ? args.value.trim() : "";
  if (!rawValue) {
    return { error: "value darf nicht leer sein." };
  }

  // Validate per-setting.
  if (setting === "carb_unit") {
    if (!["g", "BE", "KE"].includes(rawValue)) {
      return { error: "carb_unit muss 'g', 'BE' oder 'KE' sein." };
    }
  } else {
    const n = parseFloat(rawValue);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: `${setting}: Wert muss eine positive Zahl sein.` };
    }
    if (setting === "target_low_mg_dl"  && (n < 40 || n > 200)) return { error: "Untere Grenze muss zwischen 40 und 200 mg/dL liegen." };
    if (setting === "target_high_mg_dl" && (n < 40 || n > 400)) return { error: "Obere Grenze muss zwischen 40 und 400 mg/dL liegen." };
    if (setting === "dia_minutes"       && (n < 120 || n > 480)) return { error: "Insulinwirkdauer muss zwischen 120 und 480 Minuten liegen." };
  }

  // Human-readable summary for the confirmation bubble.
  const labelMap: Record<string, string> = {
    icr:                `ICR auf 1:${rawValue}`,
    target_low_mg_dl:   `Untere Zielgrenze auf ${rawValue} mg/dL`,
    target_high_mg_dl:  `Obere Zielgrenze auf ${rawValue} mg/dL`,
    correction_factor:  `Korrekturfaktor auf ${rawValue}`,
    carb_unit:          `Kohlenhydrat-Einheit auf ${rawValue}`,
    dia_minutes:        `Insulinwirkdauer auf ${rawValue} Minuten`,
  };
  const summary = `Einstellung ändern: ${labelMap[setting] ?? setting}`;

  return await createPendingAction(
    sb,
    userId,
    "update_setting" as GlevToolName,
    { setting, value: rawValue },
    summary,
  );
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
