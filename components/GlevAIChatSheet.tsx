"use client";

import { useEffect, useRef, useState } from "react";
import type { GlevChatMessage, PendingAction } from "@/lib/useGlevAI";
import { useVoiceIntents } from "@/hooks/useVoiceIntents";
import { useTTS } from "@/hooks/useTTS";
import IntentConfirmChip, { intentLabel } from "@/components/IntentConfirmChip";
import GlevLogo from "@/components/GlevLogo";

const ACCENT = "#8b5cf6";
const SHEET_BG = "var(--surface)";
const PAGE_BG = "var(--bg)";

interface Props {
  open: boolean;
  onClose: () => void;
  messages: GlevChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onConfirmAction?: (messageId: string, token: string) => void;
  onCancelAction?: (messageId: string, token: string) => void;
  onClearChat?: () => void;
  /** Called whenever the chat sheet's STT listening state changes so the
   *  parent (Layout.tsx) can reflect it on the FAB. */
  onListeningChange?: (listening: boolean) => void;
  /** When set, a tap chip is shown inviting the user to open the Engine.
   *  Cleared automatically when the user taps the chip (via onMealNavTap). */
  pendingMealNav?: string | null;
  onMealNavTap?: () => void;
  /**
   * When true, voice transcripts are classified into intents before
   * reaching the chat pipeline. Requires voice_intent_routing feature flag.
   * Non-matching intents still fall through to the normal chat flow.
   */
  voiceIntentEnabled?: boolean;
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
    background: "var(--surface-soft)",
    border: "1px solid var(--border)",
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-strong)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const summary = (
    <div style={{ color: "var(--text-body)", fontSize: 12 }}>
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
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
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
              border: "1px solid var(--border-strong)",
              background: "var(--border-soft)",
              color: "var(--text-strong)",
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
            border: "1px solid var(--border-strong)",
            background: "var(--surface-soft)",
            color: "var(--text-body)",
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
            color: "var(--on-accent)",
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
  onListeningChange,
  pendingMealNav,
  onMealNavTap,
  voiceIntentEnabled = false,
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

  const {
    isListening,
    startListening,
    stopListening,
    pendingIntent,
    confirmPendingIntent,
    dismissPendingIntent,
  } = useVoiceIntents({
    // When voice_intent_routing is enabled and the classifier returns
    // fallback_chat (or is disabled), the transcript is sent normally.
    onFallbackTranscript: (text) => {
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
    enabled: voiceIntentEnabled,
  });

  const tts = useTTS();

  // TTS: announce recognised intent aloud as soon as pendingIntent is set.
  // Only fires when tts.enabled AND tts.intentAnnounce (opt-in, default off).
  // The speech starts immediately — before the chip animation — so the user
  // hears feedback without looking at the screen.
  useEffect(() => {
    if (!pendingIntent) return;
    if (!tts.enabled || !tts.intentAnnounce) return;
    void tts.speak(intentLabel(pendingIntent));
  // tts.speak and tts.stop are stable callbacks; only run when pendingIntent changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIntent]);

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

  // Notify parent whenever the chat sheet's STT listening state changes so
  // the FAB in Layout.tsx can show the listening animation independently of
  // the engine voice-recording state (voice.recording).
  useEffect(() => {
    onListeningChange?.(isListening);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

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
          color: "var(--text)",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
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
            borderBottom: "1px solid var(--border-soft)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", flex: 1 }}>
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
                  ? "var(--text-ghost)"
                  : "var(--text-dim)",
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
              color: tts.speaking ? ACCENT : tts.autoRead ? "var(--text-body)" : "var(--text-faint)",
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
              color: "var(--text-muted)",
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
                color: "var(--text-dim)",
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
                    m.role === "user" ? ACCENT : "var(--surface-soft)",
                  color: m.role === "user" ? "var(--on-accent)" : "var(--text-strong)",
                  border:
                    m.role === "assistant"
                      ? "1px solid var(--border-soft)"
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
                      background: "var(--text-body)",
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
                      color: isThisBubblePlaying ? ACCENT : "var(--text-faint)",
                      fontSize: 11,
                      lineHeight: 1,
                      transition: "color 0.15s",
                      animation: isThisBubblePlaying ? "glevBtnGlowFast 0.7s ease-in-out infinite" : "none",
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-body)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-faint)";
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  </button>
                );
              })()}

              {/* Pending-action widgets — one chip per WRITE-tool call in this turn */}
              {m.pendingActions?.map((pa) => (
                <PendingActionWidget
                  key={pa.token}
                  pa={pa}
                  onConfirm={() => onConfirmAction?.(m.id, pa.token)}
                  onCancel={() => onCancelAction?.(m.id, pa.token)}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Intent confirmation chip — shown for 2-3 s after voice classification */}
        {pendingIntent && (
          <IntentConfirmChip
            intent={pendingIntent}
            onConfirm={confirmPendingIntent}
            onDismiss={dismissPendingIntent}
          />
        )}

        {/* Meal-nav tap chip — shown after AI confirms a meal_prep response */}
        {pendingMealNav && (
          <button
            onClick={onMealNavTap}
            style={{
              margin: "4px 16px 4px",
              padding: "10px 16px",
              borderRadius: 12,
              border: "1.5px solid " + ACCENT,
              background: "rgba(139,92,246,0.12)",
              color: ACCENT,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "calc(100% - 32px)",
              justifyContent: "center",
            }}
          >
            <span>Engine öffnen</span>
            <span style={{ fontSize: 16 }}>→</span>
          </button>
        )}

        {/* Input row */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px 8px",
            background: SHEET_BG,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          {/* Mic button — hold to talk; Glev icon rotates while listening */}
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
              border: isListening ? `1px solid ${ACCENT}` : "1px solid var(--border)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isListening ? "rgba(139,92,246,0.12)" : "var(--surface-alt)",
              animation: "none",
              touchAction: "none",
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: isListening ? "glevIconSpin 1.6s linear infinite" : "none",
              }}
            >
              <GlevLogo size={20} color={isListening ? ACCENT : "var(--text-dim)"} bg="transparent" />
            </span>
            <style>{`
              @keyframes glevIconSpin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
              }
            `}</style>
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
              border: `1px solid ${isListening ? `${ACCENT}66` : "var(--border)"}`,
              borderRadius: 20,
              padding: "10px 14px",
              background: "var(--surface-soft)",
              color: "var(--text)",
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--on-accent)">
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
              color: "var(--text-faint)",
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
            color: "var(--text-dim)",
            textAlign: "center",
          }}
        >
          {DISCLAIMER}
        </div>
      </div>
    </>
  );
}
