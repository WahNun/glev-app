"use client";

import { useState, useEffect, useRef } from "react";
import ConfirmModal from "./ConfirmModal";

/**
 * Status-Badge pro Käufer-Zeile.
 * Drei Zustände: offen → zu_bearbeiten → geklärt
 * Jede Änderung erfordert Bestätigung via ConfirmModal.
 * Speichert in localStorage (Key: glev_admin_case_status, Map von rowKey → Status).
 */

export type CaseStatus = "offen" | "zu_bearbeiten" | "geklärt";

const STORAGE_KEY = "glev_admin_case_status";

export function loadAllCaseStatuses(): Record<string, CaseStatus> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CaseStatus>;
  } catch {
    // ignore
  }
  return {};
}

function saveCaseStatus(rowKey: string, status: CaseStatus) {
  try {
    const all = loadAllCaseStatuses();
    if (status === "offen") {
      delete all[rowKey];
    } else {
      all[rowKey] = status;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

const STATUS_META: Record<CaseStatus, { label: string; color: string; bg: string; border: string }> = {
  offen: { label: "Offen", color: "#92400e", bg: "#fef3c7", border: "#fde68a" },
  zu_bearbeiten: { label: "Zu bearbeiten", color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
  geklärt: { label: "Geklärt ✓", color: "#166534", bg: "#dcfce7", border: "#86efac" },
};

const CONFIRM_META: Record<CaseStatus, { title: string; message: string; label: string; danger: boolean }> = {
  offen: {
    title: 'Status auf "Offen" zurücksetzen?',
    message: "Der Fall wird wieder als ungeklärt markiert.",
    label: "Zurücksetzen",
    danger: false,
  },
  zu_bearbeiten: {
    title: 'Als "Zu bearbeiten" markieren?',
    message: "Der Fall erscheint im Fälle-Tab.",
    label: "Markieren",
    danger: false,
  },
  geklärt: {
    title: 'Als "Geklärt" markieren?',
    message: "Der Fall verschwindet aus der offenen Fallliste.",
    label: "Als geklärt markieren",
    danger: false,
  },
};

export default function CaseStatusCell({ rowKey }: { rowKey: string }) {
  const [status, setStatus] = useState<CaseStatus>("offen");
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<CaseStatus | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const all = loadAllCaseStatuses();
    setStatus(all[rowKey] ?? "offen");
    setMounted(true);
  }, [rowKey]);

  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, [menuOpen]);

  function applyStatus(next: CaseStatus) {
    setStatus(next);
    saveCaseStatus(rowKey, next);
    setPendingStatus(null);
    setMenuOpen(false);
  }

  if (!mounted) {
    return <span style={pillStyle("offen")}>Offen</span>;
  }

  const meta = STATUS_META[status];

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          ...pillBase,
          color: meta.color,
          background: meta.bg,
          border: `1px solid ${meta.border}`,
        }}
        title="Status ändern"
      >
        {meta.label} ▾
      </button>

      {menuOpen && (
        <div style={menuStyle}>
          {(Object.keys(STATUS_META) as CaseStatus[]).map((s) => {
            const m = STATUS_META[s];
            const isCurrent = s === status;
            return (
              <button
                key={s}
                type="button"
                disabled={isCurrent}
                onClick={() => {
                  setMenuOpen(false);
                  if (!isCurrent) setPendingStatus(s);
                }}
                style={{
                  ...menuItem,
                  opacity: isCurrent ? 0.4 : 1,
                  cursor: isCurrent ? "default" : "pointer",
                }}
              >
                <span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span>
                {isCurrent && <span style={{ fontSize: 10, color: "#999", marginLeft: 4 }}>aktuell</span>}
              </button>
            );
          })}
        </div>
      )}

      {pendingStatus && (() => {
        const cm = CONFIRM_META[pendingStatus];
        return (
          <ConfirmModal
            open
            title={cm.title}
            message={cm.message}
            confirmLabel={cm.label}
            danger={cm.danger}
            onConfirm={() => applyStatus(pendingStatus)}
            onCancel={() => setPendingStatus(null)}
          />
        );
      })()}
    </div>
  );
}

function pillStyle(s: CaseStatus): React.CSSProperties {
  const m = STATUS_META[s];
  return { ...pillBase, color: m.color, background: m.bg, border: `1px solid ${m.border}` };
}

const pillBase: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  zIndex: 100,
  minWidth: 160,
  overflow: "hidden",
};

const menuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  textAlign: "left",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};
