/**
 * Appointment list helpers (Task #93). Backed by the `appointments`
 * Postgres table — one row per doctor visit per user — keyed on
 * auth.uid()::text the same way the rest of the per-user tables are.
 *
 * Every read gracefully falls back to an empty array / `null` when
 * Supabase is unavailable, the user is signed out, or RLS denies the
 * query, so callers never have to handle missing-data states. Writes
 * throw so the Settings sheet can surface an inline error and keep the
 * user's input visible (matches the convention `userSettings.ts` uses
 * for `saveLastAppointment`).
 *
 * The `appointment_at` field is a YYYY-MM-DD calendar date — same
 * format as `<input type="date">` emits and Postgres returns for a
 * `date` column via PostgREST. We deliberately keep it as a plain
 * string (not `Date`) because the value has no time-of-day or
 * timezone meaning.
 */

import { supabase } from "./supabase";

export interface Appointment {
  /** UUID — required for edit/delete operations from the Settings list. */
  id: string;
  /** Calendar date the user picked (YYYY-MM-DD). */
  appointmentAt: string;
  /** Optional free-text label ("Endo Q1", "Diabetologe", …). */
  note: string | null;
  /** ISO timestamp the row was last touched — useful for cache busting. */
  updatedAt: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE_RE.test(v);
}

/** Defensive parser. Drops anything that doesn't look like an
 *  appointment row so a stray PostgREST coercion can't break the
 *  Settings list render. */
function parseRow(row: Record<string, unknown> | null | undefined): Appointment | null {
  if (!row) return null;
  if (typeof row.id !== "string" || !row.id) return null;
  if (!isValidIsoDate(row.appointment_at)) return null;
  const note = typeof row.note === "string" && row.note.trim() !== ""
    ? row.note
    : null;
  const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "";
  return {
    id: row.id,
    appointmentAt: row.appointment_at,
    note,
    updatedAt,
  };
}

/**
 * List the signed-in user's appointments, most recent first. Returns
 * an empty array when no rows exist, the user is signed out, or
 * Supabase is unreachable — every caller treats that as "no
 * appointments saved yet", so the fallback is a clean no-op.
 */
export async function fetchAppointments(): Promise<Appointment[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("appointments")
    .select("id, appointment_at, note, updated_at")
    .eq("user_id", user.id)
    .order("appointment_at", { ascending: false });

  if (error || !data) return [];
  return data
    .map((row) => parseRow(row as Record<string, unknown>))
    .filter((row): row is Appointment => row !== null);
}

/**
 * Convenience accessor for the most recent appointment date —
 * equivalent to `fetchAppointments()[0]?.appointmentAt ?? null`. Used
 * by the Export panel to drive the default "Seit letztem Arzttermin"
 * preset chip when the user hasn't picked an older entry.
 */
export async function fetchLatestAppointmentDate(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("appointments")
    .select("appointment_at")
    .eq("user_id", user.id)
    .order("appointment_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return isValidIsoDate(data.appointment_at) ? data.appointment_at : null;
}

/**
 * Insert a new appointment for the signed-in user. The `note` arg is
 * trimmed and an empty string is normalized to `null` so the column
 * stays clean (downstream UI treats "" and null identically). Returns
 * the inserted row so the caller can drop it into local state without
 * a follow-up fetch.
 */
export async function addAppointment(
  appointmentAt: string,
  note: string | null = null,
): Promise<Appointment> {
  if (!supabase) throw new Error("Supabase not configured");
  if (!isValidIsoDate(appointmentAt)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${appointmentAt}`);
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const cleanNote = typeof note === "string" && note.trim() !== ""
    ? note.trim()
    : null;

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      user_id: user.id,
      appointment_at: appointmentAt,
      note: cleanNote,
    })
    .select("id, appointment_at, note, updated_at")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Insert failed");
  const parsed = parseRow(data as Record<string, unknown>);
  if (!parsed) throw new Error("Inserted row failed validation");
  return parsed;
}

/**
 * Update an existing appointment's date and/or note. Both fields are
 * required (full replace) so the caller can't accidentally null out a
 * note by omitting it from a partial update; pass the existing values
 * back through if a single field is being changed. RLS scopes the
 * update to the signed-in user — a foreign id silently affects zero
 * rows rather than throwing, which is the safest behaviour.
 */
export async function updateAppointment(
  id: string,
  appointmentAt: string,
  note: string | null,
): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  if (!isValidIsoDate(appointmentAt)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${appointmentAt}`);
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const cleanNote = typeof note === "string" && note.trim() !== ""
    ? note.trim()
    : null;

  const { error } = await supabase
    .from("appointments")
    .update({
      appointment_at: appointmentAt,
      note: cleanNote,
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

/**
 * Delete an appointment by id. RLS scopes the delete to the
 * signed-in user; a foreign id is a no-op rather than an error.
 */
export async function deleteAppointment(id: string): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}
