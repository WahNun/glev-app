"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

interface Message {
  id: number;
  role: "user" | "ai";
  text: string;
}

type Content = {
  title: string;
  engineLink: string;
  emptyState: string;
  placeholder: string;
  disclaimer: string;
  chips: string[];
  aiReplies: string[];
  ariaHistory: string;
  ariaSettings: string;
  ariaClose: string;
  ariaAttachment: string;
  ariaMic: string;
  ariaSend: string;
};

const DE: Content = {
  title: "Frag Glev",
  engineLink: "Zur Glev Engine →",
  emptyState: "Frag Glev etwas über deine Einheiten,\nMahlzeiten oder deinen IOB.",
  placeholder: "Frag Glev …",
  disclaimer: "Glev AI kann sich irren · keine medizinische Beratung",
  chips: [
    "Wie wirkt diese Mahlzeit?",
    "Erkläre meinen IOB",
    "Was sagt mein Verlauf heute?",
    "Tipps für stabilen BZ",
  ],
  aiReplies: [
    "Ich schaue mir das gerade an — dein Verlauf sieht interessant aus. Schreib mir gerne mehr dazu.",
    "Gute Frage. Basierend auf deinen letzten Einträgen würde ich sagen: Sprich das mit deinem Diabetologen-Team an.",
    "Das ist eine typische Muster-Frage. Ich bin bald in der Lage, dir datenbasierte Antworten zu geben — bleib dran!",
  ],
  ariaHistory: "Verlauf",
  ariaSettings: "Einstellungen",
  ariaClose: "Schließen",
  ariaAttachment: "Anhang",
  ariaMic: "Spracheingabe",
  ariaSend: "Senden",
};

const EN: Content = {
  title: "Ask Glev",
  engineLink: "Open Glev Engine →",
  emptyState: "Ask Glev anything about your units,\nmeals or your IOB.",
  placeholder: "Ask Glev anything…",
  // MDR: no "recommendation" for therapy — "assessment" only
  disclaimer: "Glev AI can be wrong · not a medical assessment",
  chips: [
    "How will this meal affect me?",
    "Explain my IOB",
    "What does my trend say today?",
    "Tips for steady glucose",
  ],
  aiReplies: [
    "I'm looking into that — your trend looks interesting. Feel free to tell me more.",
    "Good question. Based on your recent entries I'd say: bring this up with your diabetes care team.",
    "That's a common pattern question. I'll soon be able to give you data-driven answers — stay tuned!",
  ],
  ariaHistory: "History",
  ariaSettings: "Settings",
  ariaClose: "Close",
  ariaAttachment: "Attachment",
  ariaMic: "Voice input",
  ariaSend: "Send",
};

let _aiReplyIndex = 0;

let _id = 0;
function nextId() { return _id++; }

export default function AiHelperSheet({
  open,
  onClose,
  onListeningChange,
}: {
  open: boolean;
  onClose: () => void;
  onListeningChange?: (v: boolean) => void;
}) {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Bewusst KEIN auto-focus mehr beim Öffnen: auf Mobile (iOS/Android) hat
  // das Sheet sonst sofort das Software-Keyboard hochgefahren, was die
  // halbe Höhe des Sheets verschluckt und die Quick-Chips/„Zur Glev Engine"-
  // Deep-Links überdeckt hat. Tastatur kommt jetzt erst, wenn der User
  // aktiv ins Input tippt — Verlauf, Chips und Engine-Link bleiben sichtbar.
  // (Eslint-Hinweis: inputRef bleibt für Submit-Reset über useRef belegt.)
  void inputRef;

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || thinking) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
    setInput("");
    setThinking(true);
    onListeningChange?.(true);
    setTimeout(() => {
      setThinking(false);
      onListeningChange?.(false);
      const reply = C.aiReplies[_aiReplyIndex % C.aiReplies.length];
      _aiReplyIndex++;
      setMessages((prev) => [...prev, { id: nextId(), role: "ai", text: reply }]);
    }, 800);
  }, [input, thinking, onListeningChange, C.aiReplies]);

  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes glevSheetFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes glevSheetSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          zIndex: 1200,
          animation: "glevSheetFadeIn 0.2s ease",
        }}
      />

      {/* Sheet panel */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "85dvh",
          background: "var(--surface)",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          zIndex: 1201,
          display: "flex",
          flexDirection: "column",
          animation: "glevSheetSlideUp 0.3s cubic-bezier(0.32,0.72,0,1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: "var(--text)",
              flex: 1,
            }}
          >
            {C.title}
          </span>

          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "2px 8px",
              borderRadius: 99,
              background: "rgba(79,110,247,0.15)",
              color: "#4F6EF7",
              border: "1px solid rgba(79,110,247,0.3)",
              marginRight: 12,
            }}
          >
            BETA
          </span>

          {/* History — non-functional */}
          <button
            aria-label={C.ariaHistory}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 4,
              marginRight: 4,
              display: "flex",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          {/* Settings — non-functional */}
          <button
            aria-label={C.ariaSettings}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 4,
              marginRight: 4,
              display: "flex",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.72a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            aria-label={C.ariaClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
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

        {/* Engine deep-link */}
        <div
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--border-soft)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => { onClose(); router.push("/engine"); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              color: "#4F6EF7",
              fontWeight: 500,
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {C.engineLink}
          </button>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 && !thinking && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-faint)",
                fontSize: 14,
                textAlign: "center",
                padding: "40px 0",
              }}
            >
              {C.emptyState.split("\n").map((line, i) => (
                <span key={i}>{i > 0 && <br />}{line}</span>
              ))}
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius:
                    m.role === "user"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                  background:
                    m.role === "user" ? "#4F6EF7" : "var(--surface-soft)",
                  color: m.role === "user" ? "white" : "var(--text)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  border:
                    m.role === "ai"
                      ? "1px solid var(--border)"
                      : "none",
                }}
              >
                {m.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: "18px 18px 18px 4px",
                  background: "var(--surface-soft)",
                  border: "1px solid var(--border)",
                  color: "var(--text-faint)",
                  fontSize: 18,
                  letterSpacing: 2,
                }}
              >
                ···
              </div>
            </div>
          )}

          <div ref={msgEndRef} />
        </div>

        {/* Footer: chips + input bar */}
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          {/* Quick chips */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 16px 6px",
              overflowX: "auto",
              scrollbarWidth: "none",
            }}
          >
            {C.chips.map((chip) => (
              <button
                key={chip}
                onClick={() => setInput(chip)}
                style={{
                  flexShrink: 0,
                  padding: "6px 12px",
                  borderRadius: 99,
                  border: "1px solid var(--border)",
                  background: "var(--surface-soft)",
                  color: "var(--text)",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px 20px",
            }}
          >
            {/* + attachment — non-functional */}
            <button
              aria-label={C.ariaAttachment}
              style={{
                flexShrink: 0,
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={C.placeholder}
              style={{
                flex: 1,
                border: "1px solid var(--border)",
                borderRadius: 20,
                padding: "9px 14px",
                background: "var(--surface-soft)",
                color: "var(--text)",
                fontSize: 14,
                outline: "none",
              }}
            />

            {/* Mic — non-functional */}
            <button
              aria-label={C.ariaMic}
              style={{
                flexShrink: 0,
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>

            {/* Send — visible only when input is non-empty */}
            {input.trim() && (
              <button
                onClick={send}
                aria-label={C.ariaSend}
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: "#4F6EF7",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            )}
          </div>

          {/* Medical-Compliance-Disclaimer (Glev ist KEIN eingereichtes
              Medizinprodukt; klinischer Charakter dieser Hinweise wird
              im Compliance-Backlog vor MDR-Einreichung verschärft). Der
              kleine Text sitzt direkt unter dem Input und ist immer
              sichtbar, sobald das AI-Helper-Sheet offen ist. */}
          <div
            style={{
              padding: "0 16px 12px",
              fontSize: 11,
              lineHeight: 1.4,
              color: "var(--text-faint)",
              textAlign: "center",
            }}
          >
            {C.disclaimer}
          </div>
        </div>
      </div>
    </>
  );
}
