"use client";

/**
 * AppMockupPhone — Interactive demo of the Glev mobile UI rendered
 * inside an iPhone frame. Used on the public marketing pages so
 * visitors can try the app without logging in.
 *
 * INTENTIONALLY DARK — DO NOT THEME (Task #42). The screens inside the
 * iPhone frame must keep the product's dark cockpit appearance even
 * when the surrounding marketing page renders in Light Mode, otherwise
 * the device-frame preview would no longer represent the real app.
 * Color literals here are deliberate and must NOT be replaced with
 * `var(--bg)`/`var(--surface)`/etc.
 *
 * NOT the real app. Five hand-built screens with deterministic seed
 * data, brand-correct styling, and a clickable bottom nav. The real
 * pages live under app/(protected)/* and are gated by auth.
 *
 * Mirrors the current build of the real app (April 2026):
 *  - 4-tab bottom nav: Dashboard · Glev · Verlauf · Einstellungen
 *    (Verlauf is a single tab with an Insights/Einträge sub-toggle,
 *     matching `app/(protected)/history/page.tsx` + the mobile chip
 *     in components/Layout.tsx).
 *  - Glev tab is the center button and routes to the Engine wizard
 *    (Step 1 Essen → Step 2 Makros → Step 3 Ergebnis with pill tabs
 *    at the top, matching the real /engine page after the backlog
 *    item "Engine-Step-Indikator durch /log-Pill-Tabs ersetzen").
 *  - German-first copy throughout, lifted from the real
 *    `messages/de.json` namespaces.
 *
 * The Tab union still includes `entries` and `insights` so that
 * existing marketing call-sites that lock the phone to one of those
 * (FeatureLiveMockup via FeatureDeepDive) keep working — they just
 * render the underlying Verlauf sub-screen directly without the
 * sub-toggle chrome.
 */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import GlevLogo from "@/components/GlevLogo";
import GlevLockup from "@/components/GlevLockup";

/* ────────────────────────────────────────────────────────────────
   i18n helpers — the mockup mirrors the real Glev app so most copy
   lives in `messages/{de,en}.json` (nav / dashboard / engine /
   history / settings namespaces). For mockup-only chrome (sample
   meal names, "Live demo" caption, demo footer, etc.) we use a
   tiny inline DE/EN picker so the marketing phone reads in the
   visitor's language without polluting the production message
   bundles.
   ──────────────────────────────────────────────────────────────── */
type DeEn = { de: string; en: string };
function pickCopy(locale: string, copy: DeEn): string {
  return locale === "en" ? copy.en : copy.de;
}
/** Format a number using "," as decimal separator. Numbers/units stay
 *  locale-neutral per the task spec — only labels translate. We standardize
 *  on the German "," format to match the rest of the marketing demo and
 *  what the actual production app shows on /dashboard. */
function fmtNum(_locale: string, value: number, fractionDigits = 1): string {
  return value.toFixed(fractionDigits).replace(".", ",");
}
/** Locale-neutral insulin unit shown in the mockup. The real app's
 *  `engine.units_short` flips IE↔u between locales, but for this static
 *  marketing mockup the task requires the unit to stay neutral. */
const UNITS_SHORT = "IE";
/** Locale-neutral carb gram label. */
const CARBS_SHORT = "g KH";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const PURPLE  = "#A78BFA";
const BG      = "#09090B";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";

export type Tab =
  | "dashboard"
  | "entries"
  | "engine"
  | "insights"
  | "settings";

const FRAME_W = 320;
const FRAME_H = 660;
const BEZEL   = 12;

function tabLabel(tab: Tab, locale: string): string {
  switch (tab) {
    case "dashboard": return pickCopy(locale, { de: "Dashboard",                en: "Dashboard"             });
    case "entries":   return pickCopy(locale, { de: "Verlauf · Einträge",       en: "History · Entries"     });
    case "engine":    return pickCopy(locale, { de: "Glev",                     en: "Glev"                  });
    case "insights":  return pickCopy(locale, { de: "Verlauf · Insights",       en: "History · Insights"    });
    case "settings":  return pickCopy(locale, { de: "Einstellungen",            en: "Settings"              });
  }
}

function tabCaption(tab: Tab, locale: string): string {
  switch (tab) {
    case "dashboard": return pickCopy(locale, {
      de: "Glukose live, heutige Makros, Control Score.",
      en: "Live glucose, today's macros, Control Score.",
    });
    case "entries":   return pickCopy(locale, {
      de: "Chronologisches Log — jede Mahlzeit ein Tap.",
      en: "Chronological log — every meal one tap away.",
    });
    case "engine":    return pickCopy(locale, {
      de: "Sprich deine Mahlzeit — Glev parst Makros per KI.",
      en: "Speak your meal — Glev parses macros with AI.",
    });
    case "insights":  return pickCopy(locale, {
      de: "Time-in-Range, Trend, Mahlzeiten-Bewertung.",
      en: "Time-in-range, trend, meal scoring.",
    });
    case "settings":  return pickCopy(locale, {
      de: "ICR, Korrekturfaktor, CGM, Sprache — alles in deiner Hand.",
      en: "ICR, correction factor, CGM, language — all in your hands.",
    });
  }
}

/** Bottom-nav buttons rendered to the visitor (4 buttons, like the
 *  real mobile Layout.tsx). "verlauf" is a virtual button that maps
 *  to either the insights or entries Tab depending on the in-screen
 *  Verlauf sub-toggle. */
type NavId = "dashboard" | "glev" | "verlauf" | "settings";

type AppMockupPhoneProps = {
  /** Lock the phone to a single tab. Hides the bottom nav and the
   *  caption row. Within-tab interactions (card flips, sub-toggles,
   *  expand/collapse, voice mock, macro recompute) keep working —
   *  visitors just can't switch tabs. Used by feature cards on the
   *  marketing landing page so each card focuses on one screen. */
  lockTab?: Tab;
  /** Tabs to exclude from the bottom nav. Mapped to NavIds:
   *  - "engine"   hides the Glev center button
   *  - "entries"  AND "insights" together hide the Verlauf button
   *  - "dashboard"/"settings" hide their own buttons.
   *  Ignored when `lockTab` is set. */
  excludeTabs?: Tab[];
  /** Hide the top-right cog button. The hero uses this if a tap on
   *  the header banner shouldn't deep-link visitors into settings. */
  hideTopCog?: boolean;
};

export default function AppMockupPhone({
  lockTab,
  excludeTabs = [],
  hideTopCog = false,
}: AppMockupPhoneProps = {}) {
  const [tab, setTab] = useState<Tab>(lockTab ?? "dashboard");
  const locale = useLocale();

  // When locked we ignore tab changes — within-tab interactions still
  // mutate their own state inside DashboardScreen / EngineScreen / etc.
  const onTab = lockTab ? () => {} : setTab;

  const liveDemoSuffix = pickCopy(locale, { de: "Live demo", en: "Live demo" });

  return (
    <div data-testid="app-mockup-phone" style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:22 }}>
      <PhoneShell>
        <ScreenInner
          tab={tab}
          onTab={onTab}
          showBottomNav={!lockTab}
          excludeTabs={excludeTabs}
          hideTopCog={hideTopCog}
        />
      </PhoneShell>

      {/* Caption + label row — only when nav is interactive. Locked
          phones rely on the surrounding feature card's own copy. */}
      {!lockTab && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.16em", color:ACCENT, textTransform:"uppercase" }}>
            {tabLabel(tab, locale)} · {liveDemoSuffix}
          </div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.55)", textAlign:"center", maxWidth:280, lineHeight:1.5, minHeight:36 }}>
            {tabCaption(tab, locale)}
          </div>
        </div>
      )}
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
function ScreenInner({ tab, onTab, showBottomNav, excludeTabs, hideTopCog }: {
  tab: Tab;
  onTab: (t: Tab) => void;
  showBottomNav: boolean;
  excludeTabs: Tab[];
  hideTopCog: boolean;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:BG, color:"#fff", fontFamily:"var(--font-inter), Inter, system-ui, sans-serif" }}>
      <TopHeader onAccount={hideTopCog ? undefined : () => onTab("settings")} />
      <div style={{ flex:1, minHeight:0, overflowY:"auto", overflowX:"hidden", padding:"12px 14px 14px" }}>
        {tab === "dashboard" && <DashboardScreen onLogMeal={() => onTab("engine")}/>}
        {(tab === "entries" || tab === "insights") && (
          <VerlaufScreen
            tab={tab}
            onSubTab={onTab}
            // Hide the Insights/Einträge sub-toggle when locked — locked
            // feature cards focus on one specific screen, so the toggle
            // would be a no-op confusion.
            showSubToggle={showBottomNav}
          />
        )}
        {tab === "engine"    && <EngineScreen onLogged={() => onTab("entries")} />}
        {tab === "settings"  && <SettingsScreen />}
      </div>
      {showBottomNav && (
        <BottomNav
          tab={tab}
          onTab={onTab}
          excludeTabs={excludeTabs}
        />
      )}
    </div>
  );
}

function TopHeader({ onAccount }: { onAccount?: () => void }) {
  const locale = useLocale();
  const ariaSettings = pickCopy(locale, { de: "Einstellungen öffnen", en: "Open settings" });
  return (
    <header style={{
      paddingTop: 46, paddingLeft: 14, paddingRight: 14, paddingBottom: 10,
      background: SURFACE, borderBottom: `1px solid ${BORDER}`,
      display:"flex", alignItems:"center", justifyContent:"space-between",
    }}>
      <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
        {/* Explicit white color: this header is intentionally dark and
            must not theme-shift with the surrounding marketing page. */}
        <GlevLockup size={20} color="#fff"/>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <div style={{ fontSize:9, padding:"3px 9px", borderRadius:99, background:`${GREEN}1F`, color:GREEN, fontWeight:600, letterSpacing:"0.04em" }}>● Live</div>
        {onAccount && (
          <button
            onClick={onAccount}
            aria-label={ariaSettings}
            style={{
              width:26, height:26, borderRadius:99, padding:0,
              background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
              display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </button>
        )}
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────
   Bottom nav — 4 buttons matching the real mobile Layout.tsx:
   Dashboard · Glev (center, button-style) · Verlauf · Einstellungen.
   The Glev button is bigger and uses the GlevLogo, like the real app.
   ──────────────────────────────────────────────────────────────── */
function BottomNav({ tab, onTab, excludeTabs }: {
  tab: Tab;
  onTab: (t: Tab) => void;
  excludeTabs: Tab[];
}) {
  const tNav = useTranslations("nav");
  // Map a NavId to which Tab it activates and whether it should
  // be highlighted given the currently-active Tab. Verlauf wraps
  // both `entries` and `insights` so the button is highlighted
  // for both sub-views; clicking it always lands on insights first
  // (the real app's default for /history).
  const items: { id: NavId; label: string; activeTab: Tab; isActive: boolean; hidden: boolean; render: (active: boolean) => React.ReactNode }[] = [
    {
      id: "dashboard",
      label: tNav("dashboard").toUpperCase(),
      activeTab: "dashboard",
      isActive: tab === "dashboard",
      hidden: excludeTabs.includes("dashboard"),
      render: a => <NavIconBox><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></NavIconBox>,
    },
    {
      id: "glev",
      label: tNav("glev").toUpperCase(),
      activeTab: "engine",
      isActive: tab === "engine",
      hidden: excludeTabs.includes("engine"),
      // Match the real Layout.tsx after the Glev-tab redesign — no
      // gradient pill, no center-button highlight. The Glev nav item
      // renders just the hexagon brand-mark inside a standard
      // NavIconBox so it's visually consistent with Dashboard /
      // Verlauf / Einstellungen. ACCENT when active, dimmed otherwise.
      render: a => (
        <NavIconBox>
          <GlevLogo size={16} color={a ? ACCENT : "rgba(255,255,255,0.4)"} bg="transparent"/>
        </NavIconBox>
      ),
    },
    {
      id: "verlauf",
      label: tNav("history").toUpperCase(),
      activeTab: "insights",
      isActive: tab === "insights" || tab === "entries",
      hidden: excludeTabs.includes("insights") && excludeTabs.includes("entries"),
      render: a => <NavIconBox><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/><line x1="12" y1="7" x2="12" y2="12"/><line x1="12" y1="12" x2="15" y2="14"/></svg></NavIconBox>,
    },
    {
      id: "settings",
      label: tNav("settings").toUpperCase(),
      activeTab: "settings",
      isActive: tab === "settings",
      hidden: excludeTabs.includes("settings"),
      render: a => <NavIconBox><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={a?ACCENT:"rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></NavIconBox>,
    },
  ];

  const visible = items.filter(it => !it.hidden);
  const itemWidth = `${100 / Math.max(visible.length, 1)}%`;

  return (
    <nav style={{
      background: SURFACE, borderTop:`1px solid ${BORDER}`,
      display:"flex", justifyContent:"space-around", alignItems:"stretch",
      padding:"8px 8px 12px",
    }}>
      {visible.map(it => (
        <button
          key={it.id}
          onClick={() => onTab(it.activeTab)}
          style={{
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
            gap:3, padding:0, height:42, width:itemWidth,
            border:"none", background:"transparent", cursor:"pointer",
            color: it.isActive ? ACCENT : "rgba(255,255,255,0.3)",
            fontSize:8, fontWeight:600, letterSpacing:"0.04em",
          }}
        >
          {it.render(it.isActive)}
          <span style={{ lineHeight:1, fontSize:7.5 }}>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function NavIconBox({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display:"flex", alignItems:"center", justifyContent:"center", height:20 }}>
      {children}
    </span>
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
   DASHBOARD — Glukose live, Heutige Makros, Control Score · 7T
   (with Treffer-/Spike-/Hypo-Quote tiles), Aktuell.
   ════════════════════════════════════════════════════════════════ */
function DashboardScreen({ onLogMeal }: { onLogMeal: () => void }) {
  const locale = useLocale();
  const tDash = useTranslations("dashboard");

  const carbsShort = CARBS_SHORT;
  const unitsShort = UNITS_SHORT;

  const ago1m       = pickCopy(locale, { de: "vor 1m",          en: "1m ago" });
  const liveLabel   = pickCopy(locale, { de: "Glukose · live",  en: "Glucose · live" });
  const ago2h       = pickCopy(locale, { de: "−2 h",            en: "−2 h" });
  const ago1h       = pickCopy(locale, { de: "−1 h",            en: "−1 h" });
  const nowLabel    = pickCopy(locale, { de: "jetzt",           en: "now" });
  const fourMeals   = pickCopy(locale, { de: "4 Mahlzeiten",    en: "4 meals" });
  // Macro labels mirror the i18n keys used in the real DailyMacrosCard
  // (`dashboard.macro_carbs` / `_protein` / `_fat` / `_fiber`) so the
  // mockup labels stay in lock-step with the production dashboard.
  const carbsLabel  = tDash("macro_carbs");
  const proteinLab  = tDash("macro_protein");
  const fatLabel    = tDash("macro_fat");
  const fiberLabel  = tDash("macro_fiber");
  const deltaWk     = tDash("delta_vs_last_week");

  const recent: Array<{
    icon: "meal" | "bolus" | "exercise";
    title: string;
    time: string;
    carbs: number | null;
    badge: string;
    badgeColor: string;
  }> = [
    {
      icon: "meal",
      title: pickCopy(locale, { de: "Pasta mit Pesto", en: "Pasta with pesto" }),
      time: "12:24", carbs: 62,
      badge: tDash("outcome_good").toUpperCase(),
      badgeColor: GREEN,
    },
    {
      icon: "bolus",
      title: `${fmtNum(locale, 4.2)} ${unitsShort} ${pickCopy(locale, { de: "Bolus", en: "bolus" })}`,
      time: "12:20", carbs: null, badge: "+1H 138", badgeColor: GREEN,
    },
    {
      icon: "exercise",
      title: pickCopy(locale, { de: "Lauf · 32 min", en: "Run · 32 min" }),
      time: "11:10", carbs: null, badge: "−24 mg/dL", badgeColor: ACCENT,
    },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Live glucose hero */}
      <MockCard style={{ background:`linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`, borderColor:`${ACCENT}30` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
          <CardLabel text={liveLabel} color={ACCENT}/>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)" }}>{ago1m}</div>
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
          <span>{ago2h}</span><span>{ago1h}</span><span>{nowLabel}</span>
        </div>
      </MockCard>

      {/* Log-Mahlzeit CTA — matches the real /dashboard CTA styling */}
      <button
        onClick={onLogMeal}
        style={{
          width:"100%", padding:"10px 12px", borderRadius:12,
          border:`1px dashed ${ACCENT}55`, background:`${ACCENT}10`,
          color:ACCENT, fontSize:11, fontWeight:700, letterSpacing:"-0.01em",
          display:"flex", alignItems:"center", justifyContent:"center", gap:6,
          cursor:"pointer",
        }}
      >
        {tDash("log_meal_cta")}
      </button>

      {/* Heutige Makros */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <CardLabel text={tDash("daily_macros")}/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)" }}>{fourMeals}</div>
        </div>
        {/* 4 rings in a single row, matching the real DailyMacrosCard
            after the fiber addition. Colors mirror the production
            TYPE_COLORS palette: orange (fast carbs), blue (high
            protein), purple (high fat), green/Balanced-Token (fiber).
            `minmax(0, 1fr)` collapses the min-content floor so the
            longer "BALLASTSTOFFE" label can't push its column wider
            than the other three. */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
          <MacroRing label={carbsLabel} value={186} target={250} color={ORANGE}    unit="g"/>
          <MacroRing label={proteinLab} value={94}  target={120} color={"#3B82F6"} unit="g"/>
          <MacroRing label={fatLabel}   value={62}  target={80}  color={PURPLE}    unit="g"/>
          <MacroRing label={fiberLabel} value={18}  target={30}  color={GREEN}     unit="g"/>
        </div>
      </MockCard>

      {/* Control Score · 7T — hero card with STARK badge */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <CardLabel text={tDash("control_score_label")}/>
          <Pill text={tDash("badge_strong")} color={GREEN}/>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <div style={{ fontSize:32, fontWeight:800, letterSpacing:"-0.03em", color:"#fff", fontFamily:"var(--font-mono)" }}>87</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>/ 100</div>
          <div style={{ marginLeft:"auto", fontSize:9, color:GREEN }}>+4 {deltaWk}</div>
        </div>
        <div style={{ height:5, marginTop:8, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden" }}>
          <div style={{ height:"100%", width:"87%", background:`linear-gradient(90deg, ${ACCENT}, ${GREEN})`, borderRadius:99 }}/>
        </div>
      </MockCard>

      {/* Treffer / Spike / Hypo tiles — matches buildCards() in
          app/(protected)/dashboard/page.tsx */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
        <RateTile label={tDash("good_label")}  value={78} sub={tDash("good_sub", { n: 14 })}  color={GREEN}/>
        <RateTile label={tDash("spike_label")} value={12} sub={tDash("spike_sub")} color={ORANGE}/>
        <RateTile label={tDash("hypo_label")}  value={6}  sub={tDash("hypo_sub")}  color={PINK}/>
      </div>

      {/* Aktuell — recent log */}
      <MockCard style={{ padding:"10px 0 4px" }}>
        <div style={{ padding:"0 14px 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <CardLabel text={tDash("recent_label")}/>
          <div style={{ fontSize:9, color:ACCENT, fontWeight:600 }}>{tDash("see_all")}</div>
        </div>
        {recent.map((r, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 14px", borderTop:`1px solid ${BORDER}` }}>
            <EntryIcon kind={r.icon}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{r.title}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>
                {r.time}{r.carbs != null ? ` · ${r.carbs}${carbsShort}` : ""}
              </div>
            </div>
            <Pill text={r.badge} color={r.badgeColor}/>
          </div>
        ))}
      </MockCard>
    </div>
  );
}

function RateTile({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div style={{
      background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12,
      padding:"10px 10px", display:"flex", flexDirection:"column", gap:4,
    }}>
      <div style={{ fontSize:8, fontWeight:700, letterSpacing:"0.08em", color:"rgba(255,255,255,0.45)", textTransform:"uppercase" }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
        <span style={{ fontSize:20, fontWeight:800, color, fontFamily:"var(--font-mono)", letterSpacing:"-0.03em" }}>{value}</span>
        <span style={{ fontSize:10, color, fontWeight:700 }}>%</span>
      </div>
      <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)" }}>{sub}</div>
    </div>
  );
}

function MacroRing({ label, value, target, color, unit }: { label: string; value: number; target: number; color: string; unit: string }) {
  const pct = Math.min(1, value / target);
  const r = 18, c = 2 * Math.PI * r;
  // minWidth:0 lets long labels (e.g. "BALLASTSTOFFE") wrap or
  // truncate inside the parent grid cell instead of pushing the
  // column wider than its 4-up share.
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4, minWidth:0, width:"100%" }}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 24 24)"/>
        <text x="24" y="27" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700" fontFamily="var(--font-mono)">{value}</text>
      </svg>
      <div style={{
        fontSize:7.5, color:"rgba(255,255,255,0.5)", textTransform:"uppercase", letterSpacing:"0.04em",
        textAlign:"center", lineHeight:1.15, maxWidth:"100%",
        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
      }}>{label}</div>
      <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.3)" }}>/ {target}{unit}</div>
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
    basal:    { color:PURPLE, glyph:"L" },
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
   VERLAUF — wraps Insights + Einträge with a sub-toggle chip,
   matching app/(protected)/history + the HistoryHeaderChip in
   components/Layout.tsx.
   ════════════════════════════════════════════════════════════════ */
function VerlaufScreen({ tab, onSubTab, showSubToggle }: { tab: "insights" | "entries"; onSubTab: (t: Tab) => void; showSubToggle: boolean }) {
  const tHist = useTranslations("history");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {showSubToggle && (
        <div style={{
          alignSelf:"flex-start",
          display:"inline-flex", gap:3, padding:3,
          background:"#0D0D12", border:`1px solid ${BORDER}`,
          borderRadius:9,
        }}>
          {([
            { id:"insights" as const, label: tHist("insights") },
            { id:"entries"  as const, label: tHist("entries") },
          ]).map(s => {
            const active = tab === s.id;
            return (
              <button key={s.id} onClick={() => onSubTab(s.id)} style={{
                padding:"4px 12px", borderRadius:6,
                background: active ? `${ACCENT}22` : "transparent",
                color:    active ? ACCENT : "rgba(255,255,255,0.55)",
                fontSize:10, fontWeight:700, letterSpacing:"-0.01em",
                border:"none", cursor:"pointer",
              }}>{s.label}</button>
            );
          })}
        </div>
      )}

      {tab === "insights" ? <InsightsScreen/> : <EntriesScreen/>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   EINTRÄGE — chronological log with mixed event types.
   ──────────────────────────────────────────────────────────────── */
function EntriesScreen() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const locale = useLocale();
  const tHist = useTranslations("history");
  const tDash = useTranslations("dashboard");
  const tIns  = useTranslations("engineLog");

  type EvalKind = "GUT" | "SPIKE" | "HYPO";
  const evalColor: Record<EvalKind, string> = { GUT: GREEN, SPIKE: ORANGE, HYPO: PINK };
  // Always-uppercase outcome glyph — language-agnostic at marketing
  // surface like the real Pill component, but still flips DE→EN.
  const evalLabel: Record<EvalKind, string> = {
    GUT:   tDash("outcome_good").toUpperCase(),
    SPIKE: tDash("outcome_spike").toUpperCase(),
    HYPO:  pickCopy(locale, { de: "HYPO", en: "HYPO" }),
  };

  const meals: Array<{
    meal: string; time: string;
    carbs: number; protein: number; fat: number; fiber: number; calories: number;
    glucose: number; insulin: number;
    evaluation: EvalKind;
  }> = [
    {
      meal: pickCopy(locale, { de: "Haferflocken, Blaubeeren, Mandelmilch", en: "Oatmeal, blueberries, almond milk" }),
      time:"08:14", carbs:52, protein:12, fat:8,  fiber:6, calories:328, glucose:108, insulin:3.5, evaluation:"GUT",
    },
    {
      meal: pickCopy(locale, { de: "Chicken Bowl mit Reis und Avocado", en: "Chicken bowl with rice and avocado" }),
      time:"12:41", carbs:68, protein:38, fat:18, fiber:5, calories:590, glucose:124, insulin:4.8, evaluation:"SPIKE",
    },
    {
      meal: pickCopy(locale, { de: "Linsencurry mit Naan", en: "Lentil curry with naan" }),
      time:"19:22", carbs:74, protein:22, fat:12, fiber:9, calories:490, glucose:115, insulin:5.2, evaluation:"GUT",
    },
  ];

  const carbsShort = CARBS_SHORT;
  const unitsShort = UNITS_SHORT;
  const bolusLabel = tIns("type_bolus");         // "Bolus"
  const bgBefore   = tDash("bg_before");
  const carbsLab   = tDash("carbs");
  const proteinLab = tDash("protein");
  const fatLab     = tDash("fat");
  const fiberLab   = pickCopy(locale, { de: "Ballaststoffe", en: "Fiber" });
  const caloriesLb = tDash("calories");
  const insulinLab = tDash("insulin");

  const headerCount = pickCopy(locale, { de: `3 von 47`, en: `3 of 47` });
  const expandHint  = pickCopy(locale, {
    de: "Klicke eine Zeile zum Aufklappen.",
    en: "Click a row to expand.",
  });
  const addMealCta  = pickCopy(locale, { de: "+ Mahlzeit", en: "+ Meal" });
  const filtersChip = pickCopy(locale, { de: "Filters · 2", en: "Filters · 2" });
  const searchPh    = pickCopy(locale, { de: "Suchen…", en: "Search…" });
  const yesterdayHr = pickCopy(locale, { de: "─ Gestern ─", en: "─ Yesterday ─" });

  const MealStat = ({ l, v, c }: { l: string; v: string; c?: string }) => (
    <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"6px 8px" }}>
      <div style={{ fontSize:8, color:"rgba(255,255,255,0.4)", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:2 }}>{l}</div>
      <div style={{ fontSize:11, fontWeight:700, color:c || "rgba(255,255,255,0.85)" }}>{v}</div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ padding:"4px 2px 2px", display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"-0.02em" }}>{tHist("entries")}</div>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>{headerCount}</div>
      </div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", padding:"0 2px 4px" }}>
        {expandHint}
      </div>

      {/* + Mahlzeit dashed CTA */}
      <button style={{
        width:"100%", padding:"9px", borderRadius:10,
        border:`1px dashed ${ACCENT}55`, background:`${ACCENT}10`,
        color:ACCENT, fontSize:10, fontWeight:700,
        cursor:"pointer", letterSpacing:"-0.01em",
      }}>
        {addMealCta}
      </button>

      {/* Filters + search row */}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <div style={{
          display:"inline-flex", alignItems:"center", gap:5,
          padding:"5px 10px", borderRadius:99,
          background:"rgba(255,255,255,0.04)", border:`1px solid ${BORDER}`,
          color:"rgba(255,255,255,0.55)", fontSize:9, fontWeight:600,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          {filtersChip}
        </div>
        <div style={{
          flex:1, display:"flex", alignItems:"center", gap:5,
          padding:"5px 10px", borderRadius:99,
          background:"rgba(255,255,255,0.03)", border:`1px solid ${BORDER}`,
          color:"rgba(255,255,255,0.4)", fontSize:9,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          {searchPh}
        </div>
      </div>

      {meals.map((m, i) => {
        const isOpen = expandedIndex === i;
        const evColor = evalColor[m.evaluation];
        return (
          <MockCard key={i} style={{ padding:"10px 12px", overflow:"hidden" }}>
            <div
              onClick={() => setExpandedIndex(isOpen ? null : i)}
              style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
            >
              <EntryIcon kind="meal"/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:6 }}>
                  <div style={{ fontSize:11.5, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{m.meal}</div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", fontFamily:"var(--font-mono)", flexShrink:0 }}>{m.time}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, marginTop:3 }}>
                  <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.5)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{m.carbs}{carbsShort} · {fmtNum(locale, m.insulin)} {unitsShort} {bolusLabel}</div>
                  <Pill text={evalLabel[m.evaluation]} color={evColor}/>
                </div>
              </div>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition:"transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>

            <div style={{ maxHeight: isOpen ? 220 : 0, overflow:"hidden", transition:"max-height 0.25s ease" }}>
              <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid rgba(255,255,255,0.06)`, display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  <MealStat l={carbsLab}   v={`${m.carbs}g`}        c={ORANGE}/>
                  <MealStat l={proteinLab} v={`${m.protein}g`}      c={PURPLE}/>
                  <MealStat l={fatLab}     v={`${m.fat}g`}          c={ACCENT}/>
                  <MealStat l={fiberLab}   v={`${m.fiber}g`}/>
                  <MealStat l={caloriesLb} v={`${m.calories} kcal`} c={GREEN}/>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, fontSize:10, color:"rgba(255,255,255,0.55)", padding:"4px 2px" }}>
                  <span>{bgBefore}: <strong style={{ color:"#fff", fontWeight:700 }}>{m.glucose}</strong> mg/dL</span>
                  <span>{insulinLab}: <strong style={{ color:"#fff", fontWeight:700 }}>{fmtNum(locale, m.insulin)}</strong> {unitsShort}</span>
                </div>
              </div>
            </div>
          </MockCard>
        );
      })}

      <div style={{ textAlign:"center", fontSize:9, color:"rgba(255,255,255,0.3)", padding:"12px 0 4px" }}>
        {yesterdayHr}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   GLEV ENGINE — 3-step wizard with pill tabs at the top
   (Essen → Makros → Ergebnis). Mirrors the real /engine page after
   the "Engine-Step-Indikator durch /log-Pill-Tabs ersetzen" change.
   ════════════════════════════════════════════════════════════════ */
type EngineStep = 1 | 2 | 3;

function EngineScreen({ onLogged }: { onLogged: () => void }) {
  const [step, setStep] = useState<EngineStep>(1);
  const [micState, setMicState] = useState<"idle" | "listening" | "parsing">("idle");
  const [confirmed, setConfirmed] = useState(false);
  const locale = useLocale();
  const tEng = useTranslations("engine");

  // Pre-filled deterministic seed data so step 2 + step 3 render full
  // content without the visitor having to actually speak / type.
  const meal = {
    desc:    pickCopy(locale, { de: "Pasta mit Pesto, 250g", en: "Pasta with pesto, 250g" }),
    glucose: 115,
    carbs:   62,
    protein: 18,
    fat:     22,
    fiber:   4,
  };

  const subtitleEng = pickCopy(locale, {
    de: "Sprich deine Mahlzeit — Glev parst Makros und schlägt eine Insulin-Dosis vor.",
    en: "Speak your meal — Glev parses macros and suggests an insulin dose.",
  });

  function tapMic() {
    if (micState !== "idle") return;
    setMicState("listening");
    setTimeout(() => {
      setMicState("parsing");
      setTimeout(() => {
        setMicState("idle");
        setStep(2);
      }, 1100);
    }, 1500);
  }

  function handleConfirm() {
    setConfirmed(true);
    setTimeout(() => onLogged(), 700);
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Header — GlevLogo + title */}
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
          <GlevLogo size={18}/>
          <h1 style={{ fontSize:14, fontWeight:800, letterSpacing:"-0.03em", margin:0 }}>{tEng("title")}</h1>
        </div>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:9.5, margin:0, lineHeight:1.4 }}>
          {subtitleEng}
        </p>
      </div>

      {/* Pill tabs — Essen · Makros · Ergebnis (matches the real /log
          pill-tab pattern after the redesign) */}
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:4,
        background:"#0D0D12", border:`1px solid ${BORDER}`,
        borderRadius:10, padding:4,
      }}>
        {([
          { id:1 as EngineStep, label:`1 · ${tEng("step_label_food")}` },
          { id:2 as EngineStep, label:`2 · ${tEng("step_label_macros")}` },
          { id:3 as EngineStep, label:`3 · ${tEng("step_label_result")}` },
        ]).map(s => {
          const active = step === s.id;
          const reachable = s.id <= step;
          return (
            <button
              key={s.id}
              onClick={() => reachable && setStep(s.id)}
              disabled={!reachable}
              style={{
                padding:"6px 8px", borderRadius:7,
                background: active ? `${ACCENT}22` : "transparent",
                color:    active ? ACCENT : reachable ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.25)",
                fontSize:9.5, fontWeight:700, letterSpacing:"-0.01em",
                border:"none", cursor: reachable ? "pointer" : "default",
                textAlign:"center",
              }}
            >{s.label}</button>
          );
        })}
      </div>

      {step === 1 && <EngineStepFood meal={meal} micState={micState} onMic={tapMic}/>}
      {step === 2 && <EngineStepMacros meal={meal} onBack={() => setStep(1)} onContinue={() => setStep(3)}/>}
      {step === 3 && <EngineStepResult meal={meal} confirmed={confirmed} onBack={() => setStep(2)} onConfirm={handleConfirm}/>}
    </div>
  );
}

function EngineStepFood({ meal, micState, onMic }: {
  meal: { desc: string; glucose: number };
  micState: "idle" | "listening" | "parsing";
  onMic: () => void;
}) {
  const tEng     = useTranslations("engine");
  const tLog     = useTranslations("log");
  const recording = micState === "listening";
  const parsing   = micState === "parsing";
  // Speak-pill label flips with the active mic state, mirroring the
  // real /engine page's voice button.
  const speakLabel = recording
    ? tEng("voice_btn_stop")
    : parsing
    ? tEng("voice_btn_processing")
    : tEng("voice_btn_speak");
  // Status precedence in the chat-panel header: parsing > ready
  // (mockup never simulates a chat round-trip, so no THINKING state).
  const statusLabel = parsing ? tLog("chat_status_parsing") : tLog("chat_status_ready");
  const statusColor = parsing ? ORANGE : GREEN;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Aktueller Glukosewert chip — unchanged */}
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"8px 12px", borderRadius:99,
        background:`${ACCENT}10`, border:`1px solid ${ACCENT}30`,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:99, background:GREEN, boxShadow:`0 0 6px ${GREEN}` }}/>
          <span style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.65)", letterSpacing:"0.06em", textTransform:"uppercase" }}>
            {tEng("current_glucose")}
          </span>
        </div>
        <div style={{ fontSize:13, fontWeight:800, color:GREEN, fontFamily:"var(--font-mono)" }}>
          {meal.glucose} <span style={{ fontSize:8, color:"rgba(255,255,255,0.4)", fontWeight:500 }}>mg/dL</span>
        </div>
      </div>

      {/* Sprechen-Pill — mirrors app/(protected)/engine/page.tsx
          ~Z.1484-1520. Wide pill, GlevLogo (ACCENT) on the left,
          "Sprechen" / "Speak" label on the right. ACCENT halo pulse
          while "recording" (mockup-only fake state). */}
      <style>{`
        @keyframes mockEngRecHalo {
          0%,100% { box-shadow: 0 0 0 1px ${ACCENT}66, 0 0 12px ${ACCENT}55, 0 0 26px ${ACCENT}22; }
          50%     { box-shadow: 0 0 0 1px ${ACCENT}cc, 0 0 22px ${ACCENT}aa, 0 0 42px ${ACCENT}44; }
        }
      `}</style>
      <button
        type="button"
        onClick={onMic}
        disabled={parsing}
        aria-label={recording ? tEng("voice_aria_stop") : tEng("voice_aria_start")}
        style={{
          display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
          width:"100%", height:44, borderRadius:24,
          background: recording ? `${ACCENT}1f` : SURFACE,
          border: `1px solid ${recording ? ACCENT : `${ACCENT}55`}`,
          color:"#fff", fontSize:12, fontWeight:700, letterSpacing:"-0.01em",
          cursor: parsing ? "default" : "pointer",
          animation: recording ? "mockEngRecHalo 1.4s ease-in-out infinite" : undefined,
          boxShadow: recording ? undefined : `0 0 0 1px ${ACCENT}22`,
          opacity: parsing ? 0.55 : 1,
          transition:"background 0.2s, border-color 0.2s, opacity 0.2s",
        }}
      >
        <span aria-hidden style={{
          display:"inline-flex",
          filter: `drop-shadow(0 0 ${recording ? 6 : 3}px ${ACCENT}${recording ? "cc" : "55"})`,
          transition:"filter 0.25s",
        }}>
          <GlevLogo size={16} color={ACCENT} bg="transparent"/>
        </span>
        {speakLabel}
      </button>

      {/* AI Food Parser chat panel — purely visual mock of the real
          EngineChatPanel. Header = "AI FOOD PARSER" + "GPT-Begründung"
          + status pill. Body = the same intro copy ("Sobald du eine
          Mahlzeit loggst…" / "Once you log a meal…"). Footer = the
          real placeholder + a disabled Send button. No round-trip,
          no API. */}
      <div style={{
        background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14,
        display:"flex", flexDirection:"column", overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, padding:"10px 12px", borderBottom:`1px solid ${BORDER}`,
        }}>
          <div style={{
            display:"flex", alignItems:"baseline", flexWrap:"wrap",
            columnGap:6, rowGap:2, minWidth:0, flex:1,
          }}>
            <span style={{
              fontSize:9, fontWeight:700, letterSpacing:"0.08em",
              color:"rgba(255,255,255,0.5)", whiteSpace:"nowrap",
            }}>
              {tLog("ai_food_parser_caps")}
            </span>
            <span style={{
              fontSize:8.5, fontWeight:600, color:ACCENT, letterSpacing:"0.04em",
              whiteSpace:"nowrap",
            }}>
              {tLog("gpt_reasoning_title")}
            </span>
          </div>
          <div style={{
            display:"inline-flex", alignItems:"center", gap:5,
            padding:"3px 8px", borderRadius:99,
            background:`${statusColor}18`, border:`1px solid ${statusColor}40`,
            fontSize:8.5, fontWeight:700, letterSpacing:"0.06em",
            color:statusColor, flexShrink:0,
          }}>
            <span style={{
              width:5, height:5, borderRadius:"50%",
              background:statusColor, boxShadow:`0 0 5px ${statusColor}`,
            }}/>
            {statusLabel}
          </div>
        </div>

        {/* Body — intro copy */}
        <div style={{
          padding:"18px 16px",
          fontSize:9.5, lineHeight:1.55, color:"rgba(255,255,255,0.55)",
          textAlign:"center", minHeight:84,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          {tLog("chat_intro")}
        </div>

        {/* Footer — disabled input + send */}
        <div style={{
          display:"flex", alignItems:"center", gap:6,
          padding:"8px 10px", borderTop:`1px solid ${BORDER}`,
        }}>
          <input
            readOnly
            placeholder={tLog("chat_placeholder")}
            style={{
              flex:1, minWidth:0,
              padding:"8px 10px",
              background:"#0D0D12",
              border:`1px solid ${BORDER}`,
              borderRadius:8,
              color:"rgba(255,255,255,0.5)", fontSize:10, outline:"none",
            }}
          />
          <button
            type="button"
            disabled
            aria-disabled
            style={{
              padding:"8px 12px",
              borderRadius:8, border:"none",
              background:"rgba(255,255,255,0.06)",
              color:"rgba(255,255,255,0.3)",
              fontSize:10, fontWeight:700,
              cursor:"not-allowed",
            }}
          >
            {tLog("send")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EngineStepMacros({ meal, onBack, onContinue }: {
  meal: { desc: string; carbs: number; protein: number; fat: number; fiber: number; glucose: number };
  onBack: () => void;
  onContinue: () => void;
}) {
  const locale = useLocale();
  const tEng = useTranslations("engine");
  const stepTitle = pickCopy(locale, { de: "Makros prüfen", en: "Check macros" });
  const stepHint  = pickCopy(locale, {
    de: "Glev hat die Werte aus deiner Mahlzeit geschätzt. Du kannst alles überschreiben.",
    en: "Glev estimated the values from your meal. You can override anything.",
  });
  const sourceChip   = pickCopy(locale, { de: "Quelle · Datenbank ✓", en: "Source · Database ✓" });
  const sourceCredit = pickCopy(locale, { de: "Open Food Facts + USDA", en: "Open Food Facts + USDA" });
  const mealLabel = pickCopy(locale, { de: "Mahlzeit", en: "Meal" });
  const classifyLabel = pickCopy(locale, { de: "Klassifizierung", en: "Classification" });
  const balanced  = pickCopy(locale, { de: "Ausgewogen", en: "Balanced" });

  const inp: React.CSSProperties = {
    background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:8,
    padding:"7px 10px", color:"#fff", fontSize:11, outline:"none", width:"100%",
    boxSizing:"border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em",
    textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:4,
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ padding:"2px 2px" }}>
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:"-0.02em", color:"#fff", marginBottom:2 }}>{stepTitle}</div>
        <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.5)", lineHeight:1.4 }}>
          {stepHint}
        </div>
      </div>

      {/* Quelle chip */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"7px 11px", borderRadius:99,
        background:`${GREEN}10`, border:`1px solid ${GREEN}30`,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:5, height:5, borderRadius:99, background:GREEN, boxShadow:`0 0 5px ${GREEN}` }}/>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.6)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:700 }}>
            {sourceChip}
          </span>
        </div>
        <span style={{ fontSize:8, color:"rgba(255,255,255,0.35)" }}>{sourceCredit}</span>
      </div>

      <div style={{
        background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14,
        padding:"12px", display:"flex", flexDirection:"column", gap:9,
      }}>
        <div>
          <label style={labelStyle}>{mealLabel}</label>
          <input style={inp} value={meal.desc} readOnly/>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, rowGap:9 }}>
          <div>
            <label style={labelStyle}>{tEng("carbs_label")}</label>
            <input style={inp} value={meal.carbs} readOnly/>
          </div>
          <div>
            <label style={labelStyle}>
              {tEng("fiber_label")} <span style={{ textTransform:"none", color:"rgba(255,255,255,0.3)", fontSize:8, fontWeight:500 }}>{tEng("optional_short")}</span>
            </label>
            <input style={inp} value={meal.fiber} readOnly/>
          </div>
          <div>
            <label style={labelStyle}>{tEng("protein_label")}</label>
            <input style={inp} value={meal.protein} readOnly/>
          </div>
          <div>
            <label style={labelStyle}>{tEng("fat_label")}</label>
            <input style={inp} value={meal.fat} readOnly/>
          </div>
        </div>

        <div>
          <label style={labelStyle}>{classifyLabel}</label>
          <div style={{
            ...inp, display:"flex", alignItems:"center", gap:7,
            color:"#fff", fontWeight:600,
          }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:ACCENT, boxShadow:`0 0 5px ${ACCENT}`, flexShrink:0 }}/>
            {balanced}
          </div>
        </div>
      </div>

      <div style={{ display:"flex", gap:6 }}>
        <button onClick={onBack} style={{
          flex:"0 0 auto", padding:"10px 14px", borderRadius:10, border:`1px solid ${BORDER}`,
          background:"transparent", color:"rgba(255,255,255,0.7)", fontSize:11, fontWeight:600,
          cursor:"pointer",
        }}>{tEng("btn_back")}</button>
        <button onClick={onContinue} style={{
          flex:1, padding:"10px", borderRadius:10, border:"none",
          background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer",
          boxShadow:`0 4px 18px ${ACCENT}40`,
        }}>
          {tEng("btn_calculate_bolus")}
        </button>
      </div>
    </div>
  );
}

function EngineStepResult({ meal, confirmed, onBack, onConfirm }: {
  meal: { carbs: number; glucose: number };
  confirmed: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const locale = useLocale();
  const tEng = useTranslations("engine");

  const stepTitle = pickCopy(locale, { de: "Deine Einschätzung", en: "Your recommendation" });
  const stepHint  = pickCopy(locale, {
    de: "Empfehlung basierend auf historischen Mahlzeiten + ICR-Formel.",
    en: "Recommendation based on historical meals + ICR formula.",
  });
  const glucoseBefore = pickCopy(locale, { de: "Glukose vorher", en: "Glucose before" });
  const inRange      = pickCopy(locale, { de: "im Zielbereich", en: "in range" });
  const carbsLabel   = pickCopy(locale, { de: "Carbs", en: "Carbs" });
  const moderate     = pickCopy(locale, { de: "moderat", en: "moderate" });
  const confidenceHigh = pickCopy(locale, { de: "HOCH", en: "HIGH" });
  const reasonLabel  = pickCopy(locale, { de: "Begründung", en: "Reasoning" });
  const reasonBody   = pickCopy(locale, {
    de: `Basierend auf 4 ähnlichen früheren Mahlzeiten mit GUTEM Ergebnis (±12 ${CARBS_SHORT}, ±35 mg/dL). Historischer Durchschnitt: ${fmtNum(locale, 4.2)} ${UNITS_SHORT}.`,
    en: `Based on 4 similar past meals with GOOD outcome (±12 ${CARBS_SHORT}, ±35 mg/dL). Historical average: ${fmtNum(locale, 4.2)} ${UNITS_SHORT}.`,
  });
  const cellCarb     = pickCopy(locale, { de: "Carb", en: "Carb" });
  const cellCorr     = pickCopy(locale, { de: "Korrektur", en: "Correction" });
  const cellTotal    = pickCopy(locale, { de: "Gesamt", en: "Total" });
  const recommended  = pickCopy(locale, { de: "empfohlen", en: "recommended" });
  const unitsShort   = UNITS_SHORT;
  const dose         = fmtNum(locale, 4.2);
  const carbDose     = fmtNum(locale, 4.1);
  const corrDose     = fmtNum(locale, 0.1);
  const disclaimerBody = pickCopy(locale, {
    de: "Glev Engine ist nur eine Entscheidungshilfe. Bitte konsultiere immer deinen Diabetologen.",
    en: "Glev Engine provides decision support only. Always consult your diabetologist.",
  });
  const savedLabel = pickCopy(locale, {
    de: "✓ Gespeichert — öffne Einträge…",
    en: "✓ Saved — opening entries…",
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ padding:"2px 2px" }}>
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:"-0.02em", color:"#fff", marginBottom:2 }}>{stepTitle}</div>
        <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.5)", lineHeight:1.4 }}>
          {stepHint}
        </div>
      </div>

      {/* Input summary — Glukose + Carbs */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12, padding:"10px 12px" }}>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:3 }}>{glucoseBefore}</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
            <span style={{ fontSize:18, fontWeight:800, color:"#60A5FA", letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>{meal.glucose}</span>
            <span style={{ fontSize:8, color:"rgba(255,255,255,0.35)" }}>mg/dL</span>
          </div>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{inRange}</div>
        </div>
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12, padding:"10px 12px" }}>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:3 }}>{carbsLabel}</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
            <span style={{ fontSize:18, fontWeight:800, color:ORANGE, letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>{meal.carbs}</span>
            <span style={{ fontSize:8, color:"rgba(255,255,255,0.35)" }}>g</span>
          </div>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{moderate}</div>
        </div>
      </div>

      {/* Hero result block — Empfohlene Dosis */}
      <div style={{ background:SURFACE, border:`1px solid ${GREEN}30`, borderRadius:14, padding:"14px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
          <div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:4 }}>{tEng("recommended_dose_label")}</div>
            <div style={{ fontSize:36, fontWeight:900, letterSpacing:"-0.04em", lineHeight:1, color:"#fff", fontFamily:"var(--font-mono)" }}>
              {dose}<span style={{ fontSize:11, fontWeight:400, color:"rgba(255,255,255,0.4)", marginLeft:4, fontFamily:"var(--font-inter), Inter, system-ui, sans-serif" }}>{unitsShort}</span>
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", marginBottom:3 }}>{tEng("confidence")}</div>
            <span style={{ padding:"4px 10px", borderRadius:99, fontSize:9, fontWeight:700, background:`${GREEN}18`, color:GREEN, border:`1px solid ${GREEN}40` }}>{confidenceHigh}</span>
            <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)", marginTop:3 }}>{tEng("source_historical")}</div>
          </div>
        </div>
        <div style={{ marginTop:10, padding:"8px 10px", background:"rgba(0,0,0,0.3)", borderRadius:8 }}>
          <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.3)", marginBottom:2, letterSpacing:"0.05em", textTransform:"uppercase" }}>{reasonLabel}</div>
          <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.65)", lineHeight:1.45 }}>
            {reasonBody}
          </div>
        </div>
        <div style={{ marginTop:8, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
          {[
            { label:cellCarb,  val:`${carbDose} ${unitsShort}`,  sub:`${meal.carbs}g ÷ 15`,    c:ORANGE },
            { label:cellCorr,  val:`+${corrDose} ${unitsShort}`, sub:`(${meal.glucose}−110)/50`, c:ACCENT },
            { label:cellTotal, val:`${dose} ${unitsShort}`,      sub:recommended,              c:GREEN  },
          ].map(d => (
            <div key={d.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:7, padding:"6px 4px", textAlign:"center" }}>
              <div style={{ fontSize:7.5, color:"rgba(255,255,255,0.3)", marginBottom:2 }}>{d.label}</div>
              <div style={{ fontSize:13, fontWeight:800, color:d.c, fontFamily:"var(--font-mono)" }}>{d.val}</div>
              <div style={{ fontSize:7, color:"rgba(255,255,255,0.2)", marginTop:1 }}>{d.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{
        fontSize:8.5, color:"rgba(255,255,255,0.4)", lineHeight:1.45,
        padding:"7px 10px", borderRadius:8, background:"rgba(255,255,255,0.02)",
        border:`1px solid ${BORDER}`,
      }}>
        <strong style={{ color:"rgba(255,255,255,0.65)" }}>{tEng("disclaimer_label")}</strong>{" "}
        {disclaimerBody}
      </div>

      <div style={{ display:"flex", gap:6 }}>
        <button onClick={onBack} disabled={confirmed} style={{
          flex:"0 0 auto", padding:"10px 14px", borderRadius:10, border:`1px solid ${BORDER}`,
          background:"transparent", color:"rgba(255,255,255,0.7)", fontSize:11, fontWeight:600,
          cursor: confirmed ? "default" : "pointer", opacity: confirmed ? 0.4 : 1,
        }}>{tEng("btn_adjust_again")}</button>
        <button
          onClick={onConfirm}
          disabled={confirmed}
          style={{
            flex:1, padding:"10px", borderRadius:10, border:"none",
            background: confirmed
              ? `${GREEN}30`
              : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            color:"#fff", fontSize:11, fontWeight:700,
            cursor: confirmed ? "default" : "pointer",
            boxShadow: confirmed ? "none" : `0 4px 18px ${ACCENT}40`,
          }}
        >
          {confirmed ? savedLabel : tEng("btn_confirm_save")}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   INSIGHTS — Time in Range, GMI/A1c, 7-Tage-Trend, Mahlzeiten-Bewertung.
   ════════════════════════════════════════════════════════════════ */
function InsightsScreen() {
  const locale = useLocale();
  const tDash = useTranslations("dashboard");
  const deltaWk = tDash("delta_vs_last_week");
  const tirLabel = pickCopy(locale, { de: "Time in Range · 7T", en: "Time in Range · 7d" });
  const veryLow  = pickCopy(locale, { de: "Sehr tief", en: "Very low" });
  const low      = pickCopy(locale, { de: "Tief",      en: "Low" });
  const inTarget = pickCopy(locale, { de: "Im Ziel",   en: "In range" });
  const high     = pickCopy(locale, { de: "Hoch",      en: "High" });
  const avgGluc  = pickCopy(locale, { de: "Ø Glukose", en: "Avg. glucose" });
  const gmiLabel = pickCopy(locale, { de: "GMI · gesch. A1c", en: "GMI · est. A1c" });
  const trend7   = pickCopy(locale, { de: "7-Tage-Trend", en: "7-day trend" });
  const perDay   = pickCopy(locale, { de: "Ø pro Tag", en: "Avg. / day" });
  const mealRate = pickCopy(locale, { de: "Mahlzeiten-Bewertung · 7T", en: "Meal rating · 7d" });
  const spike    = pickCopy(locale, { de: "Spike",       en: "Spike" });
  const hypoRisk = pickCopy(locale, { de: "Hypo-Risiko", en: "Hypo risk" });
  // Visual minus sign (U+2212) to match the original styling.
  const minus0p2 = `−${fmtNum(locale, 0.2)}`;

  // Weekday short labels (Sat..Fri) — order is fixed in the demo data.
  const wkSat = tDash("weekday_short_sat");
  const wkSun = tDash("weekday_short_sun");
  const wkMon = tDash("weekday_short_mon");
  const wkTue = tDash("weekday_short_tue");
  const wkWed = tDash("weekday_short_wed");
  const wkThu = tDash("weekday_short_thu");
  const wkFri = tDash("weekday_short_fri");

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Time in Range */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <CardLabel text={tirLabel}/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>70–180 mg/dL</div>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:10 }}>
          <div style={{ fontSize:36, fontWeight:800, color:GREEN, letterSpacing:"-0.04em", fontFamily:"var(--font-mono)" }}>78</div>
          <div style={{ fontSize:14, color:GREEN, fontWeight:700 }}>%</div>
          <div style={{ marginLeft:"auto", fontSize:9, color:GREEN }}>+6 {deltaWk}</div>
        </div>
        {/* Stacked bar: 78 in range, 14 high, 6 low, 2 v.low */}
        <div style={{ display:"flex", height:12, borderRadius:99, overflow:"hidden", background:"rgba(255,255,255,0.04)" }}>
          <div style={{ width:"2%",  background:PINK }}/>
          <div style={{ width:"6%",  background:ORANGE }}/>
          <div style={{ width:"78%", background:GREEN }}/>
          <div style={{ width:"14%", background:"#FFD166" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:8, color:"rgba(255,255,255,0.4)" }}>
          <span style={{ color:PINK }}>● {veryLow} 2%</span>
          <span style={{ color:ORANGE }}>● {low} 6%</span>
          <span style={{ color:GREEN }}>● {inTarget} 78%</span>
          <span style={{ color:"#FFD166" }}>● {high} 14%</span>
        </div>
      </MockCard>

      {/* Two-up stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <MockCard>
          <CardLabel text={avgGluc}/>
          <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)" }}>132</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>mg/dL</div>
          </div>
          <div style={{ fontSize:9, color:GREEN, marginTop:2 }}>−7 {deltaWk}</div>
        </MockCard>
        <MockCard>
          <CardLabel text={gmiLabel}/>
          <div style={{ display:"flex", alignItems:"baseline", gap:4, marginTop:4 }}>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"var(--font-mono)" }}>{fmtNum(locale, 6.4)}</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>%</div>
          </div>
          <div style={{ fontSize:9, color:GREEN, marginTop:2 }}>{minus0p2} {deltaWk}</div>
        </MockCard>
      </div>

      {/* 7-Tage-Trend */}
      <MockCard>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <CardLabel text={trend7}/>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)" }}>{perDay}</div>
        </div>
        <Sparkline values={[148,142,138,135,140,128,132]} color={ACCENT}/>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:8, color:"rgba(255,255,255,0.35)" }}>
          {[wkSat, wkSun, wkMon, wkTue, wkWed, wkThu, wkFri].map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}
        </div>
      </MockCard>

      {/* Mahlzeiten-Bewertung */}
      <MockCard>
        <CardLabel text={mealRate}/>
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
          {[
            { label: inTarget, count:13, color:GREEN,  pct:65 },
            { label: spike,    count:5,  color:ORANGE, pct:25 },
            { label: hypoRisk, count:2,  color:PINK,   pct:10 },
          ].map(r => (
            <div key={r.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:72, fontSize:10, color:r.color }}>{r.label}</div>
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
   EINSTELLUNGEN — bottom-sheet style row list, mirroring the real
   Settings page (Sprache, CGM Verbindung, Konto, Erscheinungsbild,
   Benachrichtigungen, Insulin, Makro-Ziele).
   ════════════════════════════════════════════════════════════════ */
function SettingsScreen() {
  const locale = useLocale();
  const tSet  = useTranslations("settings");
  type Row = { label: string; sub: string; rightLabel?: string; rightColor?: string; iconColor: string; icon: React.ReactNode };

  const editLabel = pickCopy(locale, { de: "Bearbeiten", en: "Edit" });

  const rows: Row[] = [
    {
      label: pickCopy(locale, { de: "Sprache", en: "Language" }),
      sub:   pickCopy(locale, { de: "Deutsch · DE", en: "English · EN" }),
      rightLabel: pickCopy(locale, { de: "DE", en: "EN" }),
      rightColor: ACCENT, iconColor: ACCENT,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "CGM Verbindung", en: "CGM Connection" }),
      sub:   "FreeStyle Libre 3 · LibreLinkUp",
      rightLabel: pickCopy(locale, { de: "● Verbunden", en: "● Connected" }),
      rightColor: GREEN, iconColor: GREEN,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "Insulin", en: "Insulin" }),
      sub:   pickCopy(locale, { de: "ICR 1:15 · Korrektur 1:50", en: "ICR 1:15 · Correction 1:50" }),
      rightLabel: editLabel, rightColor: "rgba(255,255,255,0.5)",
      iconColor: PURPLE,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "Makro-Ziele", en: "Macro Targets" }),
      sub:   pickCopy(locale, { de: "Carbs 250g · Protein 120g · Fett 80g", en: "Carbs 250g · Protein 120g · Fat 80g" }),
      rightLabel: editLabel, rightColor: "rgba(255,255,255,0.5)",
      iconColor: ORANGE,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "Benachrichtigungen", en: "Notifications" }),
      sub:   pickCopy(locale, { de: "Aktiv · Ruhig 22–07", en: "Active · Quiet 22–07" }),
      rightLabel: pickCopy(locale, { de: "An", en: "On" }),
      rightColor: GREEN, iconColor: PINK,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "Erscheinungsbild", en: "Appearance" }),
      sub:   pickCopy(locale, { de: "Dunkel", en: "Dark" }),
      rightLabel: pickCopy(locale, { de: "Dark", en: "Dark" }),
      rightColor: "rgba(255,255,255,0.5)", iconColor: "#60A5FA",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
    },
    {
      label: pickCopy(locale, { de: "Konto", en: "Account" }),
      sub:   pickCopy(locale, { de: "demo@glev.app · seit Jan 2026", en: "demo@glev.app · since Jan 2026" }),
      rightLabel: "Pro", rightColor: GREEN,
      iconColor: "#fff",
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ padding:"4px 2px 4px" }}>
        <div style={{ fontSize:14, fontWeight:800, letterSpacing:"-0.02em" }}>{tSet("title")}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>
          {pickCopy(locale, {
            de: "Profil, CGM und alle Therapie-Werte.",
            en: "Profile, CGM and all therapy settings.",
          })}
        </div>
      </div>

      <div style={{
        background:SURFACE, border:`1px solid ${BORDER}`,
        borderRadius:12, overflow:"hidden",
      }}>
        {rows.map((row, i) => (
          <button
            key={row.label}
            style={{
              width:"100%", padding:"12px 12px", border:"none",
              background:"transparent", cursor:"pointer", textAlign:"left",
              borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
              display:"flex", alignItems:"center", gap:10,
            }}
          >
            <span style={{
              width:28, height:28, borderRadius:8,
              background:`${row.iconColor}15`, border:`1px solid ${row.iconColor}30`,
              color:row.iconColor,
              display:"flex", alignItems:"center", justifyContent:"center",
              flexShrink:0,
            }}>{row.icon}</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:11.5, fontWeight:700, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row.label}</span>
              <span style={{ display:"block", fontSize:9.5, color:"rgba(255,255,255,0.45)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{row.sub}</span>
            </span>
            {row.rightLabel && (
              <span style={{ fontSize:9, fontWeight:700, color:row.rightColor, letterSpacing:"-0.005em", flexShrink:0 }}>{row.rightLabel}</span>
            )}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        ))}
      </div>

      <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", textAlign:"center", padding:"8px 0", lineHeight:1.6 }}>
        {pickCopy(locale, {
          de: "Demo · auf der echten App auch Sprache wechseln, CGM neu verbinden u. v. m.",
          en: "Demo · in the real app you can also change language, reconnect CGM, and more.",
        })}
      </div>
    </div>
  );
}
