"use client";

import { useEffect, useRef } from "react";

/**
 * Leichtgewichtiges Inline-Confirmation-Modal.
 * Ersetzt window.confirm() im Admin-Panel mit echtem UI.
 *
 * Usage:
 *   <ConfirmModal
 *     open={!!pending}
 *     title="Sofort kündigen?"
 *     message="Subscription wird sofort beendet."
 *     confirmLabel="Ja, kündigen"
 *     danger
 *     onConfirm={() => { ... }}
 *     onCancel={() => setPending(null)}
 *   />
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Bestätigen",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmBtnRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={dialog} role="dialog" aria-modal="true" aria-labelledby="cm-title">
        <p id="cm-title" style={titleStyle}>{title}</p>
        {message && <p style={msgStyle}>{message}</p>}
        <div style={btnRow}>
          <button type="button" onClick={onCancel} style={btnCancel}>
            Abbrechen
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            style={danger ? btnDanger : btnConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const dialog: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: "24px 28px",
  maxWidth: 380,
  width: "90vw",
  boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: "0 0 8px",
  color: "#111",
};

const msgStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#555",
  margin: "0 0 20px",
  lineHeight: 1.5,
};

const btnRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const btnBase: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "none",
  fontFamily: "inherit",
};

const btnCancel: React.CSSProperties = {
  ...btnBase,
  background: "#f3f4f6",
  color: "#374151",
};

const btnConfirm: React.CSSProperties = {
  ...btnBase,
  background: "#111",
  color: "#fff",
};

const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: "#b91c1c",
  color: "#fff",
};
