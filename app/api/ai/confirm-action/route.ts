import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * POST /api/ai/confirm-action
 *
 * Bestätigungs-Endpoint für Glev-AI-WRITE-Tools (Phase 3, Task 2).
 *
 * Flow:
 *   1. AI-Tool (z. B. log_meal_entry) legt in /api/ai/chat eine
 *      ai_pending_actions-Zeile mit den vorgeschlagenen Parametern an
 *      und schickt den Token via SSE-Frame an die UI.
 *   2. UI rendert Bestätigen/Abbrechen-Buttons. Auf Bestätigen ruft
 *      sie diesen Endpoint mit `{ token }` auf.
 *   3. Wir markieren die Zeile als `used_at = now()` (idempotent
 *      guard gegen Doppelklick), prüfen TTL/Owner und führen dann
 *      den Insert in der Zieltabelle aus.
 *
 * Status-Codes:
 *   401 — kein authed user.
 *   400 — token fehlt / ungültig.
 *   404 — token nicht gefunden (oder RLS denied — der User soll nicht
 *         zwischen "existiert nicht" und "gehört dir nicht" unterscheiden
 *         können).
 *   403 — token gehört nicht zum signed-in user (defensive Doppelprüfung
 *         falls RLS lockerer ist als gedacht).
 *   409 — token wurde bereits eingelöst (used_at gesetzt).
 *   410 — token ist abgelaufen (expires_at < now).
 *   500 — Insert in Zieltabelle fehlgeschlagen (Constraint, Schema-Lag, …).
 */

type PendingActionRow = {
  token: string;
  kind: string;
  params: Record<string, unknown>;
  summary: string;
  expires_at: string;
  used_at: string | null;
  user_id: string;
};

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { user, sb } = auth;

  const raw = await req.json().catch(() => null);
  const token =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).token === "string"
      ? (raw as { token: string }).token.trim()
      : "";
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  return handleConfirmPost(sb, user.id, token);
}

/**
 * Core confirm-action logic, extracted for unit-testability (no Next.js request
 * plumbing required). Mirrors the same pattern as `handleInsulinPost` in
 * `app/api/insulin/route.ts`.
 *
 * Called by the `POST` handler above after auth + token extraction.
 * Also imported directly by integration tests that mock the Supabase client.
 */
export async function handleConfirmPost(
  sb: SupabaseClient,
  userId: string,
  token: string,
): Promise<NextResponse> {
  const { data: pa, error: paErr } = await sb
    .from("ai_pending_actions")
    .select("token,user_id,kind,params,summary,expires_at,used_at")
    .eq("token", token)
    .maybeSingle();

  if (paErr || !pa) {
    return NextResponse.json(
      { error: "action not found" },
      { status: 404 },
    );
  }
  const row = pa as PendingActionRow;
  if (row.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.used_at) {
    return NextResponse.json(
      { error: "action already confirmed", ok: false },
      { status: 409 },
    );
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "action expired", ok: false },
      { status: 410 },
    );
  }

  // Idempotent guard FIRST: claim the row by setting used_at, conditional
  // on it still being null AND not yet expired. The combined predicate
  // eliminates the TOCTOU window between the pre-check above and the
  // claim (a row could expire mid-request). If two clicks race, exactly
  // one of them sees a non-empty result and proceeds.
  const claimAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sb
    .from("ai_pending_actions")
    .update({ used_at: claimAt })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", claimAt)
    .select("token")
    .maybeSingle();
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed) {
    // Lost the race OR the row expired between pre-check and claim.
    // Either way, the user-visible meaning is "this action is no longer
    // actionable" — the UI shows the appropriate inline error state.
    return NextResponse.json(
      { error: "action already confirmed or expired", ok: false },
      { status: 409 },
    );
  }

  try {
    const result = await executeConfirmedAction(sb, userId, row.kind, row.params);
    return NextResponse.json({ ok: true, kind: row.kind, ...result });
  } catch (e) {
    // Insert failed (constraint violation, schema lag, transient DB
    // error). Roll back our `used_at` claim so the user can retry via
    // the "Nochmal versuchen"-Button. Without this rollback, every
    // transient error would permanently burn the token.
    //
    // We intentionally do NOT retry the insert here — surfacing the
    // failure to the UI lets the user decide whether to retry or
    // cancel. The rollback is best-effort: if it itself fails (e.g.
    // network gone), the row simply expires after 5 min.
    await sb
      .from("ai_pending_actions")
      .update({ used_at: null })
      .eq("token", token)
      .eq("used_at", claimAt);
    const msg = e instanceof Error ? e.message : "execution failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function executeConfirmedAction(
  sb: SupabaseClient,
  userId: string,
  kind: string,
  params: Record<string, unknown>,
): Promise<{ insertedId?: string; updatedSetting?: string }> {
  switch (kind) {
    case "log_meal_entry":
      return await execLogMealEntry(sb, userId, params);
    case "log_bolus_entry":
      return await execLogBolusEntry(sb, userId, params);
    case "log_basal_entry":
      return await execLogBasalEntry(sb, userId, params);
    case "log_fingerstick":
      return await execLogFingerstick(sb, userId, params);
    case "log_exercise_entry":
      return await execLogExerciseEntry(sb, userId, params);
    case "log_symptom_entry":
      return await execLogSymptomEntry(sb, userId, params);
    case "log_influence_entry":
      return await execLogInfluenceEntry(sb, userId, params);
    case "log_cycle_entry":
      return await execLogCycleEntry(sb, userId, params);
    case "add_appointment":
      return await execAddAppointment(sb, userId, params);
    case "add_timeline_check":
      return await execAddTimelineCheck(sb, userId, params);
    case "update_setting":
      return await execUpdateSetting(sb, userId, params);
    default:
      throw new Error(`unknown action kind: ${kind}`);
  }
}

async function execLogMealEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const inputText = typeof p.input_text === "string" ? p.input_text : "";
  const carbs = typeof p.carbs_grams === "number" ? p.carbs_grams : null;
  const protein = typeof p.protein_grams === "number" ? p.protein_grams : null;
  const fat = typeof p.fat_grams === "number" ? p.fat_grams : null;
  const mealType =
    typeof p.meal_type === "string" &&
    ["FAST_CARBS", "HIGH_PROTEIN", "HIGH_FAT", "BALANCED"].includes(p.meal_type)
      ? p.meal_type
      : "BALANCED";

  if (!inputText || carbs === null) {
    throw new Error("input_text und carbs_grams sind Pflichtfelder");
  }

  // parsed_json bewusst leer: AI hat keinen verlässlichen OpenFoodFacts/
  // GPT-Parse-Lauf gemacht — wir loggen nur das Roh-Statement plus die
  // vom Modell genannten Makros. Das ist konsistent mit dem manuellen
  // "schnell loggen"-Eintrag aus dem Engine-Tab.
  const glucoseBefore =
    typeof p.glucose_before === "number" && Number.isFinite(p.glucose_before)
      ? p.glucose_before
      : null;
  const createdAt = resolveLoggedAt(p.logged_at);

  const row: Record<string, unknown> = {
    user_id: userId,
    input_text: inputText,
    parsed_json: [],
    glucose_before: glucoseBefore,
    glucose_after: null,
    carbs_grams: carbs,
    protein_grams: protein,
    fat_grams: fat,
    insulin_units: null,
    meal_type: mealType,
    evaluation: null,
    created_at: createdAt,
  };

  const { data, error } = await sb
    .from("meals")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: data?.id as string | undefined };
}

function resolveLoggedAt(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) {
    const ms = new Date(raw.trim()).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

async function execLogBolusEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const units = typeof p.units === "number" ? p.units : null;
  const name =
    typeof p.insulin_name === "string" && p.insulin_name.trim()
      ? p.insulin_name.trim()
      : "Bolus";
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
  const createdAt = resolveLoggedAt(p.logged_at);

  if (units === null || !Number.isFinite(units) || units <= 0 || units > 100) {
    throw new Error("units muss zwischen 0 und 100 IE liegen");
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    insulin_type: "bolus",
    insulin_name: name,
    units,
    notes,
    created_at: createdAt,
  };

  const { data, error } = await sb
    .from("insulin_logs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: data?.id as string | undefined };
}

async function execLogBasalEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const units = typeof p.units === "number" ? p.units : null;
  const name =
    typeof p.insulin_name === "string" && p.insulin_name.trim()
      ? p.insulin_name.trim()
      : "Basal";
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
  const createdAt = resolveLoggedAt(p.logged_at);

  if (units === null || !Number.isFinite(units) || units <= 0 || units > 100) {
    throw new Error("units muss zwischen 0 und 100 IE liegen");
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    insulin_type: "basal",
    insulin_name: name,
    units,
    notes,
    created_at: createdAt,
  };

  const { data, error } = await sb
    .from("insulin_logs")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: data?.id as string | undefined };
}

async function execLogFingerstick(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const value = typeof p.value_mg_dl === "number" ? p.value_mg_dl : null;
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;

  if (value === null || !Number.isFinite(value) || value < 20 || value > 600) {
    throw new Error("value_mg_dl muss zwischen 20 und 600 mg/dL liegen");
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    value_mg_dl: value,
    measured_at: new Date().toISOString(),
    notes,
  };

  const { data, error } = await sb
    .from("fingerstick_readings")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: data?.id as string | undefined };
}

async function execLogExerciseEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const exerciseType = typeof p.exercise_type === "string" ? p.exercise_type : "";
  const durationMinutes =
    typeof p.duration_minutes === "number" ? p.duration_minutes : null;
  const intensity = typeof p.intensity === "string" ? p.intensity : "";

  if (!exerciseType) throw new Error("exercise_type fehlt");
  if (durationMinutes === null || !Number.isFinite(durationMinutes)) {
    throw new Error("duration_minutes muss eine Zahl sein");
  }
  if (!["low", "medium", "high"].includes(intensity)) {
    throw new Error("intensity muss 'low', 'medium' oder 'high' sein");
  }

  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
  const createdAt = resolveLoggedAt(p.logged_at);

  const { data, error } = await sb
    .from("exercise_logs")
    .insert({
      user_id: userId,
      exercise_type: exerciseType,
      duration_minutes: Math.round(durationMinutes),
      intensity,
      notes,
      created_at: createdAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: (data as { id: string } | null)?.id };
}

async function execLogSymptomEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const symptomTypes = Array.isArray(p.symptom_types) ? p.symptom_types : [];
  if (!symptomTypes.length) throw new Error("symptom_types darf nicht leer sein");
  const severity = typeof p.severity === "number" ? p.severity : null;
  if (severity === null || severity < 1 || severity > 5) {
    throw new Error("severity muss zwischen 1 und 5 liegen");
  }
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
  const occurredAt = resolveLoggedAt(p.logged_at);

  // Build the per-symptom severities JSONB map from the flat severity value.
  const severities: Record<string, number> = {};
  for (const t of symptomTypes) {
    if (typeof t === "string") severities[t] = Math.round(severity);
  }

  const { data, error } = await sb
    .from("symptom_logs")
    .insert({
      user_id: userId,
      symptom_types: symptomTypes,
      severities,
      notes,
      occurred_at: occurredAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: (data as { id: string } | null)?.id };
}

async function execLogInfluenceEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const influenceType = typeof p.influence_type === "string" ? p.influence_type : "";
  const VALID_INFLUENCE_TYPES = [
    "alcohol", "stress", "illness", "medication",
    "sleep_deprivation", "cannabis", "other",
  ];
  if (!VALID_INFLUENCE_TYPES.includes(influenceType)) {
    throw new Error("influence_type ungültig");
  }
  const details =
    typeof p.details === "string" && p.details.trim() ? p.details.trim() : null;
  const amount =
    typeof p.amount === "string" && p.amount.trim() ? p.amount.trim() : null;
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;
  const occurredAt = resolveLoggedAt(p.logged_at);

  const { data, error } = await sb
    .from("influence_logs")
    .insert({
      user_id: userId,
      influence_type: influenceType,
      details,
      amount,
      notes,
      occurred_at: occurredAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: (data as { id: string } | null)?.id };
}

async function execLogCycleEntry(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const startDate = typeof p.start_date === "string" ? p.start_date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("start_date muss YYYY-MM-DD sein");
  }
  const endDate =
    typeof p.end_date === "string" && p.end_date.trim()
      ? p.end_date.trim()
      : null;
  const flowIntensity =
    typeof p.flow_intensity === "string" && p.flow_intensity.trim()
      ? p.flow_intensity.trim()
      : null;
  const phaseMarker =
    typeof p.phase_marker === "string" && p.phase_marker.trim()
      ? p.phase_marker.trim()
      : null;
  const notes =
    typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null;

  if (!flowIntensity && !phaseMarker) {
    throw new Error("flow_intensity oder phase_marker ist Pflicht");
  }

  const { data, error } = await sb
    .from("menstrual_logs")
    .insert({
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
      flow_intensity: flowIntensity,
      phase_marker: phaseMarker,
      notes,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: (data as { id: string } | null)?.id };
}

async function execAddAppointment(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ insertedId?: string }> {
  const date = typeof p.date === "string" ? p.date.trim() : "";
  const note =
    typeof p.note === "string" && p.note.trim() ? p.note.trim() : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date muss YYYY-MM-DD sein");
  }

  const { data, error } = await sb
    .from("appointments")
    .insert({
      user_id: userId,
      appointment_at: date,
      note,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { insertedId: data?.id as string | undefined };
}

type TimelineCheckResult = {
  insertedId?: string;
  scheduleReminder?: {
    mealId: string;
    checkType: string;
    plannedAt: string;
    title: string;
    body: string;
  };
};

async function execUpdateSetting(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<{ updatedSetting?: string }> {
  const setting = typeof p.setting === "string" ? p.setting.trim() : "";
  const rawValue = typeof p.value === "string" ? p.value.trim() : "";

  if (!setting || !rawValue) {
    throw new Error("setting und value sind Pflichtfelder");
  }

  // Map the tool's logical setting name to the user_settings column name.
  const columnMap: Record<string, string> = {
    icr:                "icr",
    target_low_mg_dl:   "target_low",
    target_high_mg_dl:  "target_high",
    correction_factor:  "correction_factor",
    carb_unit:          "carb_unit",
    dia_minutes:        "dia_minutes",
  };
  const column = columnMap[setting];
  if (!column) throw new Error(`Unbekannte Einstellung: ${setting}`);

  // Parse numeric settings; carb_unit stays as string.
  const value: unknown = setting === "carb_unit"
    ? rawValue
    : parseFloat(rawValue);

  if (setting !== "carb_unit" && !Number.isFinite(value as number)) {
    throw new Error(`Ungültiger Wert für ${setting}: ${rawValue}`);
  }

  const { error } = await sb
    .from("user_settings")
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  return { updatedSetting: setting };
}

async function execAddTimelineCheck(
  sb: SupabaseClient,
  userId: string,
  p: Record<string, unknown>,
): Promise<TimelineCheckResult> {
  const mealId = typeof p.meal_id === "string" ? p.meal_id.trim() : "";
  const checkType = typeof p.check_type === "string" ? p.check_type.trim() : "";
  const plannedAt = typeof p.planned_at === "string" ? p.planned_at.trim() : "";
  const mealLabel =
    typeof p.meal_label === "string" && p.meal_label.trim()
      ? p.meal_label.trim()
      : "Mahlzeit";

  if (!mealId) throw new Error("meal_id fehlt");
  if (!/^(pre|post_\d+)$/.test(checkType)) {
    throw new Error("check_type ungültig — erwartet 'pre' oder 'post_N'");
  }
  const plannedMs = new Date(plannedAt).getTime();
  if (!Number.isFinite(plannedMs)) {
    throw new Error("planned_at ist kein gültiger Zeitpunkt");
  }

  const nowIso = new Date().toISOString();

  // Upsert: select-then-update-or-insert (no DB-level unique constraint).
  const { data: existingRows, error: selErr } = await sb
    .from("meal_timeline_checks")
    .select("id")
    .eq("meal_id", mealId)
    .eq("check_type", checkType)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (selErr) throw new Error(selErr.message);

  const existing =
    existingRows && existingRows.length > 0
      ? (existingRows[0] as { id: string })
      : null;

  let insertedId: string | undefined;

  if (existing) {
    const { data, error } = await sb
      .from("meal_timeline_checks")
      .update({ planned_at: plannedAt, confirmed_at: nowIso })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    insertedId = (data as { id: string } | null)?.id;
  } else {
    const { data, error } = await sb
      .from("meal_timeline_checks")
      .insert({
        user_id: userId,
        meal_id: mealId,
        check_type: checkType,
        planned_at: plannedAt,
        confirmed_at: nowIso,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    insertedId = (data as { id: string } | null)?.id;
  }

  // Build the reminder payload so the client can schedule a local OS notification.
  // scheduleCheckReminder is client-side only (Capacitor / Notification API);
  // the server returns this data and the client calls the function after confirming.
  const typeLabel =
    checkType === "pre" ? "Prä-Bolus-Check" : "Post-Bolus-Check";
  const timeStr = new Date(plannedAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    insertedId,
    scheduleReminder: {
      mealId,
      checkType,
      plannedAt,
      title: `Glev: ${typeLabel}`,
      body: `BZ-Check für „${mealLabel}" — ${timeStr} Uhr`,
    },
  };
}
