"use client";

import { useEffect, useRef, useState } from "react";
import type { GlevChatMessage, PendingAction } from "@/lib/useGlevAI";

const ACCENT = "#4F6EF7";
const SHEET_BG = "#161b22";
const PAGE_BG = "#0f1117";

interface Props {
  open: boolean;
  onClose: () => void;
  messages: GlevChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onConfirmAction?: (messageId: string) => void;
  onCancelAction?: (messageId: string) => void;
}

const DISCLAIMER =
  "Glev ist kein Medizinprodukt. Alle Informationen sind Orientierungspunkte.";

/**
 * Inline confirm/cancel widget attached to an assistant bubble that
 * came back from a WRITE-tool call. Rendered as a soft card directly
 * under the bubble (left-aligned, since assistant bubbles are
 * left-aligned). The five visual states match `PendingActionState` in
 * `lib/useGlevAI.ts`:
 *
 *   pending     → summary + Bestätigen + Abbrechen
 *   confirming  → buttons disabled, "Speichert …"
 *   confirmed   → green check + "Gespeichert"
 *   cancelled   → muted "Abgebrochen"
 *   error       → red error string + Erneut-versuchen
 */
function PendingActionWidget({
  pa,
  onConfirm,
  onCancel,
}: {
  pa: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const baseCard: React.CSSProperties = {
    maxWidth: "82%",
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.92)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const summary = (
    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
      {pa.summary}
    </div>
  );

  if (pa.state === "confirmed") {
    return (
      <div style={{ ...baseCard, borderColor: "rgba(80,200,120,0.4)" }}>
        {summary}
        <div style={{ color: "#7ee0a0", fontWeight: 600, fontSize: 13 }}>
          ✓ Gespeichert
        </div>
      </div>
    );
  }
  if (pa.state === "cancelled") {
    return (
      <div style={{ ...baseCard, opacity: 0.6 }}>
        {summary}
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 13 }}>
          Abgebrochen
        </div>
      </div>
    );
  }
  if (pa.state === "error") {
    return (
      <div style={{ ...baseCard, borderColor: "rgba(255,120,120,0.45)" }}>
        {summary}
        <div style={{ color: "#ff8888", fontSize: 13 }}>
          Speichern fehlgeschlagen: {pa.error ?? "unbekannter Fehler"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Nochmal versuchen
          </button>
        </div>
      </div>
    );
  }

  const busy = pa.state === "confirming";
  return (
    <div style={baseCard}>
      {summary}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            flex: 1,
            padding: "9px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.8)",
            fontSize: 13,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            flex: 1,
            padding: "9px 10px",
            borderRadius: 8,
            border: "none",
            background: busy ? "rgba(79,110,247,0.4)" : ACCENT,
            color: "white",
            fontWeight: 600,
            fontSize: 13,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Speichert …" : "Bestätigen"}
        </button>
      </div>
    </div>
  );
}

/**
 * Bottom-sheet UI hosting the Glev AI conversation. Token-by-token
 * streaming is driven by the parent (useGlevAI) — each assistant
 * bubble grows as new chunks arrive and shows a soft caret while
 * `isStreaming` is true.
 *
 * Renders inside the Capacitor webview shell: uses dvh + safe-area
 * insets so the input row stays above the on-screen keyboard and the
 * home indicator.
 */
export default function GlevAIChatSheet({
  open,
  onClose,
  messages,
  streaming,
  onSend,
  onConfirmAction,
  onCancelAction,
}: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Bewusst KEIN Auto-Focus beim Öffnen: das Software-Keyboard würde
  // sonst auf iOS/Android sofort die halbe Sheet-Höhe verschlucken und
  // den Disclaimer/Input-Footer überdecken. Tastatur kommt erst wenn
  // der User aktiv ins Input-Feld tippt. Siehe Fix Log 2026-05-24
  // (Glev AI: Tastatur nicht beim Öffnen des AI-Chats automatisch).

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  if (!open) return null;

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
  };

  return (
    <>
      <style>{`
        @keyframes glevAiFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes glevAiSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes glevAiCaret { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          zIndex: 1100,
          animation: "glevAiFadeIn 0.2s ease",
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Glev AI Chat"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "85dvh",
          background: SHEET_BG,
          color: "white",
          borderRadius: "20px 20px 0 0",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          zIndex: 1101,
          display: "flex",
          flexDirection: "column",
          animation: "glevAiSlideUp 0.3s cubic-bezier(0.32,0.72,0,1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "white", flex: 1 }}>
            Glev AI
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "2px 8px",
              borderRadius: 99,
              background: "rgba(79,110,247,0.15)",
              color: ACCENT,
              border: `1px solid ${ACCENT}55`,
              marginRight: 12,
            }}
          >
            BETA
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: PAGE_BG,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.45)",
                fontSize: 14,
                textAlign: "center",
                padding: "30px 12px",
              }}
            >
              Frag Glev etwas über deine Werte, IOB oder letzte Mahlzeit.
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: m.role === "user" ? "flex-end" : "flex-start",
                gap: 6,
              }}
            >
              <div
                style={{
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius:
                    m.role === "user"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                  background:
                    m.role === "user" ? ACCENT : "rgba(255,255,255,0.05)",
                  color: m.role === "user" ? "white" : "rgba(255,255,255,0.92)",
                  border:
                    m.role === "assistant"
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content || (m.isStreaming ? "·" : "")}
                {m.isStreaming && m.content.length > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      marginLeft: 3,
                      verticalAlign: "text-bottom",
                      background: "rgba(255,255,255,0.7)",
                      animation: "glevAiCaret 0.9s ease-in-out infinite",
                      borderRadius: 1,
                    }}
                  />
                )}
              </div>

              {/* Pending-action widget (WRITE-tool confirmation gate, Task 2) */}
              {m.pendingAction && (
                <PendingActionWidget
                  pa={m.pendingAction}
                  onConfirm={() => onConfirmAction?.(m.id)}
                  onCancel={() => onCancelAction?.(m.id)}
                />
              )}
            </div>
          ))}
        </div>

        {/* Input row */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px 8px",
            background: SHEET_BG,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Frag Glev …"
            disabled={streaming}
            style={{
              flex: 1,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              fontSize: 14,
              outline: "none",
              opacity: streaming ? 0.7 : 1,
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!input.trim() || streaming}
            aria-label="Senden"
            style={{
              flexShrink: 0,
              width: 38,
              height: 38,
              borderRadius: 19,
              background: !input.trim() || streaming ? "rgba(79,110,247,0.4)" : ACCENT,
              border: "none",
              cursor: !input.trim() || streaming ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>

        {/* Disclaimer footer — below input row, always visible */}
        <div
          style={{
            flexShrink: 0,
            padding: "0 18px calc(10px + env(safe-area-inset-bottom, 0px))",
            background: SHEET_BG,
            fontSize: 11,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.5)",
            textAlign: "center",
          }}
        >
          {DISCLAIMER}
        </div>
      </div>
    </>
  );
}
