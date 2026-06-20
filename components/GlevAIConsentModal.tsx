"use client";

import { useEffect } from "react";
import ResetButton from "@/components/ResetButton";

const ACCENT = "#4F6EF7";
const SHEET_BG = "var(--surface)";

interface Props {
  open: boolean;
  onDismiss: () => void;
  onActivate: () => void;
}

/**
 * Consent modal shown on the first tap of the Glev AI button when
 * `profiles.ai_consent_at` is null. Copy and styling are spec-prescribed
 * (see task #651). Tapping "Aktivieren →" calls `onActivate` which
 * writes consent via /api/ai/consent (in the useGlevAI hook) and then
 * opens the chat sheet.
 */
export default function GlevAIConsentModal({ open, onDismiss, onActivate }: Props) {
  // ESC closes (defensive — modal is also dismissed via backdrop tap).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes glevConsentFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes glevConsentScaleIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onDismiss}
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          zIndex: 1200,
          animation: "glevConsentFadeIn 0.18s ease",
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="glev-ai-consent-title"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          background: SHEET_BG,
          color: "white",
          borderRadius: 18,
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          padding: "24px 22px 18px",
          zIndex: 1201,
          animation: "glevConsentScaleIn 0.22s cubic-bezier(0.32,0.72,0,1)",
          // Respect iOS safe areas so the modal isn't clipped by the
          // notch/home indicator inside the Capacitor webview shell.
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
        }}
      >
        {/* Title row: heading + revoke button top-right */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <h2
            id="glev-ai-consent-title"
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.3,
              flex: 1,
            }}
          >
            Glev Intelligence aktivieren
          </h2>
          <ResetButton onRevoked={onDismiss} style={{ marginTop: -6, marginRight: -8 }} />
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-strong)", margin: "0 0 10px" }}>
          Glev AI hilft dir, Muster in deinen Mahlzeiten, Glukosewerten und Boli
          schneller zu verstehen — als Gesprächspartner, nicht als Arzt.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-body)", margin: "0 0 14px" }}>
          Damit der Assistent deine Frage beantworten kann, wird ein kurzer
          Kontext-Snapshot deiner letzten Werte (Glukose, IOB, letzte Mahlzeit)
          an unser AI-Modell geschickt. Es werden keine Gespräche dauerhaft
          gespeichert.
        </p>

        <a
          href="/legal"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            color: ACCENT,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "underline",
            marginBottom: 18,
          }}
        >
          Datenschutzhinweis lesen
        </a>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              flex: "0 0 auto",
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-strong)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Nicht jetzt
          </button>
          <button
            type="button"
            onClick={onActivate}
            style={{
              flex: "0 0 auto",
              padding: "10px 18px",
              borderRadius: 12,
              border: "none",
              background: ACCENT,
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(79,110,247,0.35)",
            }}
          >
            Aktivieren →
          </button>
        </div>
      </div>
    </>
  );
}
