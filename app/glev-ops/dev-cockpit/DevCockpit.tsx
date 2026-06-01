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
  updateTask,
  cancelTask,
  archiveTask,
  moveTaskToBacklog,
  listMessages,
  listQueueNotes,
  addQueueNote,
  discardQueueNote,
  listAttachments,
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
} from "./types";

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
  const [composeMode, setComposeMode] = useState<boolean>(
    initialTasks.length === 0,
  );

  const [promptText, setPromptText] = useState("");
  const [queueText, setQueueText] = useState("");

  const [messages, setMessages] = useState<DevMessage[]>([]);
  const [queue, setQueue] = useState<DevQueueNote[]>([]);
  const [attachments, setAttachments] = useState<DevAttachment[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: DevTask; x: number; y: number } | null>(
    null,
  );

  const [isPending, startTransition] = useTransition();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  // ── Data loading ────────────────────────────────────────────────────────────

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

  // Sync prompt textarea with the selected task (unless composing a new one).
  useEffect(() => {
    if (composeMode) return;
    setPromptText(selectedTask?.prompt ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, composeMode]);

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

  function handleStartCompose() {
    setComposeMode(true);
    setSelectedId(null);
    setPromptText("");
    setMessages([]);
    setQueue([]);
    setAttachments([]);
    setTimeout(() => promptRef.current?.focus(), 0);
  }

  function handleCreateTask() {
    const prompt = promptText.trim();
    startTransition(async () => {
      const res = await createTask({ prompt });
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      setComposeMode(false);
      setNotice("Task erstellt.");
      // New task is a draft → it belongs to the Active view. Switch there so
      // it's visible regardless of the current filter, then select it.
      setFilter("active");
      const listRes = await listTasks("active");
      if (listRes.ok) setTasks(listRes.data);
      setSelectedId(res.data.id);
    });
  }

  function handleSavePrompt() {
    if (!selectedTask) return;
    startTransition(async () => {
      const res = await updateTask(selectedTask.id, { prompt: promptText });
      if (!res.ok) {
        setError(errText(res.error));
        return;
      }
      setTasks((prev) => prev.map((t) => (t.id === res.data.id ? res.data : t)));
      setNotice("Prompt gespeichert.");
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
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={pageStyle}>
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
                  onClick={() => {
                    setComposeMode(false);
                    setSelectedId(task.id);
                  }}
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
                  <span style={taskTitleTextStyle}>{task.title}</span>
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
            {composeMode ? (
              <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
                Neue Task — Prompt unten eingeben und <strong>Create Task</strong> klicken.
              </p>
            ) : selectedTask ? (
              <>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Titel</span>
                  <span style={{ fontWeight: 600, color: "#111", fontSize: 14 }}>
                    {selectedTask.title}
                  </span>
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Status</span>
                  <StatusBadge status={selectedTask.status} />
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Erstellt</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>
                    {fmtDate(selectedTask.created_at)}
                  </span>
                </div>

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
              </>
            ) : (
              <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>
                Keine Task ausgewählt.
              </p>
            )}
          </section>

          {/* Prompt area */}
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Prompt</h2>
            <textarea
              ref={promptRef}
              style={textareaStyle}
              placeholder="Beschreibe die gewünschte Änderung…  (⌘/Strg+Enter zum Absenden)"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter submits; plain Enter stays a newline so the
                // prompt can be multi-line.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (isPending) return;
                  if (composeMode || !selectedTask) handleCreateTask();
                  else handleSavePrompt();
                }
              }}
              rows={5}
            />

            {/* Action buttons */}
            <div style={buttonGroupStyle}>
              {composeMode || !selectedTask ? (
                <button
                  style={btnPrimaryStyle}
                  onClick={handleCreateTask}
                  disabled={isPending}
                >
                  Create Task
                </button>
              ) : (
                <button
                  style={btnPrimaryStyle}
                  onClick={handleSavePrompt}
                  disabled={isPending}
                >
                  Save Prompt
                </button>
              )}
              <button style={btnDisabledStyle} disabled title="Phase 3">
                Analyze Task
              </button>
              <button style={btnDisabledStyle} disabled title="Phase 3">
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
              <button style={{ ...btnDisabledStyle, color: "#9ca3af" }} disabled title="Phase 3">
                Apply Changes
              </button>
              <button style={{ ...btnDisabledStyle, color: "#9ca3af" }} disabled title="Phase 3">
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

const taskTitleTextStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#111",
  lineHeight: 1.3,
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
