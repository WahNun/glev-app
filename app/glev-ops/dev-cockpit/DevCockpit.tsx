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

import { useEffect, useRef, useState, useTransition } from "react";
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
  listAttachments,
  addMessage,
  analyzeTask,
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
      risks: Array.isArray(p.risks) ? p.risks : [],
      questions: Array.isArray(p.questions) ? p.questions : [],
      ready_to_build: p.ready_to_build === true,
    };
  } catch {
    return null;
  }
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
// CSS keyframes are injected once via <KeyframeStyles/> at the top of the
// component tree (this file uses inline styles, no global stylesheet). The
// animation names are dc-prefixed to avoid collisions.

function KeyframeStyles() {
  return (
    <style>{`
      @keyframes dc-spin { to { transform: rotate(360deg); } }
      @keyframes dc-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.72); } }
      @keyframes dc-pulse-slow { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.78); } }
      @keyframes dc-glow {
        0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,.0); }
        50%     { box-shadow: 0 0 6px 2px rgba(34,197,94,.6); }
      }
    `}</style>
  );
}

const indicatorBox: React.CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function Dot({ color, anim }: { color: string; anim?: string }) {
  return (
    <span style={indicatorBox}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          animation: anim,
        }}
      />
    </span>
  );
}

const ICON = { width: 12, height: 12 } as const;

/** Small status glyph shown left of each sidebar task title. */
function StatusIndicator({ status }: { status: TaskStatus }) {
  switch (status) {
    case "building":
      // Small circular spinner — gentle ~1s rotation, clearly visible.
      return (
        <span style={indicatorBox} title="Agent arbeitet gerade" aria-label="building">
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid #fed7aa",
              borderTopColor: "#ea580c",
              animation: "dc-spin 0.9s linear infinite",
            }}
          />
        </span>
      );
    case "planning":
      // Blue pulsing dot — "Analyse läuft".
      return <Dot color="#2563eb" anim="dc-pulse 1.4s ease-in-out infinite" />;
    case "waiting_for_input":
      // Yellow slow-pulsing dot — "Agent benötigt Antwort des Users" (Phase 3).
      return <Dot color="#eab308" anim="dc-pulse-slow 2.2s ease-in-out infinite" />;
    case "preview_ready":
      // Green dot with a soft glow — "Build fertig, wartet auf Apply".
      return (
        <span style={indicatorBox} title="Build fertig — Apply Changes" aria-label="preview_ready">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#22c55e",
              animation: "dc-glow 1.8s ease-in-out infinite",
            }}
          />
        </span>
      );
    case "waiting_for_start":
      // Amber pause glyph, no animation — "Plan fertig, wartet auf Start Build".
      return (
        <span style={indicatorBox} title="Plan fertig — wartet auf Start Build" aria-label="waiting_for_start">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth={2.6} strokeLinecap="round">
            <line x1="9" y1="6" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="18" />
          </svg>
        </span>
      );
    case "applied":
      return (
        <span style={indicatorBox} title="Angewendet" aria-label="applied">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      );
    case "rejected":
      return (
        <span style={indicatorBox} title="Abgelehnt" aria-label="rejected">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={3} strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </span>
      );
    case "cancelled":
      return (
        <span style={indicatorBox} title="Abgebrochen" aria-label="cancelled">
          <svg {...ICON} viewBox="0 0 24 24" fill="#9ca3af">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </span>
      );
    case "archived":
      return (
        <span style={indicatorBox} title="Archiviert" aria-label="archived">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </span>
      );
    case "backlog":
      return (
        <span style={indicatorBox} title="Backlog" aria-label="backlog">
          <svg {...ICON} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        </span>
      );
    case "draft":
    default:
      // Neutral grey dot keeps every row's indicator slot aligned.
      return <Dot color="#cbd5e1" />;
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

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: DevTask; x: number; y: number } | null>(
    null,
  );

  // Summary chip counts — seeded from the initial (active) load so there's no
  // flash, then kept globally accurate via refreshSummary() (all statuses).
  const [summary, setSummary] = useState<Summary>(() => countSummary(initialTasks));

  const [isPending, startTransition] = useTransition();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const plan = selectedTask ? parsePlan(selectedTask.plan_text) : null;

  // ── Data loading ────────────────────────────────────────────────────────────

  // Recompute the summary chips from ALL tasks (not just the current filter),
  // so the at-a-glance counts stay correct regardless of which filter is open.
  // Uses the existing listTasks action — no new server action.
  async function refreshSummary() {
    const res = await listTasks("all");
    if (res.ok) setSummary(countSummary(res.data));
  }

  function refreshList(nextFilter: TaskFilter) {
    startTransition(async () => {
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
    startTransition(async () => {
      const [m, q, a] = await Promise.all([
        listMessages(taskId),
        listQueueNotes(taskId),
        listAttachments(taskId),
      ]);
      if (m.ok) setMessages(m.data);
      if (q.ok) setQueue(q.data);
      if (a.ok) setAttachments(a.data);
    });
  }

  // Load detail whenever the selected task changes.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setQueue([]);
      setAttachments([]);
      return;
    }
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
  function handleCreateTask() {
    const prompt = promptText.trim();
    startTransition(async () => {
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
    });
  }

  // Phase 3 — Analyze Task with Mistral (plan only, no build).
  function handleAnalyze() {
    if (!selectedTask) {
      setError("Erst eine Task auswählen.");
      return;
    }
    const id = selectedTask.id;
    setNotice("Analysiere mit Mistral…");
    startTransition(async () => {
      const res = await analyzeTask(id);
      if (!res.ok) {
        setError(errText(res.error));
        // Reload so the persisted "Mistral analysis failed." system message shows.
        loadTaskDetail(id);
        return;
      }
      // Reflect the new status + plan_text on the task in the list.
      setTasks((prev) => prev.map((t) => (t.id === res.data.task.id ? res.data.task : t)));
      loadTaskDetail(id);
      refreshSummary();
      setNotice(
        res.data.plan.ready_to_build
          ? "Analyse fertig — bereit für Start Build."
          : "Analyse fertig — Rückfragen offen.",
      );
    });
  }

  // Phase 3 — user answers a follow-up question; stored as a user message.
  function handleSendAnswer() {
    if (!selectedTask) return;
    const text = answerText.trim();
    if (!text) return;
    const id = selectedTask.id;
    startTransition(async () => {
      const res = await addMessage(id, "user", text);
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      setMessages((prev) => [...prev, res.data]);
      setAnswerText("");
      setNotice("Antwort gespeichert — jetzt Re-Analyze.");
    });
  }

  function handleAddToQueue() {
    if (!selectedTask) {
      setError("Erst eine Task auswählen oder erstellen.");
      return;
    }
    const text = queueText.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await addQueueNote(selectedTask.id, text);
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      setQueue((prev) => [res.data, ...prev]);
      setQueueText("");
      setNotice("Queue-Notiz gespeichert.");
    });
  }

  function handleDiscardQueue(id: string) {
    startTransition(async () => {
      const res = await discardQueueNote(id);
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      // Soft discard — keep the row but reflect the new status, or drop it
      // from the visible list to keep the queue focused on open items.
      setQueue((prev) => prev.filter((q) => q.id !== id));
    });
  }

  function runStatusChange(
    task: DevTask,
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    successMsg: string,
  ) {
    setMenu(null);
    startTransition(async () => {
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
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={pageStyle}>
      <KeyframeStyles />
      {/* ── Page heading ── */}
      <div style={pageHeaderStyle}>
        <h1 style={headingStyle}>Dev Cockpit</h1>
        <span style={phaseBadgeStyle}>Phase 2 — Persistenz</span>
        {isPending && <span style={{ fontSize: 12, color: "#9ca3af" }}>lädt…</span>}
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
                    <StatusIndicator status={task.status} />
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
                        if (!isPending) handleSendAnswer();
                      }
                    }}
                    rows={2}
                  />
                  <div style={buttonGroupStyle}>
                    <button
                      style={btnSecondaryStyle}
                      onClick={handleSendAnswer}
                      disabled={isPending}
                    >
                      Antwort senden
                    </button>
                    <button
                      style={btnPrimaryStyle}
                      onClick={handleAnalyze}
                      disabled={isPending}
                      title="Mistral analysiert die Aufgabe (nur Planung, kein Build)"
                    >
                      {plan ? "Re-Analyze" : "Analyze Task"}
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

          {/* Build Plan card (Phase 3) — rendered from plan_text, never as JSON */}
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
                  Build Plan
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
              <PlanSection title="Risiken" items={plan.risks} />
              <PlanSection title="Offene Fragen" items={plan.questions} accent="#92400e" />

              {plan.affected_areas.length === 0 &&
                plan.likely_files.length === 0 &&
                plan.risks.length === 0 &&
                plan.questions.length === 0 &&
                !plan.summary && (
                  <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
                    Noch kein Analyse-Inhalt.
                  </p>
                )}
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
                  if (!isPending) handleCreateTask();
                }
              }}
              rows={5}
            />

            {/* Action buttons — the prompt box always CREATES a new task. */}
            <div style={buttonGroupStyle}>
              <button
                style={btnPrimaryStyle}
                onClick={handleCreateTask}
                disabled={isPending}
              >
                Create Task
              </button>
              <button style={btnDisabledStyle} disabled title="Phase 4">
                Start Build
              </button>
              <button
                style={btnSecondaryStyle}
                onClick={handleAddToQueue}
                disabled={isPending}
              >
                Add To Queue
              </button>
              <button
                style={btnDisabledStyle}
                disabled
                onClick={() => setNotice("Evaluate Queue — kommt in Phase 4.")}
                title="Coming in Phase 4"
              >
                Evaluate Queue
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
                    if (!isPending) handleAddToQueue();
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
                {queue.map((item) => (
                  <div key={item.id} style={queueItemStyle}>
                    <p style={{ margin: "0 0 8px", fontSize: 14, color: "#111", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                      {item.content}
                    </p>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={placeholderBadgeStyle}>
                        Impact: {item.impact_level ?? "—"}
                      </span>
                      <span style={placeholderBadgeStyle}>
                        Empfehlung: {item.recommendation ?? "—"}
                      </span>
                      <span style={placeholderBadgeStyle}>Status: {item.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button style={queueActionBtnStyle} disabled title="Phase 4">
                        Apply To Current Build
                      </button>
                      <button style={queueActionBtnStyle} disabled title="Phase 4">
                        Apply After Build
                      </button>
                      <button style={queueActionBtnStyle} disabled title="Phase 4">
                        Create New Task
                      </button>
                      <button
                        style={{
                          ...queueActionBtnStyle,
                          color: "#991b1b",
                          borderColor: "#fca5a5",
                          cursor: "pointer",
                          opacity: 1,
                        }}
                        onClick={() => handleDiscardQueue(item.id)}
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
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
              runStatusChange(menu.task, cancelTask, "Task abgebrochen (cancelled).")
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
              runStatusChange(menu.task, archiveTask, "Task archiviert.")
            }
          >
            Archive Task
          </button>
          <button
            style={ctxItemStyle}
            onClick={() =>
              runStatusChange(menu.task, moveTaskToBacklog, "Task ins Backlog verschoben.")
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

const phaseBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  background: "#f3e8ff",
  color: "#6b21a8",
  border: "1px solid #d8b4fe",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
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

const placeholderBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  background: "#f3f4f6",
  color: "#6b7280",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 500,
};

const queueActionBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: FONT,
  opacity: 0.6,
  cursor: "not-allowed",
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
