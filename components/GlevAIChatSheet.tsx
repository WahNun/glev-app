"use client";

import { useEffect, useRef, useState } from "react";
import type { GlevChatMessage, PendingAction } from "@/lib/useGlevAI";
import { useVoxtral } from "@/hooks/useVoxtral";
import { useTTS } from "@/hooks/useTTS";

const ACCENT = "#8b5cf6";
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
  onClearChat?: () => void;
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
  onClearChat,
}: Props) {
  const [input, setInput] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttPartial, setSttPartial] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-send ref so we can access latest onSend + input without
  // capturing a stale closure inside useVoxtral.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const inputRef2 = useRef(input);
  inputRef2.current = input;

  const { isListening, startListening, stopListening } = useVoxtral({
    onTranscript: (text) => {
      setSttError(null);
      setSttPartial(null);
      if (!text.trim()) return;
      // Voice → auto-send immediately (Siri-Modus).
      // If the user had partial typed text, prepend it so nothing is lost.
      const combined = inputRef2.current
        ? `${inputRef2.current} ${text}`.trim()
        : text.trim();
      setInput("");
      onSendRef.current(combined);
    },
    onPartialTranscript: (text) => {
      setSttError(null);
      setSttPartial(text);
    },
    onError: (err) => {
      setSttPartial(null);
      setSttError(err);
    },
  });

  const tts = useTTS();

  // TTS: auto-play last assistant message when streaming stops.
  // Controlled by tts.autoRead (user preference set in the chat header).
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming && tts.enabled && tts.autoRead) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant" && last.content) {
        void tts.speak(last.content, last.id);
      }
    }
    prevStreamingRef.current = streaming;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Global FAB voice-start: when the user taps the Glev button while
  // the sheet is already open, we immediately start recording so they
  // can speak without finding the in-sheet mic button.
  useEffect(() => {
    if (!open) return;
    const handler = () => { void startListening(); };
    window.addEventListener("glev:voice-start", handler);
    return () => window.removeEventListener("glev:voice-start", handler);
  }, [open, startListening]);

  // Stop TTS when the sheet closes.
  useEffect(() => {
    if (!open) tts.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tap-anywhere-to-stop for the chat mic.
  // Same pattern as voiceRecordingContext: 250ms grace so the tap that
  // started recording doesn't immediately cancel it. Skips the mic button
  // itself (data-glev-mic) and the FAB (data-glev-fab) so their own
  // handlers stay in charge.
  useEffect(() => {
    if (!isListening) return;
    let armed = false;
    const timer = window.setTimeout(() => { armed = true; }, 250);
    const onDown = (e: PointerEvent) => {
      if (!armed) return;
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-glev-mic]") || target.closest('[data-glev-fab="true"]')) return;
      stopListening();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [isListening, stopListening]);

  // Broadcast TTS speaking state so the FAB can glow green.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("glev:tts-speaking", { detail: { active: tts.speaking } }),
    );
  }, [tts.speaking]);

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
        @keyframes glevBtnGlowFast {
          0%, 100% { box-shadow: 0 0 0 0 rgba(79,110,247,0.7); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(79,110,247,0); transform: scale(1.08); }
        }
        @keyframes glevStatusPulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: "var(--nav-bottom-total)",
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
          bottom: "var(--nav-bottom-total)",
          left: 0,
          right: 0,
          height: "calc(85dvh - var(--nav-bottom-total))",
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
          {/* Reset / clear chat button */}
          {onClearChat && (
            <button
              type="button"
              onClick={onClearChat}
              aria-label="Chat zurücksetzen"
              title="Chat zurücksetzen"
              disabled={messages.length === 0 && !streaming}
              style={{
                background: "none",
                border: "none",
                cursor: messages.length === 0 && !streaming ? "default" : "pointer",
                padding: 4,
                marginRight: 2,
                display: "flex",
                alignItems: "center",
                color: messages.length === 0 && !streaming
                  ? "rgba(255,255,255,0.15)"
                  : "rgba(255,255,255,0.5)",
                transition: "color 0.15s",
              }}
            >
              {/* Clockwise rotate arrow (reset icon) */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
              </svg>
            </button>
          )}
          {/* TTS auto-read toggle — controls whether AI responses are spoken automatically */}
          <button
            type="button"
            onClick={tts.toggleAutoRead}
            aria-label={tts.autoRead ? "Sprachausgabe aus" : "Sprachausgabe ein"}
            title={tts.autoRead ? "Sprachausgabe aus" : "Sprachausgabe ein"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              marginRight: 6,
              display: "flex",
              alignItems: "center",
              color: tts.speaking ? ACCENT : tts.autoRead ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
              transition: "color 0.15s",
            }}
          >
            {tts.autoRead ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            )}
          </button>
          {/* Dynamic status badge */}
          {(() => {
            const isSpeaking = tts.speaking;
            const isAnalyzing = streaming;
            const dotColor = isSpeaking ? "#50C878" : isAnalyzing ? ACCENT : "#50C878";
            const label = isSpeaking ? "Spricht …" : isAnalyzing ? "Analysiert …" : "BEREIT";
            const bgColor = isSpeaking
              ? "rgba(80,200,120,0.12)"
              : isAnalyzing
              ? "rgba(139,92,246,0.12)"
              : "rgba(80,200,120,0.10)";
            const borderColor = isSpeaking
              ? "rgba(80,200,120,0.35)"
              : isAnalyzing
              ? `${ACCENT}44`
              : "rgba(80,200,120,0.28)";
            return (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  padding: "3px 8px 3px 6px",
                  borderRadius: 99,
                  background: bgColor,
                  color: dotColor,
                  border: `1px solid ${borderColor}`,
                  marginRight: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    animation: (isSpeaking || isAnalyzing)
                      ? "glevStatusPulse 0.9s ease-in-out infinite"
                      : "none",
                    display: "inline-block",
                  }}
                />
                {label}
              </span>
            );
          })()}
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
                {m.content || (m.isStreaming ? "·" : (m.role === "assistant" ? "···" : ""))}
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

              {/* Per-bubble speaker icon — only for finished assistant messages */}
              {m.role === "assistant" && !m.isStreaming && m.content && (() => {
                const isThisBubblePlaying = tts.speakingId === m.id;
                return (
                  <button
                    type="button"
                    aria-label={isThisBubblePlaying ? "Wiedergabe stoppen" : "Vorlesen"}
                    onClick={() => {
                      if (isThisBubblePlaying) {
                        tts.stop();
                      } else {
                        void tts.speak(m.content, m.id);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px 4px",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      color: isThisBubblePlaying ? ACCENT : "rgba(255,255,255,0.35)",
                      fontSize: 11,
                      lineHeight: 1,
                      transition: "color 0.15s",
                      animation: isThisBubblePlaying ? "glevBtnGlowFast 0.7s ease-in-out infinite" : "none",
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)";
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  </button>
                );
              })()}

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
          {/* Mic button — hold to talk */}
          <button
            type="button"
            data-glev-mic="true"
            aria-label={isListening ? "Aufnahme stoppen" : "Spracheingabe starten"}
            aria-pressed={isListening}
            onPointerDown={(e) => {
              e.preventDefault();
              void startListening();
            }}
            onPointerUp={() => stopListening()}
            onPointerLeave={() => { if (isListening) stopListening(); }}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              borderRadius: 18,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isListening ? ACCENT : "#21262d",
              animation: isListening ? "glevBtnGlowFast 0.7s ease-in-out infinite" : "none",
              touchAction: "none",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>

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
            placeholder={isListening ? "Spreche …" : "Frag Glev …"}
            disabled={streaming}
            style={{
              flex: 1,
              border: `1px solid ${isListening ? `${ACCENT}66` : "rgba(255,255,255,0.1)"}`,
              borderRadius: 20,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              fontSize: 14,
              outline: "none",
              opacity: streaming ? 0.7 : 1,
              transition: "border-color 0.2s",
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

        {/* STT partial transcript — greyed-out live preview while speaking */}
        {isListening && sttPartial && (
          <div
            style={{
              flexShrink: 0,
              padding: "2px 16px 4px",
              fontSize: 12,
              color: "rgba(255,255,255,0.35)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sttPartial}
          </div>
        )}

        {/* STT error toast — shown briefly when transcription fails */}
        {sttError && (
          <div
            style={{
              flexShrink: 0,
              padding: "4px 16px 6px",
              background: SHEET_BG,
              fontSize: 11,
              color: "#ff8888",
              textAlign: "center",
            }}
          >
            {sttError}
          </div>
        )}

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
