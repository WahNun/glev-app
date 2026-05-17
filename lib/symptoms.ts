import { supabase } from "./supabase";

/**
 * Standalone symptom event log. Multiple symptoms can be grouped under
 * one entry; each symptom carries its own severity (1..5) via the
 * `severities` map. Used to correlate hormonal/general symptoms with
 * the glucose curve and insulin sensitivity. Pure documentation — no
 * derived calculations.
 *
 * Curated symptom vocabulary. Tokens are stable across releases so
 * stored rows keep their meaning. UI labels are looked up via i18n
 * (engineLog.symptom_<token>). Adding new symptoms is a code change.
 */
export const SYMPTOM_TYPES = [
  "headache",
  "fatigue",
  "cramps",
  "nausea",
  "cravings",
  "low_mood",
  "sleep_disturbance",
  "brain_fog",
  "bloating",
  "anxiety",
  "irritability",
  "back_pain",
  "breast_tenderness",
  "dizziness",
  // Classic hyper-/dehydration markers — useful diabetes context that
  // pairs well with the per-row glucose snapshot below.
  "mouth_dryness",
  "polyuria",
  // PMS-specific addition (Task #PMS-refactor). The other PMS preset
  // labels (Heißhunger / Müdigkeit / Reizbarkeit / Kopfschmerzen /
  // Schlafprobleme / Konzentrationsprobleme) reuse existing tokens
  // above to avoid vocabulary duplication.
  "water_retention",
] as const;

export type SymptomType = typeof SYMPTOM_TYPES[number];
const SYMPTOM_SET: Set<string> = new Set(SYMPTOM_TYPES);
export function isSymptomType(v: unknown): v is SymptomType {
  return typeof v === "string" && SYMPTOM_SET.has(v);
}

/**
 * Symptom category. Each `symptom_logs` row belongs to ONE bucket —
 * either generic body symptoms or PMS / cycle-related ones. The
 * category drives which chip list is shown in the SymptomForm and
 * later feeds the luteal-phase signal in Insights (without
 * overriding any user-set `cycle_phase`).
 */
export const SYMPTOM_CATEGORIES = ["general", "pms"] as const;
export type SymptomCategory = typeof SYMPTOM_CATEGORIES[number];
const SYMPTOM_CATEGORY_SET: Set<string> = new Set(SYMPTOM_CATEGORIES);
export function isSymptomCategory(v: unknown): v is SymptomCategory {
  return typeof v === "string" && SYMPTOM_CATEGORY_SET.has(v);
}

/**
 * Curated PMS chip list. Reuses existing general tokens for the
 * classic four (cravings / fatigue / irritability / headache) plus
 * the diabetes-relevant `sleep_disturbance` (Schlafprobleme),
 * `brain_fog` (Konzentrationsprobleme) and the new
 * `water_retention` (Wassereinlagerung). Order mirrors the spec.
 */
export const PMS_SYMPTOM_TYPES: readonly SymptomType[] = [
  "cramps",
  "bloating",
  "cravings",
  "fatigue",
  "irritability",
  "water_retention",
  "headache",
  "sleep_disturbance",
  "brain_fog",
];

/** Per-symptom severity map. Each key is a symptom token, each value
 *  is an integer 1..5. Keys should mirror `symptom_types` on the same
 *  row (validated by `validateSeverities` below). */
export type SeverityValue = 1 | 2 | 3 | 4 | 5;
export type SeveritiesMap = Partial<Record<SymptomType, SeverityValue>>;

export interface SymptomLog {
  id: string;
  user_id: string;
  created_at: string;
  occurred_at: string;
  symptom_types: SymptomType[];
  /** Per-symptom severity (1..5). Replaces the legacy single
   *  `severity` column. Each entry in `symptom_types` is expected to
   *  have a matching entry here. */
  severities: SeveritiesMap;
  /** Snapshot of the live CGM reading at the moment of logging
   *  (mg/dL). Null when no CGM is connected, when the entry is
   *  logged retroactively, or for legacy rows inserted before this
   *  column existed. */
  cgm_glucose_at_log: number | null;
  /** General body symptoms vs. PMS / cycle-related symptoms.
   *  Defaults to 'general' for legacy rows pre-dating the column. */
  category: SymptomCategory;
  notes: string | null;
}

export interface SymptomLogInput {
  symptom_types: SymptomType[];
  severities: SeveritiesMap;
  occurred_at?: string;        // ISO; defaults to now()
  /** Optional live CGM mg/dL captured by the caller right before the
   *  insert. Pass `null` (or omit) when no reading is available. */
  cgm_glucose_at_log?: number | null;
  /** Optional category — defaults to 'general' on insert. */
  category?: SymptomCategory;
  notes?: string | null;
}

const COLS =
  "id,user_id,created_at,occurred_at,symptom_types,severities,cgm_glucose_at_log,category,notes";

/** Normalises a raw severities map: drops keys not in `types`, coerces
 *  values to integers 1..5, returns `null` if any required key is
 *  missing or any value is out of range. */
export function validateSeverities(
  types: SymptomType[],
  raw: unknown,
): SeveritiesMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SeveritiesMap = {};
  const src = raw as Record<string, unknown>;
  for (const t of types) {
    const v = src[t];
    if (v == null) return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 5) return null;
    out[t] = n as SeverityValue;
  }
  return out;
}

/** Convenience: rounded mean severity across the map, or null when
 *  the map is empty. Used by displays/aggregations that still want a
 *  single "overall" number (e.g. row primary value, insights toast). */
export function avgSeverity(log: Pick<SymptomLog, "severities">): number | null {
  const vals: number[] = [];
  for (const v of Object.values(log.severities ?? {})) {
    if (typeof v === "number") vals.push(v);
  }
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export async function insertSymptomLog(input: SymptomLogInput): Promise<SymptomLog> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error(authErr?.message || "Nicht angemeldet — bitte erneut einloggen.");
  }

  const types = (input.symptom_types || []).filter(isSymptomType);
  if (types.length === 0) throw new Error("Mindestens ein Symptom erforderlich.");
  const severities = validateSeverities(types, input.severities);
  if (!severities) {
    throw new Error("Schweregrad pro Symptom muss zwischen 1 und 5 liegen.");
  }

  const cat: SymptomCategory = isSymptomCategory(input.category)
    ? input.category
    : "general";

  const row: Record<string, unknown> = {
    user_id: user.id,
    symptom_types: types,
    severities,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    cgm_glucose_at_log: input.cgm_glucose_at_log ?? null,
    category: cat,
    notes: input.notes?.trim() || null,
  };

  const { data, error } = await supabase
    .from("symptom_logs")
    .insert(row)
    .select(COLS)
    .single();

  if (error) {
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as SymptomLog;
}

export async function fetchSymptomLogs(
  fromIso?: string,
  toIso?: string,
): Promise<SymptomLog[]> {
  if (!supabase) throw new Error("Supabase is not configured");
  let q = supabase
    .from("symptom_logs")
    .select(COLS)
    .order("occurred_at", { ascending: false });
  if (fromIso) q = q.gte("occurred_at", fromIso);
  if (toIso)   q = q.lte("occurred_at", toIso);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as SymptomLog[];
}

export async function fetchRecentSymptomLogs(days: number): Promise<SymptomLog[]> {
  const fromIso = new Date(Date.now() - days * 86400000).toISOString();
  return fetchSymptomLogs(fromIso);
}

export async function deleteSymptomLog(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("symptom_logs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Update an existing symptom log. Only the user-facing fields are
 * exposed (types, severities, occurred_at, notes, category) — server-
 * side / snapshot columns like `cgm_glucose_at_log` are intentionally
 * not editable so we never falsify a past CGM reading.
 *
 * The caller is expected to pass a sparse `patch` containing only the
 * fields that actually changed. When `symptom_types` is changed,
 * `severities` MUST also be provided so the two stay in sync; the
 * helper validates that every type has a matching severity entry.
 */
export interface SymptomLogPatch {
  symptom_types?: SymptomType[];
  severities?: SeveritiesMap;
  occurred_at?: string;
  notes?: string | null;
  category?: SymptomCategory;
}

export async function updateSymptomLog(
  id: string,
  patch: SymptomLogPatch,
): Promise<SymptomLog> {
  if (!supabase) throw new Error("Supabase is not configured");

  const row: Record<string, unknown> = {};
  // Types + severities are validated together because severities is
  // keyed by type — changing one without the other risks an orphaned
  // or missing entry.
  if (patch.symptom_types !== undefined || patch.severities !== undefined) {
    // Need the final type list to validate severities against. If
    // only one side changed we have to fetch the other from the row.
    let types: SymptomType[];
    let severitiesRaw: unknown;
    if (patch.symptom_types !== undefined) {
      types = (patch.symptom_types || []).filter(isSymptomType);
      if (types.length === 0) throw new Error("Mindestens ein Symptom erforderlich.");
      severitiesRaw = patch.severities;
    } else {
      // Only severities changed — keep existing types.
      const { data: existing, error: fetchErr } = await supabase
        .from("symptom_logs").select("symptom_types").eq("id", id).single();
      if (fetchErr) throw new Error(fetchErr.message);
      types = ((existing as { symptom_types?: unknown })?.symptom_types as SymptomType[] | undefined) || [];
      types = types.filter(isSymptomType);
      severitiesRaw = patch.severities;
    }
    if (severitiesRaw === undefined) {
      throw new Error("severities ist erforderlich wenn sich die Symptom-Auswahl ändert.");
    }
    const severities = validateSeverities(types, severitiesRaw);
    if (!severities) {
      throw new Error("Schweregrad pro Symptom muss zwischen 1 und 5 liegen.");
    }
    if (patch.symptom_types !== undefined) row.symptom_types = types;
    row.severities = severities;
  }
  if (patch.occurred_at !== undefined) row.occurred_at = patch.occurred_at;
  if (patch.notes !== undefined) {
    row.notes = patch.notes?.trim() ? patch.notes.trim() : null;
  }
  if (patch.category !== undefined) {
    if (!isSymptomCategory(patch.category)) {
      throw new Error("Ungültige Kategorie.");
    }
    row.category = patch.category;
  }

  if (Object.keys(row).length === 0) {
    // Nothing to update — refetch the row so callers always get the
    // canonical shape back.
    const { data, error } = await supabase
      .from("symptom_logs").select(COLS).eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as SymptomLog;
  }

  const { data, error } = await supabase
    .from("symptom_logs")
    .update(row)
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) {
    const code = error.code ? ` [${error.code}]` : "";
    throw new Error(`${error.message}${code}`);
  }
  return data as SymptomLog;
}
