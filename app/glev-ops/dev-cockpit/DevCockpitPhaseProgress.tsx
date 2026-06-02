// Dev Cockpit — overall system-maturity indicator (governance).
//
// SINGLE SOURCE OF TRUTH: to advance a phase, change ONLY `currentPhase` in
// DEV_COCKPIT_PHASES below. Everything else (percentage, bar fill, current
// label, next label, "Phase X / Y") is derived automatically — no other UI
// edits are ever required when advancing phases.

import React from "react";

export const DEV_COCKPIT_PHASES = {
  // ⬇️ The ONLY value to bump when a major phase ships.
  currentPhase: 5,
  // Roadmap labels (index 0 = Phase 1). totalPhases is derived from this list.
  labels: [
    "Task Management",
    "Persistence",
    "Analysis Engine",
    "Queue Intelligence",
    "Build Execution",
    "Coding Agent",
    "Preview Pipeline",
    "Diff & Review",
    "GitHub Integration",
    "Deployment Automation",
    "Multi-Agent Orchestration",
    "Autonomous Product Team",
  ],
} as const;

const GLEV_BLUE = "#4F6EF7";

export default function DevCockpitPhaseProgress() {
  const total = DEV_COCKPIT_PHASES.labels.length;
  // Clamp so a typo can never render an impossible bar.
  const current = Math.min(Math.max(DEV_COCKPIT_PHASES.currentPhase, 0), total);

  const pct = Math.round((current / total) * 100);
  const filled = current;
  const empty = total - current;

  const currentLabel = DEV_COCKPIT_PHASES.labels[current - 1] ?? "—";
  const nextLabel = current >= total ? "Completed" : DEV_COCKPIT_PHASES.labels[current];

  return (
    <div style={wrap} aria-label={`Dev Cockpit Phase ${current} von ${total}: ${currentLabel}`}>
      {/* Block progress bar + percentage */}
      <div style={barRow}>
        <span style={barText}>
          <span style={{ color: GLEV_BLUE }}>{"█".repeat(filled)}</span>
          <span style={{ color: "#d8dbe4" }}>{"░".repeat(empty)}</span>
        </span>
        <span style={pctText}>{pct}%</span>
      </div>

      {/* Phase counter + current label */}
      <div style={metaRow}>
        <span style={phaseNum}>
          Phase {current} / {total}
        </span>
        <span style={currentLabelStyle}>{currentLabel}</span>
      </div>

      {/* Next phase (auto-derived) */}
      <div style={nextRow}>
        Next: <span style={{ fontWeight: 600, color: "#374151" }}>{nextLabel}</span>
      </div>
    </div>
  );
}

const FONT = "system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const wrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "8px 12px",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderLeft: `3px solid ${GLEV_BLUE}`,
  borderRadius: 8,
  minWidth: 230,
  fontFamily: FONT,
};

const barRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const barText: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1,
  letterSpacing: 1,
  whiteSpace: "nowrap",
};

const pctText: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: GLEV_BLUE,
  marginLeft: "auto",
};

const metaRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  flexWrap: "wrap",
};

const phaseNum: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const currentLabelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#111",
};

const nextRow: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
};
