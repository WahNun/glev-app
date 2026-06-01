// Shared types & constants for the Dev Cockpit (Phase 2 — persistence).
//
// Imported by both the server side (page.tsx, actions.ts) and the client
// component (DevCockpit.tsx). Keep this file free of "use server" / "use
// client" directives and of any Node-only imports so it can be pulled into
// either environment.

// ── Task ──────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "draft"
  | "planning"
  | "waiting_for_start"
  | "waiting_for_input"
  | "building"
  | "preview_ready"
  | "applied"
  | "rejected"
  | "cancelled"
  | "archived"
  | "backlog";

// NOTE: `waiting_for_input` is a UI-prepared status for Phase 3 (agent asks
// the user a question). It is NOT yet in the DB CHECK constraint nor in the
// server-side ALL_STATUSES validator — nothing writes it in Phase 2. Before
// any task is actually set to it (Phase 3), add it to the CHECK via a small
// migration and to actions.ts ALL_STATUSES.

export interface DevTask {
  id: string;
  title: string;
  prompt: string | null;
  status: TaskStatus;
  branch_name: string | null;
  preview_url: string | null;
  plan_text: string | null;
  diff_summary: string | null;
  changed_files: unknown[];
  created_at: string;
  updated_at: string;
}

// ── Message ───────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface DevMessage {
  id: string;
  task_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

// ── Attachment (metadata only in Phase 2) ──────────────────────────────────

export interface DevAttachment {
  id: string;
  task_id: string;
  file_name: string;
  file_type: string | null;
  file_url_or_storage_path: string | null;
  created_at: string;
}

// ── Prompt Queue ───────────────────────────────────────────────────────────

export type QueueStatus =
  | "queued"
  | "evaluated"
  | "applied"
  | "discarded"
  | "converted_to_task";

export type ImpactLevel = "low" | "medium" | "high";

export type Recommendation =
  | "current_build"
  | "after_build"
  | "separate_task"
  | "discard";

export interface DevQueueNote {
  id: string;
  task_id: string;
  content: string;
  status: QueueStatus;
  impact_level: ImpactLevel | null;
  recommendation: Recommendation | null;
  evaluation_text: string | null;
  created_at: string;
  updated_at: string;
}

// ── Build Plan (Phase 3 — Mistral analysis result) ──────────────────────────

/**
 * Structured output of `analyzeTask()`. Mistral returns exactly this shape as
 * JSON; it is stored (stringified) in `dev_cockpit_tasks.plan_text` and
 * rendered as the "Build Plan" card (never shown as raw JSON).
 */
export interface BuildPlan {
  summary: string;
  affected_areas: string[];
  likely_files: string[];
  risks: string[];
  questions: string[];
  ready_to_build: boolean;
}

// ── Sidebar filters ─────────────────────────────────────────────────────────

export type TaskFilter =
  | "active"
  | "backlog"
  | "archived"
  | "cancelled"
  | "applied"
  | "rejected"
  | "all";

/**
 * "Active" = the in-flight working set shown by default in the sidebar.
 * Everything else (cancelled / archived / backlog / applied / rejected) is
 * reachable via the filter chips.
 */
export const ACTIVE_STATUSES: TaskStatus[] = [
  "draft",
  "planning",
  "waiting_for_start",
  "waiting_for_input",
  "building",
  "preview_ready",
];

/** Which DB statuses each sidebar filter resolves to (null = no status filter). */
export const FILTER_STATUSES: Record<TaskFilter, TaskStatus[] | null> = {
  active: ACTIVE_STATUSES,
  backlog: ["backlog"],
  archived: ["archived"],
  cancelled: ["cancelled"],
  applied: ["applied"],
  rejected: ["rejected"],
  all: null,
};

export const FILTER_LABEL: Record<TaskFilter, string> = {
  active: "Active",
  backlog: "Backlog",
  archived: "Archived",
  cancelled: "Cancelled",
  applied: "Applied",
  rejected: "Rejected",
  all: "All",
};

export const FILTER_ORDER: TaskFilter[] = [
  "active",
  "backlog",
  "archived",
  "cancelled",
  "applied",
  "rejected",
  "all",
];

// ── Status display ──────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Entwurf",
  planning: "Planung",
  waiting_for_start: "Wartet auf Start",
  waiting_for_input: "Wartet auf Input",
  building: "Building",
  preview_ready: "Preview bereit",
  applied: "Angewendet",
  rejected: "Abgelehnt",
  cancelled: "Abgebrochen",
  archived: "Archiviert",
  backlog: "Backlog",
};

export const STATUS_STYLE: Record<TaskStatus, React.CSSProperties> = {
  draft: { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" },
  planning: { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" },
  waiting_for_start: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  waiting_for_input: { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" },
  building: { background: "#ffedd5", color: "#9a3412", border: "1px solid #fed7aa" },
  preview_ready: { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d8b4fe" },
  applied: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  rejected: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
  cancelled: { background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db" },
  archived: { background: "#e5e7eb", color: "#4b5563", border: "1px solid #cbd5e1" },
  backlog: { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" },
};

// Column list used by every task SELECT so the shape always matches DevTask.
export const TASK_COLUMNS =
  "id, title, prompt, status, branch_name, preview_url, plan_text, diff_summary, changed_files, created_at, updated_at";
