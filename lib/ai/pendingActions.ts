/**
 * Shared pending-action payload types for the Glev AI chat.
 *
 * Every WRITE-tool produces a `pending_action` SSE frame that the
 * client shows as an inline confirm/cancel chip. This file declares
 * the discriminated union of all possible action kinds and their
 * payload shapes, shared between:
 *   • server-side tool executors   (lib/ai/glevTools.ts)
 *   • client-side chip rendering  (components/GlevAIChatSheet.tsx)
 *   • useGlevAI.ts navigation/quick-save helpers
 *
 * Payload fields mirror the corresponding tool parameters exactly so
 * the confirm-action route can pass them through without translation.
 */

export type MealEntryPayload = {
  input_text: string;
  carbs_grams: number;
  protein_grams?: number | null;
  fat_grams?: number | null;
  meal_type?: string;
  logged_at?: string;
};

export type ExerciseEntryPayload = {
  exercise_type: string;
  duration_minutes: number;
  intensity: "low" | "medium" | "high";
  notes?: string | null;
  logged_at?: string | null;
};

export type SymptomEntryPayload = {
  symptom_types: string[];
  /** Single severity value 1–5 applied uniformly to all symptom_types.
   *  Stored as a flat number by the AI tool; expanded to a per-type
   *  severities map by execLogSymptomEntry on confirm. */
  severity?: number;
  notes?: string | null;
  logged_at?: string | null;
};

export type InsulinBolusdPayload = {
  units: number;
  insulin_name?: string | null;
  notes?: string | null;
  logged_at?: string | null;
};

export type InsulinBasalPayload = {
  units: number;
  insulin_name?: string | null;
  notes?: string | null;
  logged_at?: string | null;
};

export type FingerstickPayload = {
  value_mg_dl: number;
  notes?: string | null;
};

export type InfluenceEntryPayload = {
  influence_type: string;
  details?: string | null;
  amount?: string | null;
  notes?: string | null;
  logged_at?: string | null;
};

export type CycleEntryPayload = {
  start_date: string;
  end_date?: string | null;
  flow_intensity?: "light" | "medium" | "heavy" | null;
  phase_marker?: "ovulation" | "pms" | "other" | null;
  notes?: string | null;
};

export type AppointmentPayload = {
  date: string;
  note?: string | null;
};

export type TimelineCheckPayload = {
  meal_id: string;
  meal_label?: string;
  check_type: string;
  planned_at: string;
};

export type UpdateSettingPayload = {
  setting: string;
  value: string;
};

export type SaveObservationPayload = {
  key: string;
  value: string;
};

/**
 * Discriminated union of all possible pending-action kinds.
 * The `kind` field matches the tool name exactly so the confirm-action
 * route can dispatch without a separate lookup.
 */
export type PendingActionKind =
  | "log_meal_entry"
  | "log_exercise_entry"
  | "log_symptom_entry"
  | "log_bolus_entry"
  | "log_basal_entry"
  | "log_fingerstick"
  | "log_influence_entry"
  | "log_cycle_entry"
  | "add_appointment"
  | "add_timeline_check"
  | "update_setting"
  | "save_user_observation";

/** All non-meal kinds that use the Quick Save + Detail layout. */
export type NonMealActionKind = Exclude<PendingActionKind, "log_meal_entry">;

/**
 * Per-action-kind navigation config: the Engine tab to open and the
 * DOM event to dispatch so the target screen can pre-populate its form.
 */
export type ActionNavConfig = {
  /** Engine tab query param, e.g. "log" → /engine?tab=log */
  tab: string;
  /** CustomEvent name dispatched before navigation. */
  event: string;
  /** sessionStorage key that receives the serialised payload. */
  storageKey: string;
};

const NAV_CONFIG: Record<NonMealActionKind, ActionNavConfig> = {
  log_exercise_entry: {
    tab: "log",
    event: "glev:open-exercise-log",
    storageKey: "glev_pending_exercise",
  },
  log_symptom_entry: {
    tab: "log",
    event: "glev:open-symptom-log",
    storageKey: "glev_pending_symptom",
  },
  log_bolus_entry: {
    tab: "log",
    event: "glev:open-insulin-log",
    storageKey: "glev_pending_bolus",
  },
  log_basal_entry: {
    tab: "log",
    event: "glev:open-insulin-log",
    storageKey: "glev_pending_basal",
  },
  log_fingerstick: {
    tab: "log",
    event: "glev:open-fingerstick-log",
    storageKey: "glev_pending_fingerstick",
  },
  log_influence_entry: {
    tab: "influences",
    event: "glev:open-influence-log",
    storageKey: "glev_pending_influence",
  },
  log_cycle_entry: {
    tab: "log",
    event: "glev:open-cycle-log",
    storageKey: "glev_pending_cycle",
  },
  add_appointment: {
    tab: "log",
    event: "glev:open-appointment-log",
    storageKey: "glev_pending_appointment",
  },
  add_timeline_check: {
    tab: "log",
    event: "glev:open-timeline-check",
    storageKey: "glev_pending_timeline_check",
  },
  update_setting: {
    tab: "log",
    event: "glev:open-setting-update",
    storageKey: "glev_pending_setting",
  },
  save_user_observation: {
    tab: "log",
    event: "glev:open-observation-save",
    storageKey: "glev_pending_observation",
  },
};

/**
 * Returns the navigation config for a non-meal action kind, or null
 * if the kind is not navigable (e.g. meal) or unrecognised.
 */
export function getActionNavConfig(kind: string): ActionNavConfig | null {
  if (kind === "log_meal_entry") return null;
  return NAV_CONFIG[kind as NonMealActionKind] ?? null;
}

/**
 * Returns a human-readable label and emoji icon for the action kind,
 * used in the chip header of non-meal PendingActionWidgets.
 */
export function getActionMeta(kind: string): { label: string; icon: string } {
  switch (kind) {
    case "log_exercise_entry":    return { icon: "🏃", label: "Sport" };
    case "log_symptom_entry":     return { icon: "🩺", label: "Symptom" };
    case "log_bolus_entry":       return { icon: "💉", label: "Bolus" };
    case "log_basal_entry":       return { icon: "💉", label: "Basal" };
    case "log_fingerstick":       return { icon: "🩸", label: "Fingerst." };
    case "log_influence_entry":   return { icon: "⚡", label: "Einfluss" };
    case "log_cycle_entry":       return { icon: "🌙", label: "Zyklus" };
    case "add_appointment":       return { icon: "📅", label: "Termin" };
    case "add_timeline_check":    return { icon: "⏱", label: "Check" };
    case "update_setting":        return { icon: "⚙️", label: "Einstellung" };
    case "save_user_observation": return { icon: "📝", label: "Notiz" };
    default:                      return { icon: "✏️", label: kind };
  }
}
