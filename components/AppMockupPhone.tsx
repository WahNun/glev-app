"use client";

/**
 * AppMockupPhone — Interactive demo of the Glev mobile UI rendered
 * inside an iPhone frame. Used on the public marketing homepage so
 * visitors can try the app without logging in.
 *
 * NOT the real app. Five hand-built screens with deterministic seed
 * data, brand-correct styling, and a clickable bottom nav. The real
 * pages live under app/(protected)/* and are gated by auth.
 */

import { useState } from "react";
import GlevLogo from "@/components/GlevLogo";
import GlevLockup from "@/components/GlevLockup";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const BG      = "#09090B";
const SURFACE = "#111117";
const SURF2   = "#0F0F14";
const BORDER  = "rgba(255,255,255,0.06)";

type Tab = "dashboard" | "entries" | "engine" | "insights" | "settings";

const FRAME_W = 320;
const FRAME_H = 660;
const BEZEL   = 12;

const TAB_LABEL: Record<Tab, string> = {
  dashboard: "Dashboard",
  entries:   "Entry Log",
  engine:    "Glev Engine",
  insights:  "Insights",
  settings:  "Settings",
};

const TAB_CAPTION: Record<Tab, string> = {
  dashboard: "Glukose live, Today's Macros, Control-Score.",
  entries:   "Chronologisches Log — jede Mahlzeit ein Tap.",
  engine:    "Sprich deine Mahlzeit — Glev parst Makros per KI.",
  insights:  "Time-in-Range, 7-Tage-Trend, Mahlzeiten-Heatmap.",
  settings:  "ICR, Korrekturfaktor, Target-Range — alles in deiner Hand.",
};

export default function AppMockupPhone() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:22 }}>
      <PhoneShell>
        <ScreenInner tab={tab} onTab={setTab} />
      </PhoneShell>

      {/* Caption + tab pill row — mirrors the look of the previous
          carousel so the section composition stays familiar. */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.16em", color:ACCENT, textTransform:"uppercase" }}>
          {TAB_LABEL[tab]} · Live demo
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.55)", textAlign:"center", maxWidth:280, lineHeight:1.5, minHeight:36 }}>
          {TAB_CAPTION[tab]}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Phone frame — same proportions / bevel / island as the previous
   PhoneCarousel so the page composition remains visually identical.
   ════════════════════════════════════════════════════════════════ */
function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position:"relative", width:FRAME_W, height:FRAME_H, borderRadius:56,
      background:"linear-gradient(145deg, #1c1c22 0%, #0a0a0e 50%, #18181d 100%)",
      padding:BEZEL,
      boxShadow:"0 30px 80px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.10) inset, 0 -2px 6px rgba(255,255,255,0.04) inset, 0 60px 100px -40px rgba(79,110,247,0.25)",
    }}>
      <div aria-hidden style={{ position:"absolute", inset:1, borderRadius:55, border:"1px solid rgba(255,255,255,0.05)", pointerEvents:"none" }}/>
      {/* Side buttons */}
      <div aria-hidden style={{ position:"absolute", left:-2, top:110, width:3, height:28, background:"#0a0a0e", borderRadius:"2px 0 0 2px", boxShadow:"inset -1px 0 0 rgba(255,255,255,0.08)" }}/>
      <div aria-hidden style={{ position:"absolute", left:-2, top:158, width:3, height:48, background:"#0a0a0e", borderRadius:"2px 0 0 2px", boxShadow:"inset -1px 0 0 rgba(255,255,255,0.08)" }}/>
      <div aria-hidden style={{ position:"absolute", left:-2, top:218, width:3, height:48, background:"#0a0a0e", borderRadius:"2px 0 0 2px", boxShadow:"inset -1px 0 0 rgba(255,255,255,0.08)" }}/>
      <div aria-hidden style={{ position:"absolute", right:-2, top:180, width:3, height:70, background:"#0a0a0e", borderRadius:"0 2px 2px 0", boxShadow:"inset 1px 0 0 rgba(255,255,255,0.08)" }}/>
      {/* Screen */}
      <div style={{ position:"relative", width:"100%", height:"100%", borderRadius:44, overflow:"hidden", background:BG }}>
        {children}
        {/* Dynamic Island */}
        <div aria-hidden style={{ position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", width:108, height:28, borderRadius:999, background:"#000", boxShadow:"0 0 0 1px rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.5)", zIndex:50 }}/>
        {/* Subtle glass reflection */}
        <div aria-hidden style={{ position:"absolute", inset:0, borderRadius:44, background:"linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.04) 100%)", pointerEvents:"none", zIndex:60 }}/>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Screen inner — top header + scrollable content + bottom nav.
   ════════════════════════════════════════════════════════════════ */
function ScreenInner({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:BG, color:"#fff", fontFamily:"var(--font-inter), Inter, system-ui, sans-serif" }}>
      <TopHeader onAccount={() => onTab("settings")} />
      <div style={{ flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden", padding:"12px 14px 14px" }}>
        {tab === "dashboard" && <DashboardScreen />}
        {tab === "entries"   && <EntriesScreen />}
        {tab === "engine"    && <EngineScreen   onLogged={() => onTab("entries")} />}
        {tab === "insights"  && <InsightsScreen />}
        {tab === "settings"  && <SettingsScreen />}
      </div>
      <BottomNav tab={tab} onTab={onTab} />
    </div>
  );
}

function TopHeader({ onAccount }: { onAccount: () => void }) {
  return (
    <header style={{
      paddingTop: 46, paddingLeft: 14, paddingRight: 14, paddingBottom: 10,
      background: SURFACE, borderBottom: `1px solid ${BORDER}`,
      display:"flex", alignItems:"center", justifyContent:"space-between",
    }}>
      <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
        <GlevLockup size={20}/>
        <div style={{ fontSize:8, color:"rgba(255,255,255,0.32)", letterSpacing:"0.06em" }}>Smart insulin decisions</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <div style={{ fontSize:9, padding:"3px 9px", borderRadius:99, background:`${GREEN}1F`, color:GREEN, fontWeight:600, letterSpacing:"0.04em" }}>● Live</div>
        <button
          onClick={onAccount}
          aria-label="Open settings"
          style={{
            width:26, height:26, borderRadius:99, padding:0,
            background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
            display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </button>
      </div>
    </header>
  );
}

function BottomNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    { id:"dashboard", label:"DASHBOARD",
      icon: a => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { id:"entries",   label:"ENTRY LOG",
      icon: a => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill={a?ACCENT:"rgba(255,255,255,0.4)"}/><circle cx="4" cy="12" r="1.5" fill={a?ACCENT:"rgba(255,255,255,0.4)"}/><circle cx="4" cy="18" r="1.5" fill={a?ACCENT:"rgba(255,255,255,0.4)"}/></svg> },
    { id:"engine",    label:"GLEV",
      icon: a => <GlevLogo size={18} color={a?"#fff":ACCENT} bg="transparent"/>, },
    { id:"insights",  label:"INSIGHTS",
      icon: a => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 4 12.8V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.2A7 7 0 0 1 12 2z"/><path d="M9 21h6"/><path d="M9 18h6"/></svg> },
    { id:"settings",  label:"SETTINGS",
      icon: a => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
  ];
  return (
    <nav style={{
      background: SURFACE, borderTop:`1px solid ${BORDER}`,
      display:"flex", justifyContent:"space-around", alignItems:"stretch",
      padding:"8px 8px 12px",
    }}>
      {items.map(({ id, label, icon }) => {
        const active = tab === id;
        const isCenter = id === "engine";
        return (
          <button key={id} onClick={() => onTab(id)} style={{
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
            gap:3, padding:0, height:42, width:"20%",
            border:"none", background:"transparent", cursor:"pointer",
            color: active ? ACCENT : "rgba(255,255,255,0.3)",
            fontSize:8, fontWeight:600, letterSpacing:"0.04em",
          }}>
            {isCenter ? (
              <span style={{
                width:26, height:26, borderRadius:99,
                background: active
                  ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                  : `radial-gradient(circle at 36% 32%, #1e1e2e 0%, #141420 45%, ${BG} 100%)`,
                border: active ? "none" : `1px solid rgba(255,255,255,0.12)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                boxShadow: active ? `0 2px 10px ${ACCENT}55` : "0 2px 6px rgba(0,0,0,0.4)",
              }}>
                <GlevLogo size={15} color={active ? "#fff" : ACCENT} bg="transparent"/>
              </span>
            ) : (
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", height:20 }}>
                {icon(active)}
              </span>
            )}
            <span style={{ lineHeight:1, fontSize:7.5 }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ════════════════════════════════════════════════════════════════
   Shared mock primitives.
   ════════════════════════════════════════════════════════════════ */
function MockCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
      padding: "12px 14px", ...style,
    }}>{children}</div>
  );
}

function CardLabel({ text, color }: { text: string; color?: string }) {
  return <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", color: color ?? "rgba(255,255,255,0.4)", textTransform:"uppercase" }}>{text}</div>;
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize:8, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase",
      padding:"2px 7px", borderRadius:99,
      background:`${color}1F`, color,
    }}>{text}</span>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD — live BG card + macros + control score + recent log.
   ════════════════════════════════════════════════════════════════ */
function DashboardScreen() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Live glucose hero */}
      <MockCard style={{ background:`linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`, borderColor:`${ACCENT}30` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
          <CardLabel text="Glucose · live" color={ACCENT}/>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)" }}>1m ago</div>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
          <div style={{ fontSize:42, fontWeight:800, letterSpacing:"-0.04em", color:GREEN, fontFamily:"var(--font-mono)" }}>142</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
          <div style={{ marginLeft:"auto", fontSize:14, color:GREEN, display:"flex", alignItems:"center", gap:3 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="9 7 17 7 17 15"/></svg>
            <span style={{ fontSize:10, fontWeight:600 }}>+8 / 15m</span>
          </div>
        </div>
        {/* Inline mini sparkline */}
        <Sparkline values={[88,92,95,99,108,118,126,134,142]} color={GREEN}/>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:"rgba(255,255,255,0.3)", marginTop:4 }}>
          <span>−2 h</span><span>−1 h</span><span>now</span>
        </div>
      </MockCard>

      {/* Today's macros */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <CardLabel text="Today's macros"/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)" }}>4 meals</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
          <MacroRing label="Carbs" value={186} target={250} color={ACCENT} unit="g"/>
          <MacroRing label="Protein" value={94} target={120} color={"#A78BFA"} unit="g"/>
          <MacroRing label="Fat" value={62} target={80} color={ORANGE} unit="g"/>
        </div>
      </MockCard>

      {/* Control score */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <CardLabel text="Control score · 7d"/>
          <Pill text="Strong" color={GREEN}/>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <div style={{ fontSize:32, fontWeight:800, letterSpacing:"-0.03em", color:"#fff", fontFamily:"var(--font-mono)" }}>87</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>/ 100</div>
          <div style={{ marginLeft:"auto", fontSize:9, color:GREEN }}>+4 vs last wk</div>
        </div>
        <div style={{ height:5, marginTop:8, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden" }}>
          <div style={{ height:"100%", width:"87%", background:`linear-gradient(90deg, ${ACCENT}, ${GREEN})`, borderRadius:99 }}/>
        </div>
      </MockCard>

      {/* Recent log */}
      <MockCard style={{ padding:"10px 0 4px" }}>
        <div style={{ padding:"0 14px 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <CardLabel text="Recent"/>
          <div style={{ fontSize:9, color:ACCENT, fontWeight:600 }}>See all →</div>
        </div>
        {[
          { icon:"meal", title:"Pasta with pesto", time:"12:24", carbs:62, badge:"ON TARGET", badgeColor:GREEN },
          { icon:"bolus", title:"4.2 U bolus", time:"12:20", carbs:null, badge:"+1H 138", badgeColor:GREEN },
          { icon:"exercise", title:"Run · 32 min", time:"11:10", carbs:null, badge:"−24 mg/dL", badgeColor:ACCENT },
        ].map((r, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", borderTop:`1px solid ${BORDER}` }}>
            <EntryIcon kind={r.icon as "meal"|"bolus"|"exercise"|"basal"}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.title}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>
                {r.time}{r.carbs != null ? ` · ${r.carbs}g carbs` : ""}
              </div>
            </div>
            <Pill text={r.badge} color={r.badgeColor}/>
          </div>
        ))}
      </MockCard>
    </div>
  );
}

function MacroRing({ label, value, target, color, unit }: { label: string; value: number; target: number; color: string; unit: string }) {
  const pct = Math.min(1, value / target);
  const r = 18, c = 2 * Math.PI * r;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 24 24)"/>
        <text x="24" y="27" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700" fontFamily="var(--font-mono)">{value}</text>
      </svg>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
      <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>/ {target}{unit}</div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 268, H = 36;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop:8, display:"block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill="url(#spark-fill)" stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function EntryIcon({ kind }: { kind: "meal" | "bolus" | "exercise" | "basal" }) {
  const cfg = {
    meal:     { color:ORANGE, glyph:"M" },
    bolus:    { color:ACCENT, glyph:"B" },
    exercise: { color:GREEN,  glyph:"E" },
    basal:    { color:"#A78BFA", glyph:"L" },
  }[kind];
  return (
    <div style={{
      width:26, height:26, borderRadius:8,
      background:`${cfg.color}18`, border:`1px solid ${cfg.color}40`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:10, fontWeight:800, color:cfg.color, fontFamily:"var(--font-mono)",
    }}>{cfg.glyph}</div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ENTRIES — chronological log with mixed event types.
   ════════════════════════════════════════════════════════════════ */
function EntriesScreen() {
  const entries: Array<{
    kind: "meal" | "bolus" | "exercise" | "basal";
    title: string; time: string; sub: string; badge?: string; badgeColor?: string;
  }> = [
    { kind:"meal",     title:"Pasta with pesto",  time:"12:24", sub:"62g carbs · 4.2 U bolus", badge:"ON TARGET", badgeColor:GREEN },
    { kind:"bolus",    title:"4.2 U Novorapid",   time:"12:20", sub:"For lunch · paired meal",  badge:"PAIRED",   badgeColor:ACCENT },
    { kind:"exercise", title:"Easy run · 32 min", time:"11:10", sub:"Zone 2 · −24 mg/dL",      badge:"DONE",     badgeColor:GREEN },
    { kind:"basal",    title:"22 U Tresiba",      time:"08:45", sub:"Daily basal · long-acting", badge:"PENDING",  badgeColor:"rgba(255,255,255,0.4)" },
    { kind:"meal",     title:"Müsli with berries", time:"08:10", sub:"48g carbs · 3.0 U bolus", badge:"SPIKED",   badgeColor:ORANGE },
    { kind:"meal",     title:"Coffee, no sugar",   time:"07:30", sub:"0g carbs · no bolus",     badge:"FREE",     badgeColor:GREEN },
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ padding:"4px 2px 6px", display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"-0.02em" }}>Today, Apr 25</div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>6 events</div>
      </div>

      {/* Filter pills */}
      <div style={{ display:"flex", gap:5, paddingBottom:4 }}>
        {["All","Meals","Bolus","Basal","Exercise"].map((l, i) => (
          <div key={l} style={{
            fontSize:9, fontWeight:600, padding:"4px 9px", borderRadius:99,
            background: i === 0 ? `${ACCENT}20` : "rgba(255,255,255,0.04)",
            color: i === 0 ? ACCENT : "rgba(255,255,255,0.5)",
            border: i === 0 ? `1px solid ${ACCENT}40` : `1px solid ${BORDER}`,
          }}>{l}</div>
        ))}
      </div>

      {entries.map((e, i) => (
        <MockCard key={i} style={{ padding:"10px 12px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <EntryIcon kind={e.kind}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:6 }}>
                <div style={{ fontSize:11.5, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.title}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", fontFamily:"var(--font-mono)", flexShrink:0 }}>{e.time}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, marginTop:3 }}>
                <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.5)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.sub}</div>
                {e.badge && <Pill text={e.badge} color={e.badgeColor!}/>}
              </div>
            </div>
          </div>
        </MockCard>
      ))}

      <div style={{ textAlign:"center", fontSize:9, color:"rgba(255,255,255,0.3)", padding:"12px 0 4px" }}>
        ─ Yesterday ─
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   GLEV ENGINE — voice-first quick log with example output.
   ════════════════════════════════════════════════════════════════ */
function EngineScreen({ onLogged }: { onLogged: () => void }) {
  const [mode, setMode] = useState<"idle" | "result">("idle");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, paddingTop:6 }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
        <div style={{ fontSize:10, color:ACCENT, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" }}>Glev Engine</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", textAlign:"center", lineHeight:1.5, padding:"0 12px" }}>
          {mode === "idle"
            ? "Sprich oder tippe deine Mahlzeit — Glev parst Makros & berechnet die Bolus-Dosis."
            : "Ergebnis — überprüfe & bestätige."}
        </div>
      </div>

      {/* Big mic */}
      <div style={{ display:"flex", justifyContent:"center", padding:"6px 0" }}>
        <button
          onClick={() => setMode(m => m === "idle" ? "result" : "idle")}
          aria-label="Tap to log a meal"
          style={{
            width:108, height:108, borderRadius:99,
            background: mode === "result"
              ? `linear-gradient(135deg, ${GREEN}, #5DE6BB)`
              : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            border:"none", color:"#fff", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow: `0 0 30px ${mode === "result" ? GREEN : ACCENT}55, 0 8px 24px rgba(0,0,0,0.4)`,
            animation: "glevMicPulseDemo 2.5s ease-in-out infinite",
          }}
        >
          {mode === "result" ? (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          )}
        </button>
      </div>
      <style>{`
        @keyframes glevMicPulseDemo {
          0%,100% { transform: scale(1); box-shadow: 0 0 30px ${ACCENT}55, 0 8px 24px rgba(0,0,0,0.4); }
          50%     { transform: scale(1.04); box-shadow: 0 0 40px ${ACCENT}88, 0 8px 24px rgba(0,0,0,0.4); }
        }
      `}</style>

      {mode === "idle" ? (
        <>
          <MockCard style={{ padding:"10px 14px" }}>
            <CardLabel text="Or type" />
            <div style={{
              marginTop:8, fontSize:11, color:"rgba(255,255,255,0.4)",
              padding:"10px 12px", background:"rgba(255,255,255,0.03)",
              border:`1px solid ${BORDER}`, borderRadius:10,
            }}>
              z.B. „2 Scheiben Toast mit Marmelade…"
            </div>
          </MockCard>
          <MockCard>
            <CardLabel text="Beispiele"/>
            <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:6 }}>
              {[
                "Pasta with pesto · 250 g",
                "Chicken bowl with rice & vegetables",
                "Greek yogurt with honey & nuts",
              ].map(s => (
                <div key={s} style={{ fontSize:11, color:"rgba(255,255,255,0.55)", padding:"6px 10px", background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8 }}>
                  {s}
                </div>
              ))}
            </div>
          </MockCard>
        </>
      ) : (
        <>
          {/* Parsed meal */}
          <MockCard>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <CardLabel text="Glev parsed" color={ACCENT}/>
              <Pill text="High confidence" color={GREEN}/>
            </div>
            <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:8 }}>Pasta with pesto · 250 g</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
              {[
                { l:"Carbs",   v:"62 g", c:ACCENT },
                { l:"Protein", v:"18 g", c:"#A78BFA" },
                { l:"Fat",     v:"22 g", c:ORANGE },
              ].map(m => (
                <div key={m.l} style={{ background:`${m.c}10`, border:`1px solid ${m.c}30`, borderRadius:9, padding:"7px 8px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.l}</div>
                  <div style={{ fontSize:14, fontWeight:800, color:m.c, fontFamily:"var(--font-mono)" }}>{m.v}</div>
                </div>
              ))}
            </div>
          </MockCard>

          {/* Bolus suggestion */}
          <MockCard style={{ background:`linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`, borderColor:`${ACCENT}30` }}>
            <CardLabel text="Suggested bolus" color={ACCENT}/>
            <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:4 }}>
              <div style={{ fontSize:32, fontWeight:800, color:ACCENT, fontFamily:"var(--font-mono)", letterSpacing:"-0.03em" }}>4.2</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)" }}>units · Novorapid</div>
            </div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", marginTop:6, lineHeight:1.5 }}>
              62 g ÷ 1:15 ICR = 4.13 U · BG correction +0 (in range) → round to 4.2 U
            </div>
          </MockCard>

          <button
            onClick={onLogged}
            style={{
              padding:"12px", borderRadius:12, border:"none", cursor:"pointer",
              background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff",
              fontSize:13, fontWeight:700, boxShadow:`0 4px 18px ${ACCENT}55`,
            }}
          >
            Log meal & bolus →
          </button>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   INSIGHTS — TIR, average BG, weekly trend, meal categories.
   ════════════════════════════════════════════════════════════════ */
function InsightsScreen() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Time in Range */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <CardLabel text="Time in range · 7d"/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>70–180 mg/dL</div>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
          <div style={{ fontSize:36, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)" }}>78</div>
          <div style={{ fontSize:14, color:GREEN, fontWeight:700 }}>%</div>
          <div style={{ marginLeft:"auto", fontSize:9, color:GREEN }}>+6 vs prev wk</div>
        </div>
        {/* Stacked bar: 78 in range, 14 high, 6 low, 2 v.low */}
        <div style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}>
          <div style={{ width:"2%",  background:PINK }}/>
          <div style={{ width:"6%",  background:ORANGE }}/>
          <div style={{ width:"78%", background:GREEN }}/>
          <div style={{ width:"14%", background:"#FFD166" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"rgba(255,255,255,0.4)" }}>
          <span style={{ color:PINK }}>● V.low 2%</span>
          <span style={{ color:ORANGE }}>● Low 6%</span>
          <span style={{ color:GREEN }}>● In 78%</span>
          <span style={{ color:"#FFD166" }}>● High 14%</span>
        </div>
      </MockCard>

      {/* Two-up stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <MockCard>
          <CardLabel text="Avg BG"/>
          <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)" }}>132</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
          </div>
          <div style={{ fontSize:9, color:GREEN, marginTop:2 }}>−7 vs prev</div>
        </MockCard>
        <MockCard>
          <CardLabel text="GMI / est. A1C"/>
          <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)" }}>6.4</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>%</div>
          </div>
          <div style={{ fontSize:9, color:GREEN, marginTop:2 }}>−0.2 vs prev</div>
        </MockCard>
      </div>

      {/* Weekly trend */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <CardLabel text="7-day trend"/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>avg per day</div>
        </div>
        <Sparkline values={[148,142,138,135,140,128,132]} color={ACCENT}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"rgba(255,255,255,0.35)" }}>
          {["Sat","Sun","Mon","Tue","Wed","Thu","Fri"].map(d => <span key={d}>{d}</span>)}
        </div>
      </MockCard>

      {/* Meal performance */}
      <MockCard>
        <CardLabel text="Meal evaluation · 7d"/>
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
          {[
            { label:"On target", count:13, color:GREEN, pct:65 },
            { label:"Spiked",    count:5,  color:ORANGE, pct:25 },
            { label:"Low risk",  count:2,  color:PINK, pct:10 },
          ].map(r => (
            <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:60, fontSize:10, color:r.color }}>{r.label}</div>
              <div style={{ flex:1, height:6, background:"rgba(255,255,255,0.04)", borderRadius:99, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${r.pct}%`, background:r.color, borderRadius:99 }}/>
              </div>
              <div style={{ width:24, textAlign:"right", fontSize:10, color:"#fff", fontFamily:"var(--font-mono)", fontWeight:600 }}>{r.count}</div>
            </div>
          ))}
        </div>
      </MockCard>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS — generic email + Glev — Smart plan, mirrors real Account
   ════════════════════════════════════════════════════════════════ */
function SettingsScreen() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ padding:"4px 2px 4px" }}>
        <div style={{ fontSize:14, fontWeight:800, letterSpacing:"-0.02em" }}>Account</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>Manage your profile and Glev settings.</div>
      </div>

      {/* Sub-tabs (visual only — overview always shown) */}
      <div style={{ display:"flex", gap:3, padding:3, background:"rgba(255,255,255,0.04)", borderRadius:9, width:"fit-content" }}>
        {(["overview","settings","cgm","import"] as const).map((t, i) => (
          <div key={t} style={{
            padding:"5px 11px", borderRadius:7, fontSize:9,
            background: i === 0 ? SURFACE : "transparent",
            color: i === 0 ? "#fff" : "rgba(255,255,255,0.4)",
            fontWeight: i === 0 ? 600 : 400,
            textTransform: t === "cgm" ? "uppercase" : "capitalize",
            boxShadow: i === 0 ? "0 1px 4px rgba(0,0,0,0.4)" : "none",
          }}>{t}</div>
        ))}
      </div>

      {/* Profile card */}
      <MockCard>
        <div style={{ fontSize:10, fontWeight:700, marginBottom:10, letterSpacing:"-0.01em" }}>Profile</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{
            width:40, height:40, borderRadius:99,
            background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            border:`2px solid ${ACCENT}66`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:16, fontWeight:800, color:"#fff",
          }}>D</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ fontSize:12, fontWeight:700 }}>demo</div>
              <Pill text="Member" color={ACCENT}/>
            </div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>demo@glev.app</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
          {[
            { l:"Member since", v:"Jan 2026" },
            { l:"Meals logged", v:"47" },
            { l:"Plan",         v:"Glev — Smart", accent:true },
          ].map(s => (
            <div key={s.l} style={{
              background: s.accent ? `${GREEN}10` : "rgba(255,255,255,0.03)",
              border: s.accent ? `1px solid ${GREEN}30` : "none",
              borderRadius:8, padding:"7px 8px",
            }}>
              <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", marginBottom:2, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.l}</div>
              <div style={{ fontSize:10, fontWeight:700, color: s.accent ? GREEN : "#fff", whiteSpace:"nowrap" }}>{s.v}</div>
            </div>
          ))}
        </div>
      </MockCard>

      {/* Insulin settings */}
      <MockCard>
        <div style={{ fontSize:10, fontWeight:700, marginBottom:10, letterSpacing:"-0.01em" }}>Your insulin settings</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          {[
            { l:"Insulin-to-Carb",   v:"1:15", sub:"g per unit",     c:ACCENT },
            { l:"Correction Factor", v:"1:50", sub:"mg/dL per unit", c:"#A78BFA" },
          ].map(s => (
            <div key={s.l} style={{ background:`${s.c}10`, border:`1px solid ${s.c}30`, borderRadius:9, padding:"8px 10px" }}>
              <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)", marginBottom:2 }}>{s.l}</div>
              <div style={{ fontSize:15, fontWeight:800, color:s.c, fontFamily:"var(--font-mono)" }}>{s.v}</div>
              <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop:8, background:`${GREEN}10`, border:`1px solid ${GREEN}30`,
          borderRadius:9, padding:"8px 10px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
        }}>
          <div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)", marginBottom:2 }}>Target range</div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)" }}>safe glucose window</div>
          </div>
          <div style={{ fontSize:14, fontWeight:800, color:GREEN, letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>
            70 <span style={{ color:"rgba(255,255,255,0.3)" }}>—</span> 180
            <span style={{ fontSize:8, color:"rgba(255,255,255,0.3)", fontWeight:500, marginLeft:4 }}>mg/dL</span>
          </div>
        </div>
      </MockCard>

      {/* CGM connection */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700 }}>CGM connection</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", marginTop:2 }}>FreeStyle Libre 3 · LibreLinkUp</div>
          </div>
          <Pill text="Connected" color={GREEN}/>
        </div>
      </MockCard>

      {/* Demo notice */}
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", textAlign:"center", padding:"8px 0", lineHeight:1.6 }}>
        This is a demo. Tap the bottom nav to explore.
      </div>
    </div>
  );
}
