"use client";

// Dev Cockpit — Phase 2 (persistent task management).
//
// Keeps the entire Phase-1 layout (Task Sidebar, Task Detail, Prompt area,
// Prompt Queue, Preview placeholder, Diff placeholder) but swaps the local
// mock state for real persisted data via the server actions in ./actions.ts.
//
// In scope: persistence, task CRUD/status, sidebar filters, right-click
// context menu (Cancel / Archive / Move to Backlog), prompt → task + first
// message, queue notes. NOT in scope (later phases): AI calls, GitHub
// branches, Vercel previews, diff fetching, voice, real file uploads, agent
// execution — those controls stay visibly disabled / "coming".

import { useEffect, useRef, useState } from "react";
import GlevLogo from "@/components/GlevLogo";
import DevCockpitPhaseProgress from "./DevCockpitPhaseProgress";
import {
  listTasks,
  getTask,
  createTask,
  cancelTask,
  archiveTask,
  moveTaskToBacklog,
  listMessages,
  listQueueNotes,
  addQueueNote,
  discardQueueNote,
  applyQueueNoteToCurrentBuild,
  applyQueueNoteAfterBuild,
  convertQueueNoteToTask,
  listAttachments,
  addMessage,
} from "./actions";
import {
  STATUS_LABEL,
  STATUS_STYLE,
  FILTER_ORDER,
  FILTER_LABEL,
  type DevTask,
  type DevMessage,
  type DevQueueNote,
  type DevAttachment,
  type TaskStatus,
  type TaskFilter,
  type BuildPlan,
  type BuildExecutionPlan,
} from "./types";

// Parse a task's stored plan_text (JSON) into a BuildPlan, or null if none/invalid.
function parsePlan(planText: string | null): BuildPlan | null {
  if (!planText) return null;
  try {
    const p = JSON.parse(planText) as Partial<BuildPlan>;
    return {
      summary: typeof p.summary === "string" ? p.summary : "",
      affected_areas: Array.isArray(p.affected_areas) ? p.affected_areas : [],
      likely_files: Array.isArray(p.likely_files) ? p.likely_files : [],
      assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
      risks: Array.isArray(p.risks) ? p.risks : [],
      questions: Array.isArray(p.questions) ? p.questions : [],
      ready_to_build: p.ready_to_build === true,
    };
  } catch {
    return null;
  }
}

// Parse a task's stored build_plan (jsonb) into a BuildExecutionPlan, or null.
function parseBuildPlan(raw: unknown): BuildExecutionPlan | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const p = obj as Partial<BuildExecutionPlan>;
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
  return {
    scope: typeof p.scope === "string" ? p.scope : "",
    steps: arr(p.steps),
    included_notes: arr(p.included_notes),
    excluded_notes: arr(p.excluded_notes),
    affected_areas: arr(p.affected_areas),
    risks: arr(p.risks),
    complexity: p.complexity === "low" || p.complexity === "high" ? p.complexity : "medium",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
        ...STATUS_STYLE[status],
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Status indicator (left of the title in the sidebar) ─────────────────────
//
// Built from the existing Glev logo (components/GlevLogo) so the cockpit reuses
// the app's brand mark instead of a generic spinner. One CSS keyframe (dc-spin)
// is injected once via <KeyframeStyles/>; this file uses inline styles only.

const GLEV_BLUE = "#4F6EF7";

function KeyframeStyles() {
  return (
    <style>{`
      @keyframes dc-spin { to { transform: rotate(360deg); } }
    `}</style>
  );
}

const indicatorBox: React.CSSProperties = {
  width: 18,
  height: 18,
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const ICON = { width: 14, height: 14 } as const;

// Static (non-rotating) Glev logo tinted to a status colour.
function GlevStatic({ color, title, label }: { color: string; title: string; label: string }) {
  return (
    <span style={indicatorBox} title={title} aria-label={label}>
      <GlevLogo size={18} color={color} bg="transparent" />
    </span>
  );
}

/**
 * Per-task sidebar status indicator using the Glev logo.
 * `animated` = this task is currently analyzing (transient UI state), so multiple
 * tasks can spin at once.
 *  - analyzing / planning / building → Glev icon rotates (slow, linear, blue + glow)
 *  - waiting_for_input → static yellow Glev icon
 *  - waiting_for_start / preview_ready → static green Glev icon
 *  - applied → green check · rejected → red X · cancelled → grey X
 *  - draft / archived / backlog → static muted-grey Glev icon
 */
function StatusIndicator({ status, animated }: { status: TaskStatus; animated?: boolean }) {
  const spinning =
    animated ||
    status === "planning" ||
    status === "planning_build" ||
    status === "building";

  if (spinning) {
    return (
      <span style={indicatorBox} title="Agent arbeitet…" aria-label={`${status} (aktiv)`}>
        <span
          style={{
            display: "inline-flex",
            animation: "dc-spin 2.6s linear infinite",
            filter: `drop-shadow(0 0 4px ${GLEV_BLUE}aa)`,
          }}
        >
          <GlevLogo size={18} color={GLEV_BLUE} bg="transparent" />
        </span>
      </span>
    );
  }

  switch (status) {
    case "waiting_for_input":
      return <GlevStatic color="#eab308" title="Agent benötigt Input" label="waiting_for_input" />;
    case "waiting_for_start":
      return <GlevStatic color="#16a34a" title="Plan fertig — bereit für Start Build" label="waiting_for_start" />;
    case "build_ready":
      return <GlevStatic color="#16a34a" title="Build Plan fertig" label="build_ready" />;
    case "preview_ready":
      return <GlevStatic color="#16a34a" title="Build fertig — Apply Changes" label="preview_ready" />;
    case "applied":
    case "build_complete":
      return (
        <span style={indicatorBox} title={STATUS_LABEL[status]} aria-label={status}>
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      );
    case "rejected":
    case "build_failed":
      return (
        <span style={indicatorBox} title={STATUS_LABEL[status]} aria-label={status}>
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={3} strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </span>
      );
    case "cancelled":
      return (
        <span style={indicatorBox} title="Abgebrochen" aria-label="cancelled">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={3} strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </span>
      );
    case "draft":
    case "archived":
    case "backlog":
    default:
      return <GlevStatic color="#cbd5e1" title={STATUS_LABEL[status]} label={status} />;
  }
}

// Counts of the three "needs-attention" statuses, for the summary chips.
type Summary = { building: number; waiting_for_input: number; preview_ready: number };
function countSummary(list: DevTask[]): Summary {
  const c: Summary = { building: 0, waiting_for_input: 0, preview_ready: 0 };
  for (const t of list) {
    if (t.status === "building") c.building++;
    else if (t.status === "waiting_for_input") c.waiting_for_input++;
    else if (t.status === "preview_ready") c.preview_ready++;
  }
  return c;
}

function SummaryChip({
  label,
  count,
  palette,
  onClick,
}: {
  label: string;
  count: number;
  palette: { bg: string; color: string; border: string };
  onClick?: () => void;
}) {
  const active = count > 0;
  return (
    <button
      onClick={onClick}
      title={`${label}: ${count}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: active ? palette.bg : "#f9fafb",
        color: active ? palette.color : "#9ca3af",
        border: `1px solid ${active ? palette.border : "#e5e7eb"}`,
        opacity: active ? 1 : 0.7,
      }}
    >
      {label}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 16,
          height: 16,
          padding: "0 4px",
          borderRadius: 8,
          background: active ? palette.color : "#d1d5db",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {count}
      </span>
    </button>
  );
}

// One titled list block inside the Build Plan card. Hidden when empty.
function PlanSection({
  title,
  items,
  mono,
  accent,
}: {
  title: string;
  items: string[];
  mono?: boolean;
  accent?: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: accent ?? "#6b7280",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              color: "#111",
              fontFamily: mono
                ? "ui-monospace, SFMono-Regular, Menlo, monospace"
                : undefined,
              wordBreak: mono ? "break-all" : "normal",
            }}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const ERR_LABEL: Record<string, string> = {
  auth: "Session abgelaufen — bitte neu einloggen.",
  "building-cannot-archive":
    "Ein laufender Build kann nicht archiviert werden. Erst abbrechen (Cancel).",
  "analysis-failed":
    "Mistral-Analyse fehlgeschlagen. Status unverändert — siehe System-Nachricht im Chat.",
};
function errText(code: string): string {
  return ERR_LABEL[code] ?? `Fehler: ${code}`;
}

// ── Queue evaluation badge styling (Phase 4) ────────────────────────────────
const IMPACT_STYLE: Record<string, React.CSSProperties> = {
  low: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  medium: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  high: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};
const REC_LABEL: Record<string, string> = {
  current_build: "Aktueller Build",
  after_build: "Nach Build",
  separate_task: "Separate Task",
  discard: "Verwerfen",
};
const REC_STYLE: Record<string, React.CSSProperties> = {
  current_build: { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" },
  after_build: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  separate_task: { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d8b4fe" },
  discard: { background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" },
};
const QUEUE_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  evaluated: "Evaluated",
  applied: "Applied",
  after_build_pending: "After Build",
  discarded: "Discarded",
  converted_to_task: "→ Task",
};
function evalBadge(style: React.CSSProperties, text: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        ...style,
      }}
    >
      {text}
    </span>
  );
}

// Enabled queue-note action button style (disabled handled via the attribute).
function qBtn(danger: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: "#fff",
    color: danger ? "#991b1b" : "#374151",
    border: `1px solid ${danger ? "#fca5a5" : "#d1d5db"}`,
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "system-ui, -apple-system, sans-serif",
    cursor: "pointer",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DevCockpit({ initialTasks }: { initialTasks: DevTask[] }) {
  const [tasks, setTasks] = useState<DevTask[]>(initialTasks);
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTasks[0]?.id ?? null,
  );
  const [promptText, setPromptText] = useState("");
  const [queueText, setQueueText] = useState("");
  const [answerText, setAnswerText] = useState("");

  const [messages, setMessages] = useState<DevMessage[]>([]);
  const [queue, setQueue] = useState<DevQueueNote[]>([]);
  const [attachments, setAttachments] = useState<DevAttachment[]>([]);

  // ── Per-task / per-action pending state (NO global blocking) ───────────────
  // Each long/async action tracks ONLY the affected task(s), so the rest of the
  // UI stays fully responsive. There is deliberately no shared useTransition /
  // global isPending.
  //
  // analyzingIds        — tasks whose analysis is in flight (spinning icon; many at once)
  // actionPendingByTaskId — cancel/archive/backlog in flight, per task
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(() => new Set());
  // Phase 5 — tasks whose build plan is being generated (parallel allowed).
  const [buildingTaskIds, setBuildingTaskIds] = useState<Set<string>>(() => new Set());
  const [actionPendingByTaskId, setActionPendingByTaskId] = useState<
    Record<string, "cancel" | "archive" | "backlog">
  >({});
  // Small independent pending flags for the central composer actions.
  const [creating, setCreating] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [answering, setAnswering] = useState(false);

  // Per-queue-note pending (Phase 4) — only the affected note shows loading.
  // evaluatingNoteIds = Mistral evaluation in flight; noteBusyIds = a quick
  // apply/convert/discard in flight. Both keyed by note id.
  const [evaluatingNoteIds, setEvaluatingNoteIds] = useState<Set<string>>(() => new Set());
  const [noteBusyIds, setNoteBusyIds] = useState<Set<string>>(() => new Set());

  // The task_id whose detail (messages/queue/attachments) is currently valid.
  // Updated synchronously on every switch so out-of-order async loads can be
  // discarded — prevents one task's data from overwriting another's.
  const activeTaskIdRef = useRef<string | null>(selectedId);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: DevTask; x: number; y: number } | null>(
    null,
  );

  // Summary chip counts — seeded from the initial (active) load so there's no
  // flash, then kept globally accurate via refreshSummary() (all statuses).
  const [summary, setSummary] = useState<Summary>(() => countSummary(initialTasks));

  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Helper: run an async action without any global pending/transition. Errors
  // are surfaced as a toast and never block the rest of the UI.
  function run(fn: () => Promise<void>) {
    fn().catch((e) => setError(errText(e?.message ?? "unknown")));
  }

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const plan = selectedTask ? parsePlan(selectedTask.plan_text) : null;
  const buildPlan = selectedTask ? parseBuildPlan(selectedTask.build_plan) : null;

  // ── Data loading ────────────────────────────────────────────────────────────

  // Recompute the summary chips from ALL tasks (not just the current filter),
  // so the at-a-glance counts stay correct regardless of which filter is open.
  // Uses the existing listTasks action — no new server action.
  async function refreshSummary() {
    const res = await listTasks("all");
    if (res.ok) setSummary(countSummary(res.data));
  }

  function refreshList(nextFilter: TaskFilter) {
    run(async () => {
      const res = await listTasks(nextFilter);
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      setTasks(res.data);
      // Drop selection if the selected task fell out of the new view.
      setSelectedId((cur) =>
        cur && res.data.some((t) => t.id === cur) ? cur : res.data[0]?.id ?? null,
      );
    });
  }

  function loadTaskDetail(taskId: string) {
    run(async () => {
      const [m, q, a] = await Promise.all([
        listMessages(taskId),
        listQueueNotes(taskId),
        listAttachments(taskId),
      ]);
      // Discard stale responses: only apply if this task is still selected.
      // Without this, a slow load for an earlier task can land after a newer
      // one and overwrite the current task's messages/queue (cross-task leak).
      if (activeTaskIdRef.current !== taskId) return;
      if (m.ok) setMessages(m.data);
      if (q.ok) setQueue(q.data);
      if (a.ok) setAttachments(a.data);
    });
  }

  // Load detail whenever the selected task changes. We update the active-id ref
  // synchronously and clear the previous task's transient state immediately so
  // no other task's messages/queue can flash before this task's load resolves.
  // (The Build Plan + status come from the task row itself, so they stay stable
  // and persistent across switches/reloads — they never depend on this load.)
  useEffect(() => {
    activeTaskIdRef.current = selectedId;
    setMessages([]);
    setQueue([]);
    setAttachments([]);
    if (!selectedId) return;
    loadTaskDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Keep the summary chips globally accurate on mount.
  useEffect(() => {
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the context menu on any outside click / escape.
  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Auto-clear transient notices.
  useEffect(() => {
    if (!notice && !error) return;
    const t = setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 4000);
    return () => clearTimeout(t);
  }, [notice, error]);

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleFilterChange(next: TaskFilter) {
    setFilter(next);
    refreshList(next);
  }

  // "+ New Task" — clear the composer for a fresh task and focus it.
  function handleStartCompose() {
    setSelectedId(null);
    setPromptText("");
    setTimeout(() => promptRef.current?.focus(), 0);
  }

  // The prompt box ALWAYS creates a NEW task — no hidden "save/edit" mode.
  // Independent `creating` flag — never blocks other actions.
  function handleCreateTask() {
    if (creating) return;
    const prompt = promptText.trim();
    setCreating(true);
    run(async () => {
      try {
        const res = await createTask({ prompt });
        if (!res.ok) {
          setError(errText(res.error));
          return;
        }
        setPromptText("");
        setNotice("Task erstellt.");
        // New task is a draft → it belongs to the Active view. Switch there so
        // it's visible regardless of the current filter, then select it.
        setFilter("active");
        const listRes = await listTasks("active");
        if (listRes.ok) setTasks(listRes.data);
        setSelectedId(res.data.id);
        refreshSummary();
      } finally {
        setCreating(false);
      }
    });
  }

  // Phase 3 — Analyze Task with Mistral (plan only). Runs PER-TASK via a route
  // handler (fetch) so it stays OFF the Server-Action queue and never blocks
  // task switching / cancel / archive / create. The analyzed task spins in the
  // sidebar (analyzingIds) until done, independently of the current selection.
  function handleAnalyze() {
    if (!selectedTask) {
      setError("Erst eine Task auswählen.");
      return;
    }
    const id = selectedTask.id;
    if (analyzingIds.has(id)) return; // only this task's button is "busy"
    setAnalyzingIds((prev) => new Set(prev).add(id));
    setNotice("Analysiere mit Mistral…");
    run(async () => {
      try {
        const r = await fetch("/glev-ops/dev-cockpit/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: id }),
        });
        const res = (await r.json().catch(() => ({ ok: false, error: "bad-response" }))) as
          | { ok: true; task: DevTask; plan: BuildPlan }
          | { ok: false; error: string };

        if (!res.ok) {
          setError(errText(res.error));
          if (activeTaskIdRef.current === id) loadTaskDetail(id);
          return;
        }
        // Update the task row by id (correct even if the user switched away).
        // Build Plan + status read from this row → analysis stays visible.
        setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
        if (activeTaskIdRef.current === id) loadTaskDetail(id);
        refreshSummary();
        setNotice(
          res.plan.ready_to_build
            ? "Analyse fertig — bereit für Start Build."
            : "Analyse fertig — Rückfragen offen.",
        );
      } finally {
        setAnalyzingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  // Phase 5 — Start Build: generate a build plan (PLAN ONLY, no code). Per-task
  // via a route handler so multiple tasks can plan builds in parallel (no global
  // lock). Optimistically flips the task to planning_build so the icon spins.
  function handleStartBuild() {
    if (!selectedTask) {
      setError("Erst eine Task auswählen.");
      return;
    }
    const id = selectedTask.id;
    if (buildingTaskIds.has(id)) return;
    setBuildingTaskIds((prev) => new Set(prev).add(id));
    // Optimistic: show planning_build immediately (spinning Glev icon).
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "planning_build" } : t)),
    );
    setNotice("Erstelle Build Plan…");
    run(async () => {
      try {
        const r = await fetch("/glev-ops/dev-cockpit/api/start-build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: id }),
        });
        const res = (await r.json().catch(() => ({ ok: false, error: "bad-response" }))) as
          | { ok: true; task: DevTask; build_plan: BuildExecutionPlan }
          | { ok: false; error: string };

        if (!res.ok) {
          setError(errText(res.error));
          // Reflect build_failed by reloading the row (server set it) + messages.
          const t = await getTask(id);
          if (t.ok) setTasks((prev) => prev.map((x) => (x.id === id ? t.data : x)));
          if (activeTaskIdRef.current === id) loadTaskDetail(id);
          return;
        }
        setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
        if (activeTaskIdRef.current === id) loadTaskDetail(id);
        refreshSummary();
        setNotice("Build Plan erstellt — bereit.");
      } finally {
        setBuildingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  // Phase 3 — user answers a follow-up question; stored as a user message.
  function handleSendAnswer() {
    if (!selectedTask || answering) return;
    const text = answerText.trim();
    if (!text) return;
    const id = selectedTask.id;
    setAnswering(true);
    run(async () => {
      try {
        const res = await addMessage(id, "user", text);
        if (!res.ok) {
          setError(errText(res.error));
          return;
        }
        // Only append to the visible chat if we're still on that task.
        if (activeTaskIdRef.current === id) setMessages((prev) => [...prev, res.data]);
        setAnswerText("");
        setNotice("Antwort gespeichert — jetzt Re-Analyze.");
      } finally {
        setAnswering(false);
      }
    });
  }

  function handleAddToQueue() {
    if (!selectedTask) {
      setError("Erst eine Task auswählen oder erstellen.");
      return;
    }
    if (queueing) return;
    const id = selectedTask.id;
    const text = queueText.trim();
    if (!text) return;
    setQueueing(true);
    run(async () => {
      try {
        const res = await addQueueNote(id, text);
        if (!res.ok) {
          setError(errText(res.error));
          return;
        }
        if (activeTaskIdRef.current === id) setQueue((prev) => [res.data, ...prev]);
        setQueueText("");
        setNotice("Queue-Notiz gespeichert.");
      } finally {
        setQueueing(false);
      }
    });
  }

  // Replace a note in the visible queue, but only if it still belongs to the
  // selected task (the user may have switched away during an async action).
  function applyNoteUpdate(note: DevQueueNote) {
    if (activeTaskIdRef.current !== note.task_id) return;
    setQueue((prev) => prev.map((q) => (q.id === note.id ? note : q)));
  }

  // Phase 4 — Evaluate a single queue note with Mistral (per-note, non-blocking
  // route handler). Only this note shows loading; everything else stays usable.
  function handleEvaluateNote(noteId: string) {
    if (evaluatingNoteIds.has(noteId)) return;
    setEvaluatingNoteIds((prev) => new Set(prev).add(noteId));
    run(async () => {
      try {
        const r = await fetch("/glev-ops/dev-cockpit/api/evaluate-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteId }),
        });
        const res = (await r.json().catch(() => ({ ok: false, error: "bad-response" }))) as
          | { ok: true; note: DevQueueNote }
          | { ok: false; error: string };
        if (!res.ok) {
          setError(errText(res.error));
          return;
        }
        applyNoteUpdate(res.note);
        setNotice("Queue-Notiz bewertet.");
      } finally {
        setEvaluatingNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    });
  }

  // Quick per-note action (apply current / apply after / discard) — per-note
  // pending via noteBusyIds; never blocks other notes or the rest of the UI.
  function runNoteAction(
    noteId: string,
    fn: (id: string) => Promise<{ ok: boolean; error?: string; data?: DevQueueNote }>,
    successMsg: string,
  ) {
    if (noteBusyIds.has(noteId)) return;
    setNoteBusyIds((prev) => new Set(prev).add(noteId));
    run(async () => {
      try {
        const res = await fn(noteId);
        if (!res.ok) {
          setError(errText(res.error ?? "unknown"));
          return;
        }
        if (res.data) applyNoteUpdate(res.data);
        setNotice(successMsg);
      } finally {
        setNoteBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    });
  }

  // Convenience: evaluate every still-"queued" note of the selected task.
  function handleEvaluateAllQueued() {
    const pending = queue.filter((q) => q.status === "queued");
    if (pending.length === 0) {
      setNotice("Keine offenen Queue-Notizen zum Bewerten.");
      return;
    }
    for (const q of pending) handleEvaluateNote(q.id);
  }

  function handleApplyCurrent(noteId: string) {
    runNoteAction(noteId, applyQueueNoteToCurrentBuild, "In aktuellen Build übernommen.");
  }
  function handleApplyAfter(noteId: string) {
    runNoteAction(noteId, applyQueueNoteAfterBuild, "Für späteren Build vorgemerkt.");
  }
  function handleDiscardQueue(noteId: string) {
    runNoteAction(noteId, discardQueueNote, "Queue-Notiz verworfen.");
  }

  // Create New Task from a queue note → note becomes converted_to_task, a new
  // draft task is created and selected.
  function handleConvertNote(noteId: string) {
    if (noteBusyIds.has(noteId)) return;
    setNoteBusyIds((prev) => new Set(prev).add(noteId));
    run(async () => {
      try {
        const res = await convertQueueNoteToTask(noteId);
        if (!res.ok) {
          setError(errText(res.error));
          return;
        }
        applyNoteUpdate(res.data.note);
        setNotice("Neue Task aus Queue-Notiz erstellt.");
        setFilter("active");
        const listRes = await listTasks("active");
        if (listRes.ok) setTasks(listRes.data);
        setSelectedId(res.data.task.id);
        refreshSummary();
      } finally {
        setNoteBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(noteId);
          return next;
        });
      }
    });
  }

  // Cancel / Archive / Backlog — per-task pending (actionPendingByTaskId). Runs
  // independently of any analysis and never waits for it.
  function runStatusChange(
    task: DevTask,
    action: "cancel" | "archive" | "backlog",
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    successMsg: string,
  ) {
    setMenu(null);
    if (actionPendingByTaskId[task.id]) return;
    setActionPendingByTaskId((prev) => ({ ...prev, [task.id]: action }));
    run(async () => {
      try {
        const res = await fn(task.id);
        if (!res.ok) {
          setError(errText(res.error ?? "unknown"));
          return;
        }
        setNotice(successMsg);
        // Re-fetch the current filter so the task moves in/out of view correctly.
        const listRes = await listTasks(filter);
        if (listRes.ok) {
          setTasks(listRes.data);
          setSelectedId((cur) =>
            cur && listRes.data.some((t) => t.id === cur)
              ? cur
              : listRes.data[0]?.id ?? null,
          );
        }
        refreshSummary();
      } finally {
        setActionPendingByTaskId((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={pageStyle}>
      <KeyframeStyles />
      {/* ── Page heading ── */}
      <div style={pageHeaderStyle}>
        <h1 style={headingStyle}>Dev Cockpit</h1>
        <DevCockpitPhaseProgress />
        {analyzingIds.size > 0 && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {analyzingIds.size === 1 ? "Analyse läuft…" : `${analyzingIds.size} Analysen laufen…`}
          </span>
        )}
        {buildingTaskIds.size > 0 && (
          <span style={{ fontSize: 12, color: "#3730a3" }}>
            {buildingTaskIds.size === 1 ? "Build-Plan läuft…" : `${buildingTaskIds.size} Build-Pläne laufen…`}
          </span>
        )}
      </div>

      {/* ── Toast / notice ── */}
      {(error || notice) && (
        <div
          style={{
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            ...(error
              ? { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }
              : { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }),
          }}
        >
          {error ?? notice}
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <div style={mainGridStyle}>
        {/* Left Sidebar */}
        <aside style={sidebarStyle}>
          <div style={sidebarHeaderStyle}>
            <span style={sectionLabelStyle}>Tasks</span>
            <button style={newTaskBtnStyle} onClick={handleStartCompose}>
              + New Task
            </button>
          </div>

          {/* Summary chips — at-a-glance "needs attention" counts (global).
              Click jumps to the Active view where these statuses live. */}
          <div style={summaryRowStyle}>
            <SummaryChip
              label="Building"
              count={summary.building}
              palette={{ bg: "#ffedd5", color: "#9a3412", border: "#fed7aa" }}
              onClick={() => handleFilterChange("active")}
            />
            <SummaryChip
              label="Waiting"
              count={summary.waiting_for_input}
              palette={{ bg: "#fef9c3", color: "#854d0e", border: "#fde047" }}
              onClick={() => handleFilterChange("active")}
            />
            <SummaryChip
              label="Ready"
              count={summary.preview_ready}
              palette={{ bg: "#dcfce7", color: "#166534", border: "#86efac" }}
              onClick={() => handleFilterChange("active")}
            />
          </div>

          {/* Filter chips */}
          <div style={filterRowStyle}>
            {FILTER_ORDER.map((f) => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                style={
                  filter === f
                    ? { ...filterChipStyle, ...filterChipActiveStyle }
                    : filterChipStyle
                }
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <div style={taskListStyle}>
            {tasks.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 13, padding: "16px 14px", margin: 0 }}>
                Keine Tasks in diesem Filter.
              </p>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedId(task.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ task, x: e.clientX, y: e.clientY });
                  }}
                  style={
                    selectedId === task.id
                      ? { ...taskItemStyle, ...taskItemActiveStyle }
                      : taskItemStyle
                  }
                >
                  <div style={taskTitleRowStyle}>
                    <StatusIndicator status={task.status} animated={analyzingIds.has(task.id)} />
                    <span style={taskTitleTextStyle}>{task.title}</span>
                  </div>
                  <div style={taskMetaStyle}>
                    <StatusBadge status={task.status} />
                    <span style={taskDateTextStyle}>{fmtDate(task.created_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Central area */}
        <main style={centralStyle}>
          {/* Task Details card */}
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Task Details</h2>
            {selectedTask ? (
              <>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Titel</span>
                  <span style={{ fontWeight: 600, color: "#111", fontSize: 14 }}>
                    {selectedTask.title}
                  </span>
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Current Status</span>
                  <StatusBadge status={selectedTask.status} />
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Erstellt</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>
                    {fmtDate(selectedTask.created_at)}
                  </span>
                </div>

                {/* Status hint banners (Phase 3) */}
                {selectedTask.status === "waiting_for_input" && (
                  <div style={bannerWaitingInput}>
                    ⏳ Agent benötigt zusätzliche Informationen.
                  </div>
                )}
                {selectedTask.status === "waiting_for_start" && (
                  <div style={bannerWaitingStart}>
                    ✅ Plan abgeschlossen. Bereit für Start Build.
                  </div>
                )}

                {/* Chat / message history */}
                {messages.length === 0 ? (
                  <div style={chatPlaceholderStyle}>Noch keine Nachrichten.</div>
                ) : (
                  <div style={chatListStyle}>
                    {messages.map((m) => (
                      <div key={m.id} style={msgBubbleStyle(m.role)}>
                        <span style={msgRoleStyle}>{m.role}</span>
                        <p style={{ margin: "2px 0 0", fontSize: 13, lineHeight: 1.45, color: "#111", whiteSpace: "pre-wrap" }}>
                          {m.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Follow-up answer + Analyze / Re-Analyze (Phase 3) */}
                <div style={{ marginTop: 14 }}>
                  <textarea
                    style={{ ...textareaStyle, minHeight: 0 }}
                    placeholder="Antwort an den Agent schreiben (wird als Nachricht gespeichert)…  (⌘/Strg+Enter)"
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSendAnswer();
                      }
                    }}
                    rows={2}
                  />
                  <div style={buttonGroupStyle}>
                    <button
                      style={btnSecondaryStyle}
                      onClick={handleSendAnswer}
                      disabled={answering}
                    >
                      {answering ? "Speichert…" : "Antwort senden"}
                    </button>
                    <button
                      style={btnSecondaryStyle}
                      onClick={handleAnalyze}
                      disabled={analyzingIds.has(selectedTask.id)}
                      title="Mistral analysiert die Aufgabe (nur Planung, kein Build)"
                    >
                      {analyzingIds.has(selectedTask.id)
                        ? "Analysiere…"
                        : plan
                          ? "Re-Analyze"
                          : "Analyze Task"}
                    </button>
                    <button
                      style={btnPrimaryStyle}
                      onClick={handleStartBuild}
                      disabled={buildingTaskIds.has(selectedTask.id)}
                      title="Erzeugt einen strukturierten Build Plan (nur Plan, keine Code-Ausführung)"
                    >
                      {buildingTaskIds.has(selectedTask.id)
                        ? "Build-Plan…"
                        : buildPlan
                          ? "Re-Plan Build"
                          : "Start Build"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>
                Keine Task ausgewählt.
              </p>
            )}
          </section>

          {/* Analyse-Plan card (Phase 3) — rendered from plan_text, never as JSON */}
          {selectedTask && plan && (
            <section style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  margin: "0 0 14px",
                  paddingBottom: 10,
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <h2 style={{ ...cardTitleStyle, margin: 0, padding: 0, border: "none" }}>
                  Analyse-Plan
                </h2>
                <span style={plan.ready_to_build ? readyPill : notReadyPill}>
                  {plan.ready_to_build ? "Ready To Build" : "Rückfragen offen"}
                </span>
              </div>

              {plan.summary && (
                <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.5, color: "#111", whiteSpace: "pre-wrap" }}>
                  {plan.summary}
                </p>
              )}

              <PlanSection title="Betroffene Bereiche" items={plan.affected_areas} />
              <PlanSection title="Vermutete Dateien" items={plan.likely_files} mono />
              <PlanSection title="Annahmen" items={plan.assumptions} accent="#1e40af" />
              <PlanSection title="Risiken" items={plan.risks} />
              <PlanSection title="Offene Fragen" items={plan.questions} accent="#92400e" />

              {plan.affected_areas.length === 0 &&
                plan.likely_files.length === 0 &&
                plan.assumptions.length === 0 &&
                plan.risks.length === 0 &&
                plan.questions.length === 0 &&
                !plan.summary && (
                  <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
                    Noch kein Analyse-Inhalt.
                  </p>
                )}
            </section>
          )}

          {/* Build Plan card (Phase 5) — rendered from build_plan, never as JSON */}
          {selectedTask && buildPlan && (
            <section style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  margin: "0 0 14px",
                  paddingBottom: 10,
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                <h2 style={{ ...cardTitleStyle, margin: 0, padding: 0, border: "none" }}>
                  Build Plan
                </h2>
                <span style={complexityPill(buildPlan.complexity)}>
                  Komplexität: {buildPlan.complexity}
                </span>
              </div>

              {/* Build Scope */}
              {buildPlan.scope && (
                <div style={{ marginBottom: 12 }}>
                  <div style={planSectionTitle}>Build Scope</div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#111", whiteSpace: "pre-wrap" }}>
                    {buildPlan.scope}
                  </p>
                </div>
              )}

              {/* Build Steps (ordered) */}
              {buildPlan.steps.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={planSectionTitle}>Build Steps</div>
                  <ol style={{ margin: 0, padding: "0 0 0 20px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {buildPlan.steps.map((s, i) => (
                      <li key={i} style={{ fontSize: 13, lineHeight: 1.45, color: "#111" }}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Included (current build) */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ ...planSectionTitle, color: "#166534" }}>
                  Included ({buildPlan.included_notes.length})
                </div>
                {buildPlan.included_notes.length > 0 ? (
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, color: "#166534" }}>
                    {buildPlan.included_notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                ) : (
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>keine zusätzlichen Current-Build-Notes</span>
                )}
              </div>

              {/* Excluded (after build) */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ ...planSectionTitle, color: "#9a3412" }}>
                  Excluded — später ({buildPlan.excluded_notes.length})
                </div>
                {buildPlan.excluded_notes.length > 0 ? (
                  <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 13, color: "#9a3412" }}>
                    {buildPlan.excluded_notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                ) : (
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>keine</span>
                )}
              </div>

              <PlanSection
                title={`Betroffene Bereiche (${buildPlan.affected_areas.length})`}
                items={buildPlan.affected_areas}
              />
              <PlanSection title="Risiken" items={buildPlan.risks} accent="#92400e" />
            </section>
          )}

          {/* Prompt area */}
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Prompt</h2>
            <textarea
              ref={promptRef}
              style={textareaStyle}
              placeholder="Neue Task: gewünschte Änderung beschreiben…  (⌘/Strg+Enter = Create Task)"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter creates a new task; plain Enter stays a
                // newline so the prompt can be multi-line.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleCreateTask();
                }
              }}
              rows={5}
            />

            {/* Action buttons — the prompt box always CREATES a new task. */}
            <div style={buttonGroupStyle}>
              <button
                style={btnPrimaryStyle}
                onClick={handleCreateTask}
                disabled={creating}
              >
                {creating ? "Erstellt…" : "Create Task"}
              </button>
              <button
                style={btnSecondaryStyle}
                onClick={handleAddToQueue}
                disabled={queueing}
              >
                {queueing ? "Speichert…" : "Add To Queue"}
              </button>
              <button
                style={btnSecondaryStyle}
                onClick={handleEvaluateAllQueued}
                disabled={evaluatingNoteIds.size > 0}
                title="Bewertet alle offenen Queue-Notizen dieser Task"
              >
                {evaluatingNoteIds.size > 0 ? "Bewerte…" : "Evaluate Queue"}
              </button>
              <button style={{ ...btnDisabledStyle, color: "#9ca3af" }} disabled title="Phase 4+">
                Apply Changes
              </button>
              <button style={{ ...btnDisabledStyle, color: "#9ca3af" }} disabled title="Phase 4+">
                Reject
              </button>
            </div>

            {/* Queue note input */}
            <div style={{ marginTop: 14 }}>
              <textarea
                style={{ ...textareaStyle, minHeight: 0 }}
                placeholder="Queue-Notiz hinzufügen (gespeichert, keine Bewertung in Phase 2)…  (⌘/Strg+Enter)"
                value={queueText}
                onChange={(e) => setQueueText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleAddToQueue();
                  }
                }}
                rows={2}
              />
            </div>

            {/* Attachment zone (upload still disabled in Phase 2) */}
            <div style={{ marginTop: 16 }}>
              <div style={dropZoneStyle}>
                <span style={{ fontSize: 24 }}>📎</span>
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  Drag screenshots, files or documents here
                </span>
                <button style={uploadBtnStyle} disabled>
                  Upload (Phase 3)
                </button>
              </div>
              {attachments.length > 0 && (
                <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: 12, color: "#6b7280" }}>
                  {attachments.map((a) => (
                    <li key={a.id}>
                      {a.file_name}
                      {a.file_type ? ` · ${a.file_type}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Voice input (disabled) */}
            <div style={voiceRowStyle}>
              <button style={micBtnStyle} disabled aria-label="Mikrofon">
                🎙️
              </button>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>
                Voice input coming soon
              </span>
            </div>
          </section>

          {/* Prompt Queue */}
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Prompt Queue</h2>
            {queue.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>
                Queue ist leer.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {queue.map((item) => {
                  const evaluating = evaluatingNoteIds.has(item.id);
                  const busy = noteBusyIds.has(item.id) || evaluating;
                  const areas = Array.isArray(item.affected_areas)
                    ? (item.affected_areas as unknown[]).map(String)
                    : [];
                  const risks = Array.isArray(item.risks)
                    ? (item.risks as unknown[]).map(String)
                    : [];
                  return (
                    <div key={item.id} style={queueItemStyle}>
                      <p style={{ margin: "0 0 8px", fontSize: 14, color: "#111", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                        {item.content}
                      </p>

                      {/* Badges */}
                      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                        {evalBadge(
                          { background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" },
                          `Status: ${QUEUE_STATUS_LABEL[item.status] ?? item.status}`,
                        )}
                        {item.impact_level
                          ? evalBadge(IMPACT_STYLE[item.impact_level], `Impact: ${item.impact_level}`)
                          : evalBadge({ background: "#f3f4f6", color: "#9ca3af", border: "1px solid #e5e7eb" }, "Impact: —")}
                        {item.recommendation
                          ? evalBadge(REC_STYLE[item.recommendation], REC_LABEL[item.recommendation] ?? item.recommendation)
                          : evalBadge({ background: "#f3f4f6", color: "#9ca3af", border: "1px solid #e5e7eb" }, "Empfehlung: —")}
                        {item.approved_for_current_build &&
                          evalBadge({ background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" }, "✓ Current Build")}
                      </div>

                      {/* Evaluation text */}
                      {item.evaluation_text && (
                        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                          {item.evaluation_text}
                        </p>
                      )}

                      {/* Affected areas */}
                      {areas.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>Betroffene Bereiche: </span>
                          <span style={{ fontSize: 12, color: "#374151" }}>{areas.join(" · ")}</span>
                        </div>
                      )}

                      {/* Risks */}
                      {risks.length > 0 && (
                        <ul style={{ margin: "0 0 8px", padding: "0 0 0 18px", fontSize: 12, color: "#92400e" }}>
                          {risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}

                      {/* Buttons */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          style={qBtn(false)}
                          onClick={() => handleEvaluateNote(item.id)}
                          disabled={busy}
                        >
                          {evaluating ? "Bewerte…" : item.status === "queued" ? "Evaluate Queue" : "Re-Evaluate"}
                        </button>
                        <button
                          style={qBtn(false)}
                          onClick={() => handleApplyCurrent(item.id)}
                          disabled={busy}
                        >
                          Apply To Current Build
                        </button>
                        <button
                          style={qBtn(false)}
                          onClick={() => handleApplyAfter(item.id)}
                          disabled={busy}
                        >
                          Apply After Build
                        </button>
                        <button
                          style={qBtn(false)}
                          onClick={() => handleConvertNote(item.id)}
                          disabled={busy}
                        >
                          Create New Task
                        </button>
                        <button
                          style={qBtn(true)}
                          onClick={() => handleDiscardQueue(item.id)}
                          disabled={busy}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        {/* Right panel — Preview placeholder (unchanged, Phase 3+) */}
        <aside style={rightPanelStyle}>
          <h2 style={cardTitleStyle}>Preview</h2>
          <div style={previewPlaceholderStyle}>
            <span style={{ fontSize: 36, marginBottom: 10 }}>🖥️</span>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 1.5 }}>
              Vercel Preview will appear here
            </p>
          </div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={previewControlGroupStyle}>
              {["Desktop", "Tablet", "Mobile"].map((label) => (
                <button key={label} style={previewCtrlBtnStyle} disabled>
                  {label}
                </button>
              ))}
            </div>
            <div style={previewControlGroupStyle}>
              {["Open Preview", "Close Preview", "Reload"].map((label) => (
                <button key={label} style={previewCtrlBtnStyle} disabled>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── Bottom area — Diff + Build placeholders (Phase 3+) ── */}
      <div style={bottomAreaStyle}>
        <section style={{ ...cardStyle, flex: 1, minWidth: 0 }}>
          <h2 style={cardTitleStyle}>Diff Viewer</h2>
          <div style={bottomPlaceholderStyle}>
            <span style={{ fontSize: 20 }}>📄</span>
            <span style={{ fontSize: 13, color: "#9ca3af" }}>No changes available</span>
          </div>
        </section>
        <section style={{ ...cardStyle, flex: 1, minWidth: 0 }}>
          <h2 style={cardTitleStyle}>Build Status</h2>
          <div style={bottomPlaceholderStyle}>
            <span style={{ fontSize: 20 }}>⚙️</span>
            <span style={{ fontSize: 13, color: "#9ca3af" }}>No build started</span>
          </div>
        </section>
      </div>

      {/* ── Context menu ── */}
      {menu && (
        <div
          style={{ ...contextMenuStyle, top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={ctxItemStyle}
            onClick={() =>
              runStatusChange(menu.task, "cancel", cancelTask, "Task abgebrochen (cancelled).")
            }
          >
            Cancel Task
          </button>
          <button
            style={
              menu.task.status === "building"
                ? { ...ctxItemStyle, color: "#9ca3af", cursor: "not-allowed" }
                : ctxItemStyle
            }
            disabled={menu.task.status === "building"}
            title={
              menu.task.status === "building"
                ? "Laufender Build kann nicht archiviert werden"
                : undefined
            }
            onClick={() =>
              runStatusChange(menu.task, "archive", archiveTask, "Task archiviert.")
            }
          >
            Archive Task
          </button>
          <button
            style={ctxItemStyle}
            onClick={() =>
              runStatusChange(menu.task, "backlog", moveTaskToBacklog, "Task ins Backlog verschoben.")
            }
          >
            Move to Backlog
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const FONT = "system-ui, -apple-system, sans-serif";

const pageStyle: React.CSSProperties = {
  fontFamily: FONT,
  padding: 24,
  background: "#fafafa",
  minHeight: "100vh",
  color: "#111",
  boxSizing: "border-box",
};

const pageHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
  color: "#111",
};

const mainGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "260px 1fr 300px",
  gap: 16,
  alignItems: "start",
  marginBottom: 16,
};

// Sidebar

const sidebarStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const sidebarHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f9fafb",
};

const sectionLabelStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: "#111",
};

const newTaskBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT,
};

const summaryRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "10px 10px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fff",
};

const filterRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  padding: "8px 10px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fcfcfd",
};

const filterChipStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "#fff",
  color: "#6b7280",
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT,
};

const filterChipActiveStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  borderColor: "#111",
};

const taskListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  maxHeight: "64vh",
};

const taskItemStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 14px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid #f3f4f6",
  borderLeft: "3px solid transparent",
  cursor: "pointer",
  fontFamily: FONT,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const taskItemActiveStyle: React.CSSProperties = {
  background: "#f0f4ff",
  borderLeftColor: "#4F6EF7",
};

const taskTitleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const taskTitleTextStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#111",
  lineHeight: 1.3,
  minWidth: 0,
};

const taskMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const taskDateTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
};

// Central

const centralStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "16px 20px",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#111",
  margin: "0 0 14px",
  paddingBottom: 10,
  borderBottom: "1px solid #f3f4f6",
};

const detailRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 10,
};

const detailLabelStyle: React.CSSProperties = {
  color: "#6b7280",
  fontWeight: 500,
  minWidth: 60,
  fontSize: 13,
};

const chatPlaceholderStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "32px 16px",
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: 8,
  textAlign: "center",
  color: "#9ca3af",
  fontSize: 13,
};

// Phase 3 — status hint banners.
const bannerBase: React.CSSProperties = {
  marginTop: 6,
  marginBottom: 4,
  padding: "9px 12px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
};
const bannerWaitingInput: React.CSSProperties = {
  ...bannerBase,
  background: "#fef9c3",
  color: "#854d0e",
  border: "1px solid #fde047",
};
const bannerWaitingStart: React.CSSProperties = {
  ...bannerBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #86efac",
};

// Build Plan readiness pill.
const pillBase: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const readyPill: React.CSSProperties = {
  ...pillBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #86efac",
};
const notReadyPill: React.CSSProperties = {
  ...pillBase,
  background: "#fef9c3",
  color: "#854d0e",
  border: "1px solid #fde047",
};

// Build Plan card (Phase 5) — section header + complexity pill.
const planSectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#6b7280",
  marginBottom: 6,
};
function complexityPill(c: string): React.CSSProperties {
  if (c === "high") return { ...pillBase, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" };
  if (c === "low") return { ...pillBase, background: "#dcfce7", color: "#166534", border: "1px solid #86efac" };
  return { ...pillBase, background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" };
}

const chatListStyle: React.CSSProperties = {
  marginTop: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: 260,
  overflowY: "auto",
};

function msgBubbleStyle(role: string): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
  };
  if (role === "user") return { ...base, background: "#f0f4ff", borderColor: "#dbe3ff" };
  if (role === "assistant") return { ...base, background: "#f9fafb" };
  return { ...base, background: "#fffaf0", borderColor: "#fde68a" };
}

const msgRoleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#9ca3af",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: FONT,
  resize: "vertical",
  color: "#111",
  background: "#fff",
  boxSizing: "border-box",
  lineHeight: 1.5,
};

const buttonGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 12,
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "#111",
  color: "#fff",
  border: "1px solid #111",
  borderRadius: 5,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FONT,
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: FONT,
};

const btnDisabledStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "#f9fafb",
  color: "#9ca3af",
  border: "1px solid #e5e7eb",
  borderRadius: 5,
  fontSize: 13,
  fontWeight: 500,
  cursor: "not-allowed",
  fontFamily: FONT,
};

const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "20px 16px",
  border: "2px dashed #d1d5db",
  borderRadius: 8,
  background: "#f9fafb",
};

const uploadBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  background: "#fff",
  color: "#6b7280",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: FONT,
  opacity: 0.6,
};

const voiceRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 12,
  padding: "10px 14px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
};

const micBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 16,
  lineHeight: 1,
  opacity: 0.5,
  flexShrink: 0,
};

const queueItemStyle: React.CSSProperties = {
  padding: "12px 14px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
};

// Right panel

const rightPanelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "16px 20px",
};

const previewPlaceholderStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "48px 16px",
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: 8,
  minHeight: 200,
};

const previewControlGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const previewCtrlBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#f3f4f6",
  color: "#9ca3af",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: FONT,
  opacity: 0.6,
};

// Bottom area

const bottomAreaStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
};

const bottomPlaceholderStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "32px 16px",
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: 8,
};

// Context menu

const contextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 1000,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  padding: 4,
  minWidth: 180,
  display: "flex",
  flexDirection: "column",
};

const ctxItemStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  color: "#111",
  cursor: "pointer",
  fontFamily: FONT,
};
