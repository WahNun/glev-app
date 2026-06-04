"use client";

import { useLocale } from "next-intl";
import type { InfluencePrepPayload } from "@/lib/useGlevAI";

const COPY = {
  de: {
    title:       "Einflussfaktor: Alkohol",
    linked:      "aus Mahlzeit",
    confirm:     "Speichern",
    dismiss:     "Verwerfen",
    unit:        "g Alkohol",
    hint:        "⇄ verknüpft mit Mahlzeit — wird separat gespeichert. Verlängerte Hypo-Überwachung (6–8h) wird aktiviert.",
    confirmed:   "✓ Alkohol-Einflussfaktor gespeichert",
    cancelled:   "Verworfen",
    saving:      "Speichert …",
  },
  en: {
    title:       "Influence factor: Alcohol",
    linked:      "from meal",
    confirm:     "Save",
    dismiss:     "Discard",
    unit:        "g alcohol",
    hint:        "⇄ linked to meal — saved separately. Extended hypo monitoring (6–8h) will be activated.",
    confirmed:   "✓ Alcohol influence saved",
    cancelled:   "Discarded",
    saving:      "Saving …",
  },
} as const;

interface Props {
  payload: InfluencePrepPayload;
  state: "pending" | "confirming" | "confirmed" | "cancelled" | "error";
  onConfirm: () => void;
  onCancel: () => void;
  error?: string;
}

export default function InfluencePrepChip({ payload, state, onConfirm, onCancel, error }: Props) {
  const locale = useLocale() === "en" ? "en" : "de";
  const t = COPY[locale];
  const busy = state === "confirming";

  if (state === "confirmed") {
    return (
      <div style={chipBase({ accent: "#22D3A0", dim: false })}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#22D3A0" }}>{t.confirmed}</span>
      </div>
    );
  }
  if (state === "cancelled") {
    return (
      <div style={chipBase({ accent: "#6b7280", dim: true })}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{t.cancelled}</span>
      </div>
    );
  }

  return (
    <div style={chipBase({ accent: "#f59e0b", dim: false })}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>⇄</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>
            {t.title}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-body)", marginTop: 1 }}>
            <strong>{payload.alcohol_g}g</strong> {t.unit}
            {payload.note && (
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                · {t.linked}: {payload.note.replace(/^aus Mahlzeit: /, "").slice(0, 40)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info hint */}
      <div style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.5 }}>
        {t.hint}
      </div>

      {/* Error */}
      {state === "error" && error && (
        <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={btnSecondary(busy)}
        >
          {t.dismiss}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={btnPrimary(busy, "#f59e0b")}
        >
          {busy ? t.saving : t.confirm}
        </button>
      </div>
    </div>
  );
}

function chipBase({ accent, dim }: { accent: string; dim: boolean }): React.CSSProperties {
  return {
    maxWidth: "82%",
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface-soft)",
    border: `1px solid ${accent}44`,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-strong)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    opacity: dim ? 0.6 : 1,
  };
}

function btnPrimary(busy: boolean, accent: string): React.CSSProperties {
  return {
    flex: 2,
    padding: "9px 12px",
    borderRadius: 8,
    border: "none",
    background: busy ? `${accent}55` : accent,
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: busy ? "default" : "pointer",
  };
}

function btnSecondary(busy: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--border-soft)",
    color: "var(--text-body)",
    fontWeight: 500,
    fontSize: 13,
    cursor: busy ? "default" : "pointer",
  };
}
