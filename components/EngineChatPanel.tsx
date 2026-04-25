"use client";

import { useEffect, useRef, useState } from "react";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

export interface ChatPatch {
  carbs:    number;
  protein:  number;
  fat:      number;
  fiber:    number;
  calories: number;
  description: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SeedMessage {
  id: number;
  content: string;
}

export interface EngineChatPanelProps {
  macros:      { carbs: number; protein: number; fat: number; fiber: number };
  description: string;
  onPatch:     (patch: ChatPatch) => void;
  seed?:       SeedMessage | null;
  isMobile:    boolean;
  expanded:    boolean;
  onToggleExpanded: () => void;
}

export default function EngineChatPanel({
  macros, description, onPatch, seed, isMobile, expanded, onToggleExpanded,
}: EngineChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [err, setErr]           = useState("");
  const seedSeenRef             = useRef<number | null>(null);
  const scrollRef               = useRef<HTMLDivElement>(null);

  // Append seeded assistant message (e.g. after voice/parse-food success)
  useEffect(() => {
    if (!seed) return;
    if (seedSeenRef.current === seed.id) return;
    seedSeenRef.current = seed.id;
    setMessages(prev => [...prev, { role: "assistant", content: seed.content }]);
  }, [seed]);

  // Auto-scroll on new messages or while sending
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setErr("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/chat-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          macros,
          description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Chat request failed");
      const reply = typeof data.reply === "string" && data.reply.trim()
        ? data.reply.trim()
        : "(no reply)";
      setMessages(curr => [...curr, { role: "assistant", content: reply }]);
      if (data.macros && typeof data.description === "string") {
        onPatch({
          carbs:    Number(data.macros.carbs)    || 0,
          protein:  Number(data.macros.protein)  || 0,
          fat:      Number(data.macros.fat)      || 0,
          fiber:    Number(data.macros.fiber)    || 0,
          calories: Number(data.macros.calories) || 0,
          description: String(data.description),
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Chat error");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const ready = !sending;
  const hasContent = messages.length > 0;

  // ---- Header (always visible, click to collapse on mobile) -------------
  const header = (
    <div
      onClick={isMobile ? onToggleExpanded : undefined}
      style={{
        display:"flex", alignItems:"flex-start", justifyContent:"space-between",
        gap:12, padding:"18px 20px",
        borderBottom: expanded ? `1px solid ${BORDER}` : "none",
        cursor: isMobile ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.02em", color:"#fff" }}>
          GPT REASONING
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:3, lineHeight:1.45 }}>
          See why these macros were chosen — or correct them
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <div style={{
          display:"inline-flex", alignItems:"center", gap:6,
          padding:"4px 10px", borderRadius:99,
          background: sending ? `${ORANGE}18` : `${GREEN}18`,
          border: `1px solid ${sending ? ORANGE : GREEN}40`,
          fontSize:10, fontWeight:700, letterSpacing:"0.06em",
          color: sending ? ORANGE : GREEN,
        }}>
          <span style={{
            width:6, height:6, borderRadius:"50%",
            background: sending ? ORANGE : GREEN,
            boxShadow: `0 0 6px ${sending ? ORANGE : GREEN}`,
          }}/>
          {sending ? "THINKING" : "READY"}
        </div>
        {isMobile && (
          <button
            type="button"
            aria-label={expanded ? "Collapse chat" : "Expand chat"}
            onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
            style={{
              background:"transparent", border:"none", color:"rgba(255,255,255,0.55)",
              cursor:"pointer", padding:4, display:"flex", alignItems:"center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition:"transform 0.15s" }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  // Collapsed mobile: header only
  if (isMobile && !expanded) {
    return (
      <div style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
      }}>
        {header}
        {hasContent && (
          <div style={{
            padding:"8px 20px 14px",
            fontSize:11, color:"rgba(255,255,255,0.4)",
            borderTop: `1px solid ${BORDER}`,
          }}>
            {messages.length} message{messages.length === 1 ? "" : "s"} — tap to open
          </div>
        )}
      </div>
    );
  }

  // ---- Body (messages + input) ------------------------------------------
  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 16,
      display:"flex", flexDirection:"column",
      height: isMobile ? "60vh" : "100%",
      minHeight: isMobile ? 380 : 0,
      overflow:"hidden",
    }}>
      {header}

      <div
        ref={scrollRef}
        style={{
          flex:1, minHeight:0, overflowY:"auto",
          padding:"18px 20px",
          display:"flex", flexDirection:"column", gap:12,
        }}
      >
        {messages.length === 0 && !sending && (
          <div style={{
            margin:"auto",
            textAlign:"center",
            color:"rgba(255,255,255,0.4)",
            fontSize:13, lineHeight:1.65, maxWidth:340,
          }}>
            Once you log a meal (voice or text), GPT will explain how it broke down the macros here. You can ask follow-ups or push back — corrections you confirm are applied to the form on the left.
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%",
            background: m.role === "user" ? `${ACCENT}22` : "rgba(255,255,255,0.04)",
            border: `1px solid ${m.role === "user" ? `${ACCENT}40` : BORDER}`,
            borderRadius: 12,
            padding: "10px 13px",
            fontSize: 13, lineHeight: 1.55,
            color: m.role === "user" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.78)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {m.content}
          </div>
        ))}

        {sending && (
          <div style={{
            alignSelf:"flex-start", display:"flex", gap:5, padding:"10px 13px",
            background:"rgba(255,255,255,0.04)", border:`1px solid ${BORDER}`, borderRadius:12,
          }}>
            {[0,1,2].map(i => (
              <span key={i} style={{
                width:6, height:6, borderRadius:"50%",
                background:"rgba(255,255,255,0.45)",
                animation:`engChatDot 1.1s ease-in-out ${i*0.15}s infinite`,
              }}/>
            ))}
          </div>
        )}

        {err && (
          <div style={{
            alignSelf:"stretch", padding:"8px 12px",
            background:`${PINK}15`, border:`1px solid ${PINK}40`, borderRadius:10,
            color:PINK, fontSize:12,
          }}>
            {err}
          </div>
        )}
      </div>

      <style>{`
        @keyframes engChatDot { 0%,80%,100%{opacity:0.25;transform:scale(0.85)} 40%{opacity:1;transform:scale(1)} }
      `}</style>

      <div style={{
        padding:"12px 14px",
        borderTop: `1px solid ${BORDER}`,
        display:"flex", gap:8, alignItems:"center",
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask or correct… e.g. 'the banana was bigger'"
          disabled={sending}
          style={{
            flex:1, minWidth:0,
            padding:"11px 14px",
            background:"rgba(255,255,255,0.04)",
            border:`1px solid ${BORDER}`,
            borderRadius:10,
            color:"#fff", fontSize:13, outline:"none",
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            padding:"11px 18px",
            borderRadius:10, border:"none",
            background: input.trim() && !sending
              ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
              : "rgba(255,255,255,0.06)",
            color: input.trim() && !sending ? "#fff" : "rgba(255,255,255,0.35)",
            fontSize:13, fontWeight:700,
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            transition:"all 0.15s",
            opacity: ready ? 1 : 0.7,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
