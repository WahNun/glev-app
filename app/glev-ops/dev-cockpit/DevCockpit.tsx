"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus =
  | "draft"
  | "planning"
  | "waiting_for_start"
  | "building"
  | "preview_ready"
  | "applied"
  | "rejected";

interface DevTask {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
}

interface QueueItem {
  id: string;
  text: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const INITIAL_TASKS: DevTask[] = [
  {
    id: "1",
    title: "Dark mode toggle implementieren",
    status: "draft",
    createdAt: "2026-05-30",
  },
  {
    id: "2",
    title: "Login-Redirect Bug fixen",
    status: "building",
    createdAt: "2026-05-29",
  },
  {
    id: "3",
    title: "Onboarding Flow neu gestalten",
    status: "preview_ready",
    createdAt: "2026-05-28",
  },
  {
    id: "4",
    title: "E-Mail Templates aktualisieren",
    status: "applied",
    createdAt: "2026-05-27",
  },
  {
    id: "5",
    title: "Export Feature",
    status: "rejected",
    createdAt: "2026-05-26",
  },
  {
    id: "6",
    title: "Admin Nav erweitern",
    status: "planning",
    createdAt: "2026-05-25",
  },
  {
    id: "7",
    title: "Supabase Migrations prüfen",
    status: "waiting_for_start",
    createdAt: "2026-05-24",
  },
];

const INITIAL_QUEUE: QueueItem[] = [
  { id: "q1", text: "Füge einen Tooltip für den Glucose-Chart hinzu" },
  { id: "q2", text: "Optimiere die Ladezeit der Admin-Seiten" },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Entwurf",
  planning: "Planung",
  waiting_for_start: "Wartet",
  building: "Building",
  preview_ready: "Preview bereit",
  applied: "Angewendet",
  rejected: "Abgelehnt",
};

const STATUS_STYLE: Record<TaskStatus, React.CSSProperties> = {
  draft: { background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" },
  planning: { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" },
  waiting_for_start: { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  building: { background: "#ffedd5", color: "#9a3412", border: "1px solid #fed7aa" },
  preview_ready: { background: "#f3e8ff", color: "#6b21a8", border: "1px solid #d8b4fe" },
  applied: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  rejected: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export default function DevCockpit() {
  const [tasks, setTasks] = useState<DevTask[]>(INITIAL_TASKS);
  const [selectedId, setSelectedId] = useState<string | null>(
    INITIAL_TASKS[0]?.id ?? null,
  );
  const [promptText, setPromptText] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>(INITIAL_QUEUE);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  function handleNewTask() {
    const id = String(Date.now());
    const task: DevTask = {
      id,
      title: "Neue Task",
      status: "draft",
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setTasks((prev) => [task, ...prev]);
    setSelectedId(id);
  }

  function discardQueueItem(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div style={pageStyle}>
      {/* ── Page heading ── */}
      <div style={pageHeaderStyle}>
        <h1 style={headingStyle}>Dev Cockpit</h1>
        <span style={phaseBadgeStyle}>Phase 1 — UI Skeleton</span>
      </div>

      {/* ── Main 3-column grid ── */}
      <div style={mainGridStyle}>

        {/* Left Sidebar */}
        <aside style={sidebarStyle}>
          <div style={sidebarHeaderStyle}>
            <span style={sectionLabelStyle}>Tasks</span>
            <button style={newTaskBtnStyle} onClick={handleNewTask}>
              + New Task
            </button>
          </div>
          <div style={taskListStyle}>
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedId(task.id)}
                style={
                  selectedId === task.id
                    ? { ...taskItemStyle, ...taskItemActiveStyle }
                    : taskItemStyle
                }
              >
                <span style={taskTitleTextStyle}>{task.title}</span>
                <div style={taskMetaStyle}>
                  <StatusBadge status={task.status} />
                  <span style={taskDateTextStyle}>{fmtDate(task.createdAt)}</span>
                </div>
              </button>
            ))}
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
                  <span style={detailLabelStyle}>Status</span>
                  <StatusBadge status={selectedTask.status} />
                </div>
                <div style={detailRowStyle}>
                  <span style={detailLabelStyle}>Erstellt</span>
                  <span style={{ color: "#6b7280", fontSize: 13 }}>
                    {fmtDate(selectedTask.createdAt)}
                  </span>
                </div>
                <div style={chatPlaceholderStyle}>Chat-Verlauf erscheint hier</div>
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
              style={textareaStyle}
              placeholder="Beschreibe die gewünschte Änderung..."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={5}
            />

            {/* Action buttons */}
            <div style={buttonGroupStyle}>
              <button style={btnPrimaryStyle}>Analyze Task</button>
              <button style={btnPrimaryStyle}>Start Build</button>
              <button style={btnSecondaryStyle}>Add To Queue</button>
              <button style={btnSecondaryStyle}>Evaluate Queue</button>
              <button
                style={{
                  ...btnSecondaryStyle,
                  color: "#166534",
                  borderColor: "#86efac",
                  background: "#dcfce7",
                }}
              >
                Apply Changes
              </button>
              <button
                style={{
                  ...btnSecondaryStyle,
                  color: "#991b1b",
                  borderColor: "#fca5a5",
                  background: "#fee2e2",
                }}
              >
                Reject
              </button>
            </div>

            {/* Attachment zone */}
            <div style={{ marginTop: 16 }}>
              <div style={dropZoneStyle}>
                <span style={{ fontSize: 24 }}>📎</span>
                <span style={{ fontSize: 13, color: "#6b7280" }}>
                  Drag screenshots, files or documents here
                </span>
                <button style={uploadBtnStyle} disabled>
                  Upload
                </button>
              </div>
            </div>

            {/* Voice input */}
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
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 14,
                        color: "#111",
                        lineHeight: 1.4,
                      }}
                    >
                      {item.text}
                    </p>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={placeholderBadgeStyle}>Impact: —</span>
                      <span style={placeholderBadgeStyle}>Empfehlung: —</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button style={queueActionBtnStyle} disabled>
                        Apply To Current Build
                      </button>
                      <button style={queueActionBtnStyle} disabled>
                        Apply After Build
                      </button>
                      <button style={queueActionBtnStyle} disabled>
                        Create New Task
                      </button>
                      <button
                        style={{
                          ...queueActionBtnStyle,
                          color: "#991b1b",
                          borderColor: "#fca5a5",
                          cursor: "pointer",
                        }}
                        onClick={() => discardQueueItem(item.id)}
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

        {/* Right panel */}
        <aside style={rightPanelStyle}>
          <h2 style={cardTitleStyle}>Preview</h2>
          <div style={previewPlaceholderStyle}>
            <span style={{ fontSize: 36, marginBottom: 10 }}>🖥️</span>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "#6b7280",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
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

      {/* ── Bottom area ── */}
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
  marginBottom: 20,
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

const taskListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  maxHeight: "72vh",
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
  color: "#9ca3af",
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
