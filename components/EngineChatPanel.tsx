"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

// Source tag for one ingredient — mirrors lib/nutrition/types.ts.
// Kept inlined (no import) to avoid pulling server-side type files
// into the client bundle.
export type ChatItemSource = "open_food_facts" | "usda" | "estimated" | "unknown";

export interface ChatItem {
  name:    string;
  grams:   number;
  carbs:   number;
  protein: number;
  fat:     number;
  fiber:   number;
  source:  ChatItemSource;
}

export interface ChatPatch {
  carbs:    number;
  protein:  number;
  fat:      number;
  fiber:    number;
  calories: number;
  description: string;
  // Optional provenance from the DB-backed re-aggregation in
  // /api/chat-macros. Surfaces the source badge in the engine page
  // so the user can see when a chat correction landed in OFF/USDA
  // vs fell back to AI estimation. Null when the chat reply was a
  // pure meta question (no description change → no re-lookup).
  // 'unknown' = at least one ingredient couldn't be resolved even by
  // GPT estimate; the engine page refuses to auto-populate macros.
  nutritionSource?: "database" | "mixed" | "estimated" | "unknown" | null;
  // Per-item breakdown so the engine page can persist provenance into
  // meals.parsed_json (jsonb). Empty/null when the chat round was a
  // pure meta question that didn't re-aggregate.
  items?: ChatItem[] | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Provenance pill to render INLINE under this message. Only set on
  // assistant messages that came from a successful re-aggregation —
  // null/undefined for greetings, errors, and meta-question replies.
  // The pill mirrors the Step-2 badge in the engine page so the user
  // sees the same database/mixed/estimated/unknown verdict at the
  // exact spot in the conversation where the macros changed.
  source?: ChatItemSource | "database" | "mixed" | null;
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
  // External signal: voice-to-macros pipeline is currently parsing (Whisper +
  // /api/parse-food). Surfaced in the mobile chip status badge so the user
  // gets the feedback exactly where the parser identifies itself, instead of
  // muddling the Meal Classification chip with a transient state that has
  // nothing to do with classification.
  parsing?:    boolean;
  // Whether the user has already used voice input this session. Drives
  // the one-shot collapsed-state hint ("▸ Tippe um Details zu sehen").
  // Once true the hint stays hidden because the auto-expand on parse
  // already taught the user the panel exists — repeating it would be
  // noise.
  hasUsedVoice?: boolean;
}

export default function EngineChatPanel({
  macros, description, onPatch, seed, isMobile, expanded, onToggleExpanded,
  parsing = false, hasUsedVoice = false,
}: EngineChatPanelProps) {
  // Pull from the `log` namespace because every chat-panel string
  // (intro, placeholder, send button, status chip labels, parser title)
  // was already curated and translated there for the legacy /log
  // wizard. Reusing the same keys keeps a single source of truth for
  // German + English copy across both the old log page and this new
  // engine chat panel.
  const t = useTranslations("log");
  // Source-pill labels live under the `engine` namespace alongside the
  // matching Step-2 macros badge, so use a separate translator. Avoids
  // the missing-key warnings that would otherwise mark the pill as
  // broken (regression caught in code review).
  const tEngine = useTranslations("engine");
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
      if (!res.ok) throw new Error(data?.error || t("chat_request_failed"));
      const reply = typeof data.reply === "string" && data.reply.trim()
        ? data.reply.trim()
        : t("chat_no_reply");
      // Source tag for the bot reply — drives the inline pill rendered
      // beneath this message and the Step-2 badge in the parent page.
      const ns = data.nutritionSource;
      const source: ChatPatch["nutritionSource"] =
        ns === "database" || ns === "mixed" || ns === "estimated" || ns === "unknown" ? ns : null;
      setMessages(curr => [...curr, {
        role: "assistant",
        content: reply,
        source: source ?? null,
      }]);
      if (data.macros && typeof data.description === "string") {
        // Forward both totals AND the per-item breakdown so the engine
        // page can save provenance into meals.parsed_json. items is
        // optional in the response — guard against malformed shapes
        // by filtering anything that isn't a plain object.
        const items = Array.isArray(data.items)
          ? (data.items as unknown[]).filter(
              (it) => it && typeof it === "object",
            ) as ChatItem[]
          : null;
        onPatch({
          carbs:    Number(data.macros.carbs)    || 0,
          protein:  Number(data.macros.protein)  || 0,
          fat:      Number(data.macros.fat)      || 0,
          fiber:    Number(data.macros.fiber)    || 0,
          calories: Number(data.macros.calories) || 0,
          description: String(data.description),
          nutritionSource: source,
          items,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("chat_error"));
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

  // ---- Card header (combined title + status pill) -----------------------
  // The standalone "AI FOOD PARSER · GPT-powered · STATUS" chip that used
  // to sit between the Sprechen button and the chat card on mobile is
  // gone — its left-side label is now folded into the chat-card title
  // itself ("AI FOOD PARSER" in grey + "GPT reasoning" in ACCENT) so
  // there is one identifier instead of two stacked ones. The status
  // pill (READY / PARSING / THINKING) moves with the title so the
  // user still sees the live engine state from the same place.
  const header = (
    <div
      style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:12, padding:"14px 18px",
        borderBottom: `1px solid ${BORDER}`,
        userSelect: "none",
      }}
    >
      <div style={{ display:"flex", alignItems:"baseline", gap:8, minWidth:0, flex:1 }}>
        <span style={{
          fontSize:12, fontWeight:700, letterSpacing:"0.08em",
          color:"var(--text-dim)",
          whiteSpace:"nowrap",
        }}>
          {t("ai_food_parser_caps")}
        </span>
        <span style={{
          fontSize:11, fontWeight:600, color:ACCENT, letterSpacing:"0.04em",
          whiteSpace:"nowrap",
        }}>
          {t("gpt_reasoning_title")}
        </span>
      </div>
      {/* Status precedence: parsing (voice→macros pipeline) > sending
          (chat round-trip) > ready. Parsing wins because it's the
          longest-running and most user-visible op of the three. Busy
          states render a spinning arc instead of a static dot so the
          user gets unambiguous "still working" feedback. */}
      {(() => {
        const isBusy = parsing || sending;
        const label  = parsing
          ? t("chat_status_parsing")
          : sending
            ? t("chat_status_thinking")
            : t("chat_status_ready");
        const color  = isBusy ? ORANGE : GREEN;
        return (
          <div style={{
            display:"inline-flex", alignItems:"center", gap:6,
            padding:"4px 10px", borderRadius:99,
            background: `${color}18`,
            border: `1px solid ${color}40`,
            fontSize:10, fontWeight:700, letterSpacing:"0.06em",
            color, flexShrink:0,
          }}>
            <style>{`@keyframes efpSpin { to { transform: rotate(360deg) } }`}</style>
            {isBusy ? (
              <svg
                width="10" height="10" viewBox="0 0 24 24"
                fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
                style={{ animation: "efpSpin 0.9s linear infinite", flexShrink: 0 }}
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            ) : (
              <span style={{
                width:6, height:6, borderRadius:"50%",
                background: color,
                boxShadow: `0 0 6px ${color}`,
              }}/>
            )}
            {label}
          </div>
        );
      })()}
    </div>
  );

  // ---- Mobile: single body card with the new combined header -------------
  // The expand/collapse chip is gone, so the panel is always rendered as
  // a single bordered card (matching the desktop layout). `expanded` and
  // `onToggleExpanded` are still accepted as props for backwards
  // compatibility with callers but no longer drive the rendering — the
  // engine page only ever passes expanded={true} anyway, and the chip-
  // less design has no use for a collapsed state.
  void expanded; void onToggleExpanded; void hasUsedVoice;
  if (isMobile) {
    return (
      <div style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        display:"flex", flexDirection:"column",
        // Per UX request: the chat panel should claim the ENTIRE
        // vertical space between the Sprechen button above and the
        // fixed bottom tab bar below — no longer capped at 50 dvh.
        // svh = the viewport at its smallest (browser chrome at its
        // tallest), so first-paint never clips the input row.
        // Reservation ~340 px = global app header (~64) + step
        // indicator + sub-tab toggle + Sprechen pill + small gaps
        // (~196) + bottom tab bar (~80). Min 200 keeps the panel
        // usable on iPhone SE 1st-gen / mini in case the reservation
        // overshoots on a particular browser chrome height. The
        // Weiter / Zurück action button is intentionally pushed
        // below the visible area when shown — Step 1 only reveals
        // it once macros are filled, at which point the user is
        // about to advance anyway.
        height:
          "calc(100svh - 340px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
        minHeight: 200,
        overflow:"hidden",
      }}>
        {header}
        {renderBody()}
      </div>
    );
  }

  // ---- Desktop: same combined-header card --------------------------------
  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 16,
      display:"flex", flexDirection:"column",
      height: "100%", minHeight: 0,
      overflow:"hidden",
    }}>
      {header}
      {renderBody()}
    </div>
  );

  // ---- Body (messages + input), shared by mobile-expanded and desktop ----
  function renderBody() {
    return (
      <>
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
              color:"var(--text-dim)",
              fontSize:13, lineHeight:1.65, maxWidth:340,
            }}>
              {t("chat_intro")}
            </div>
          )}

          {messages.map((m, i) => {
            // Inline source pill, only for assistant messages that
            // carried a re-aggregation. Mirrors the Step-2 macros
            // badge palette so users can correlate at a glance:
            // green DB, orange mixed, pink estimated, red unknown.
            const pill = m.role === "assistant" && m.source ? (() => {
              const palette =
                m.source === "database" ? { c: GREEN,    label: tEngine("nutrition_source_database") }
                : m.source === "mixed"   ? { c: ORANGE,   label: tEngine("nutrition_source_mixed") }
                : m.source === "unknown" ? { c: "#FF6B6B", label: tEngine("nutrition_source_unknown") }
                                         : { c: PINK,    label: tEngine("nutrition_source_estimated") };
              return (
                <div style={{
                  marginTop: 6,
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "2px 8px", borderRadius: 99,
                  background: `${palette.c}18`,
                  border: `1px solid ${palette.c}40`,
                  color: palette.c,
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: palette.c,
                    boxShadow: `0 0 4px ${palette.c}`,
                  }}/>
                  {palette.label}
                </div>
              );
            })() : null;
            return (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                background: m.role === "user" ? `${ACCENT}22` : "var(--surface-soft)",
                border: `1px solid ${m.role === "user" ? `${ACCENT}40` : BORDER}`,
                borderRadius: 12,
                padding: "10px 13px",
                fontSize: 13, lineHeight: 1.55,
                color: m.role === "user" ? "var(--text)" : "var(--text-body)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {m.content}
                {pill}
              </div>
            );
          })}

          {sending && (
            <div style={{
              alignSelf:"flex-start", display:"flex", gap:5, padding:"10px 13px",
              background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:12,
            }}>
              {[0,1,2].map(i => (
                <span key={i} style={{
                  width:6, height:6, borderRadius:"50%",
                  background:"var(--text-dim)",
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
            placeholder={t("chat_placeholder")}
            disabled={sending}
            style={{
              flex:1, minWidth:0,
              padding:"11px 14px",
              background:"var(--surface-soft)",
              border:`1px solid ${BORDER}`,
              borderRadius:10,
              color:"var(--text)", fontSize:13, outline:"none",
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
                : "var(--border-soft)",
              color: input.trim() && !sending ? "#fff" : "var(--text-faint)",
              fontSize:13, fontWeight:700,
              cursor: input.trim() && !sending ? "pointer" : "not-allowed",
              transition:"all 0.15s",
              opacity: ready ? 1 : 0.7,
            }}
          >
            {t("send")}
          </button>
        </div>
      </>
    );
  }
}
