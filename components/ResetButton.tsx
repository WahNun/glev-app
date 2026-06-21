"use client";

import { useCallback, useState } from "react";
import { useLocale } from "next-intl";

const COPY = {
  de: {
    confirm:   "Wirklich alle Glev-AI-Zugriffe widerrufen? Die Master-Zustimmung und alle Datenfreigaben werden zurückgesetzt, der Chat-Verlauf gelöscht.",
    ariaLabel: "AI-Zugriff widerrufen",
  },
  en: {
    confirm:   "Really revoke all Glev AI access? Master consent and all data grants will be reset, and the chat history will be cleared.",
    ariaLabel: "Revoke AI access",
  },
} as const;

interface Props {
  onRevoked?: () => void;
  style?: React.CSSProperties;
}

/**
 * Small icon button (≥44pt tap area per Apple HIG) that calls
 * DELETE /api/ai/consent after a browser confirm and dispatches
 * "glev:ai-consent-revoked" so the global GlevAI state updates.
 *
 * Self-contained: no parent state needed. Pass `onRevoked` to e.g.
 * close the containing sheet after revocation completes.
 */
export default function ResetButton({ onRevoked, style }: Props) {
  const locale = useLocale();
  const t = locale === "en" ? COPY.en : COPY.de;
  const [busy, setBusy] = useState(false);

  const handleRevoke = useCallback(async () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm(t.confirm)) return;
    setBusy(true);
    try {
      await fetch("/api/ai/consent", { method: "DELETE" });
    } catch { /* non-fatal — event still fires */ }
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem("glev_ai_history_v1"); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("glev:ai-consent-revoked"));
    }
    setBusy(false);
    onRevoked?.();
  }, [busy, t.confirm, onRevoked]);

  return (
    <button
      type="button"
      aria-label={t.ariaLabel}
      onClick={() => { void handleRevoke(); }}
      disabled={busy}
      style={{
        minWidth: 44,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.35 : 0.65,
        borderRadius: 8,
        padding: 0,
        transition: "opacity 0.15s",
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
      onMouseLeave={(e) => { if (!busy) (e.currentTarget as HTMLButtonElement).style.opacity = "0.65"; }}
    >
      {/* Shield-slash: "revoke AI access" */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: busy ? "var(--text-faint)" : "var(--text-dim)" }}
        aria-hidden="true"
      >
        <path d="M19.69 14a6.9 6.9 0 0 0 .31-2V5l-8-3-3.16 1.18" />
        <path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 0 0 5.62-4.38" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    </button>
  );
}
