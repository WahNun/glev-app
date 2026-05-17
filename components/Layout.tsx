"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { signOut } from "@/lib/auth";
import GlevLockup from "@/components/GlevLockup";
import GlevLogo from "@/components/GlevLogo";
import AboutGlevModal from "@/components/AboutGlevModal";
import AccountSheet from "@/components/AccountSheet";
import QuickAddMenu from "@/components/QuickAddMenu";
import { EngineHeaderProvider, useEngineHeader } from "@/lib/engineHeaderContext";
import {
  ScopeHeaderProvider, useScopeHeader,
  computeScopeWindow, type ScopeMode,
} from "@/lib/scopeHeaderContext";
import { startOfDay, startOfDaysAgo, startOfToday, userTimezone } from "@/lib/utils/datetime";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border-soft)";
const BG      = "var(--bg)";

// Mobile nav uses slightly different surfaces than the rest of the app:
// the spec asks for #111117 with a 0.08-alpha top border (vs the global
// 0.06 BORDER), and inactive tabs use a brighter 0.4-alpha white than
// the desktop sidebar's 0.45 so the 4-tab bar reads cleanly on phones.
const NAV_SURFACE  = "var(--surface)";
const NAV_BORDER   = "var(--border)";
const NAV_INACTIVE = "var(--text-dim)";

// Desktop sidebar items. 5 entries: Dashboard / Einträge / Glev /
// Insights / Settings. The mobile bottom nav mirrors this exact set in
// the same order so muscle memory between desktop & mobile lines up.
// Glev keeps slot 3 (centre) — flanked by Einträge on the left and
// Insights on the right — matching how the user described the desired
// layout when restoring the two surfaces from the merged /history
// wrapper. The "log" tab is intentionally still dropped; logging flows
// live in the header "+" QuickAddMenu.
type NavKey = "dashboard" | "entries" | "glev" | "insights" | "settings";
type NavItem = { key: NavKey; path: string; icon: (a: boolean) => React.ReactNode };
const NAV: NavItem[] = [
  { key: "dashboard", path: "/dashboard", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  )},
  // Einträge — flat list of all logged meals + glucose + exercise + …
  // entries. Lives between Dashboard and Glev on the user's request
  // so the "what happened" surface sits adjacent to the at-a-glance
  // dashboard.
  { key: "entries", path: "/entries", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
  )},
  // Glev brand mark in the nav rail. Recoloured monochrome (grey when
  // inactive, ACCENT when active) so its visual weight sits on the same
  // tier as the other line-icon tabs — the multi-node logo no longer
  // dominates the row. Active state additionally gets an ACCENT drop-
  // shadow halo so the selection pops without resorting to a different
  // shape from the rest.
  { key: "glev", path: "/engine", icon: (a) => (
    <span style={{ display: "inline-flex", filter: a ? `drop-shadow(0 0 6px ${ACCENT}99)` : undefined, transition: "filter 0.2s" }}>
      <GlevLogo size={18} color={a ? ACCENT : "var(--text-dim)"} bg="transparent"/>
    </span>
  )},
  // Insights — aggregate analytics (TIR, GMI, patterns). Sits between
  // Glev and Settings: the deeper-analysis surface anchored on the
  // right side, with the new global scope chip (Day/Week/Month/Year)
  // appearing in the mobile header while this tab is active.
  { key: "insights", path: "/insights", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.5.5 3 1.5 4 .76.76 1.23 1.52 1.41 2.5"/></svg>
  )},
  { key: "settings", path: "/settings", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  )},
];

/**
 * Public wrapper. Composes both page-header providers so the mobile
 * global header (rendered inside LayoutInner) and each page (rendered
 * as `children`) share state for their respective header controls.
 *   - EngineHeaderProvider → engine tabs chip
 *   - ScopeHeaderProvider  → Day/Week/Month/Year scope chip on /insights
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <EngineHeaderProvider>
      <ScopeHeaderProvider>
        <LayoutInner>{children}</LayoutInner>
      </ScopeHeaderProvider>
    </EngineHeaderProvider>
  );
}

function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const tNav = useTranslations("nav");
  const [aboutOpen, setAboutOpen] = useState(false);
  // AccountSheet — opened by tapping the avatar/profile chip in the
  // mobile header. Replaces the previous behaviour of routing straight
  // to /settings, since "Konto" (profile/stats/upgrade/sign-out) and
  // "Einstellungen" (preferences) are now visually + conceptually
  // separated per the iOS-style settings refactor.
  const [accountOpen, setAccountOpen] = useState(false);
  // Mobile bottom-nav: tapping the Glev slot now goes STRAIGHT to the
  // engine voice screen (the meal log flow) instead of popping a
  // pick-your-flow action sheet. The two secondary flows (Glukose
  // messen / Aktivität loggen) live in the header "+" dropdown
  // (QuickAddMenu) so the bottom-nav tap stays a single decisive
  // gesture. The old `glevSheetOpen` state + bottom action sheet
  // were removed in this same change.
  const engineHdr = useEngineHeader();
  const scopeHdr  = useScopeHeader();

  useEffect(() => {
    fetch("/api/debug/state").then(r => r.json()).then(d => console.log("[DEBUG:STATE]", d)).catch(() => {});
  }, []);

  // Auto-clear the engine-header marker whenever we navigate away from
  // /engine. The engine page itself sets visible=true on mount but
  // route changes that unmount the page won't always reset it on time
  // (race with Next's RSC streaming), so reset defensively here too.
  useEffect(() => {
    if (!pathname.startsWith("/engine")) {
      engineHdr.setVisible(false);
      engineHdr.setTabsExpanded(false);
    }
  }, [pathname, engineHdr]);

  // Same defensive reset for the scope-header chip — when the user
  // leaves /insights, the Day/Week/Month/Year chip must disappear
  // from the global header even if the page's own unmount handler
  // hasn't fired yet.
  useEffect(() => {
    if (!pathname.startsWith("/insights")) {
      scopeHdr.setVisible(false);
    }
  }, [pathname, scopeHdr]);

  // Horizontal swipe-to-switch-tabs disabled (user request 2026-05-17).
  // The Dashboard and Insights screens now own horizontal swipe themselves
  // (cluster pager / insight pager), so a page-level swipe handler would
  // either fight those gestures or accidentally navigate away from the
  // current screen. Bottom-nav taps remain the single way to switch tabs.

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG }}>
      <style>{`
        .glev-sidebar     { display: flex; }
        .glev-mobile-nav  { display: none !important; }
        .glev-mobile-fab  { display: none !important; }
        .glev-mobile-head { display: none !important; }
        @media (max-width: 768px) {
          .glev-sidebar     { display: none !important; }
          .glev-mobile-nav  { display: flex !important; }
          .glev-mobile-fab  { display: flex !important; }
          .glev-mobile-head { display: flex !important; }
          .glev-main        { padding: calc(env(safe-area-inset-top) + 76px) 16px calc(env(safe-area-inset-bottom) + 110px) !important; }
          .glev-entry-row   { grid-template-columns: 1fr auto auto !important; gap: 10px !important; padding: 14px 16px !important; }
          .glev-entry-hide-mobile { display: none !important; }
          .glev-entry-bolus { display: flex !important; }
        }
        .glev-entry-bolus { display: none; }
        .nav-btn { transition: background 0.15s, color 0.15s; }
        .nav-btn:hover { background: rgba(79,110,247,0.08) !important; }
        @keyframes glevMicPulse {
          0%,100% { box-shadow: 0 0 20px ${ACCENT}55; }
          50%     { box-shadow: 0 0 32px ${ACCENT}88, 0 0 60px ${ACCENT}33; }
        }
      `}</style>

      {/* MOBILE HEADER — solid surface bg always; logo opens About modal, account icon opens Settings */}
      <header className="glev-mobile-head" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 99,
        // iOS notch / Dynamic Island: push content below the status bar by
        // honouring safe-area-inset-top, with a sensible fallback for
        // browsers that don't expose it (e.g. desktop dev tools).
        padding: "calc(env(safe-area-inset-top) + 10px) max(18px, env(safe-area-inset-right)) 12px max(18px, env(safe-area-inset-left))",
        background: SURFACE,
        borderBottom: `1px solid ${BORDER}`,
        alignItems: "center", justifyContent: "space-between",
      }}>
        <div
          onClick={() => setAboutOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAboutOpen(true); } }}
          role="button"
          tabIndex={0}
          aria-label="Open about Glev"
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, minWidth: 0 }}
        >
          {/* Symbol-BG bewusst hart auf Brand-Dunkel gepinnt (matcht das
              iOS-Favicon). Wordmark folgt dem Theme via var(--text), aber
              das Logo-Quadrat soll in Light Mode NICHT mit-aufhellen,
              sonst löst es sich vom Header optisch auf. */}
          <GlevLockup size={26} color="var(--text)" symbolBg="#0F0F14" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Engine-Pille im Header wurde entfernt (User-Wunsch
              2026-05-04): "ich will nurnoch das plus symbol nutzen
              im header allerdings müssen dort alle tabs die aktuell
              in der pill erreichbar sind auch gelistet werden". Alle
              Engine-Tabs (Engine, Insulin, Exercise, Glucose, Cycle,
              Symptoms) sind jetzt einzig über das QuickAddMenu ("+")
              erreichbar. EngineHeaderProvider bleibt im Provider-Tree
              damit die engine page weiter setVisible/setActiveLabel
              aufrufen darf — ohne UI-Konsequenz, aber konfliktfrei. */}
          {/* History-page sub-tab dropdown. Only rendered while the
              user is on /history; the page registers itself via
              HistoryHeaderProvider on mount. Replaces the old in-body
              "Insights / Einträge" pill so /history opens straight to
              the cards without a row of vertical chrome at the top. */}
          {scopeHdr.visible && (
            <ScopeHeaderChip
              mode={scopeHdr.mode}
              anchor={scopeHdr.anchor}
              setMode={scopeHdr.setMode}
              setAnchor={scopeHdr.setAnchor}
            />
          )}
          <div style={{ fontSize: 13, padding: "5px 12px", borderRadius: 99, background: `${GREEN}18`, color: GREEN, fontWeight: 600 }}>Live</div>
          {/* QuickAddMenu — the three primary logging shortcuts
              (Mahlzeit / Glukose / Aktivität) live here in the header
              as a small dropdown behind a 32×32 "+" button. This is
              the only home for the Glukose + Aktivität flows on
              mobile now that the bottom-nav Glev tap routes straight
              to /engine (which defaults to the engine sub-tab on
              Step 1 voice input); Mahlzeit is intentionally
              duplicated here so the header "+" stays self-sufficient. */}
          <QuickAddMenu />
          <button
            onClick={() => setAccountOpen(true)}
            aria-label="Open account"
            style={{
              width: 32, height: 32, borderRadius: 99, padding: 0,
              background: accountOpen ? `${ACCENT}25` : "var(--surface-soft)",
              border: `1px solid ${accountOpen ? ACCENT : "var(--border-strong)"}`,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accountOpen ? ACCENT : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </button>
        </div>
      </header>

      <AboutGlevModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />

      <aside className="glev-sidebar" style={{
        width: 224, flexShrink: 0, background: SURFACE,
        borderRight: `1px solid ${BORDER}`, flexDirection: "column",
        padding: "20px 12px", position: "sticky", top: 0, height: "100vh",
        overflowY: "auto",
      }}>
        <div
          onClick={() => setAboutOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAboutOpen(true); } }}
          role="button"
          tabIndex={0}
          aria-label="Open about Glev"
          className="nav-btn"
          style={{
            display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
            padding: "8px 10px", marginBottom: 24, marginTop: -4,
            borderRadius: 10, cursor: "pointer",
          }}
        >
          {/* Same logic as the mobile header — keep the icon square dark
              in both themes so it always reads as the Glev "favicon". */}
          <GlevLockup size={28} color="var(--text)" symbolBg="#0F0F14" />
        </div>

        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ key, path, icon }) => {
            // /engine has its own internal tabs that we deep-link to
            // via ?tab= — those navigations don't change pathname so
            // the active highlight stays correct without extra logic.
            const active = pathname.startsWith(path);
            return (
              <button key={path} className="nav-btn" onClick={() => router.push(path)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                borderRadius: 10, border: "none", cursor: "pointer",
                background: active ? `${ACCENT}18` : "transparent",
                color: active ? ACCENT : "var(--text-dim)",
                fontSize: 14, fontWeight: active ? 600 : 400,
                textAlign: "left", width: "100%",
              }}>
                {icon(active)}
                {tNav(key)}
              </button>
            );
          })}
        </nav>

        <button onClick={handleSignOut} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
          borderRadius: 10, border: "none", cursor: "pointer", background: "transparent",
          color: "var(--text-ghost)", fontSize: 13, textAlign: "left", width: "100%",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </aside>

      <main className="glev-main" style={{ flex: 1, padding: "28px 32px", maxWidth: "100%", overflowX: "hidden", zoom: 1.12 }}>
        {children}
      </main>

      {/* MOBILE BOTTOM NAV — 5 tabs (Dashboard, Einträge, Glev,
          Insights, Settings) restored after the brief 4-tab phase that
          merged Insights+Einträge under /history. The user explicitly
          asked for both surfaces back in the bottom nav with Einträge
          left of Glev and Insights right of Glev so muscle memory
          aligns with the rendered icon order. All five tabs share the
          same MobileTab visuals — no FAB, no elevated centre. Glev's
          brand mark sits in slot 3 (centre) and tapping it routes
          straight to /engine (Step 1 voice input). The three logging
          shortcuts live in the header "+" QuickAddMenu, so each
          bottom-nav tap stays a single decisive gesture. */}
      <nav className="glev-mobile-nav" style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: NAV_SURFACE, borderTop: `1px solid ${NAV_BORDER}`,
        padding: "6px 4px env(safe-area-inset-bottom, 0px)", zIndex: 100,
      }}>
        <MobileTab
          label={tNav("dashboard")}
          active={pathname.startsWith("/dashboard")}
          onClick={() => router.push("/dashboard")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
            </svg>
          )}
        />
        <MobileTab
          label={tNav("entries")}
          active={pathname.startsWith("/entries")}
          onClick={() => router.push("/entries")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          )}
        />
        <MobileTab
          label={tNav("glev")}
          active={pathname.startsWith("/engine")}
          onClick={() => router.push("/engine")}
          icon={(a) => (
            <GlevLogo size={22} color={a ? ACCENT : NAV_INACTIVE} bg="transparent"/>
          )}
        />
        <MobileTab
          label={tNav("insights")}
          active={pathname.startsWith("/insights")}
          onClick={() => router.push("/insights")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6"/>
              <path d="M10 22h4"/>
              <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.5.5 3 1.5 4 .76.76 1.23 1.52 1.41 2.5"/>
            </svg>
          )}
        />
        <MobileTab
          label={tNav("settings")}
          active={pathname.startsWith("/settings")}
          onClick={() => router.push("/settings")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          )}
        />
      </nav>

      {/* The mobile Glev action sheet was removed: the bottom-nav Glev
          tap now routes straight to /engine, which defaults to the
          engine sub-tab on Step 1 (voice input). The Mahlzeit /
          Glukose / Aktivität input flows live in the header "+"
          dropdown (QuickAddMenu) and in the engine header tabs-chip
          dropdown. The matching SheetItem helper was deleted along
          with the overlay. */}

    </div>
  );
}

/**
 * Single button slot in the new 4-tab mobile bottom nav. Kept as a tiny
 * local component so each tab definition above stays a single readable
 * JSX block instead of being buried in a NAV.map() loop — the Glev FAB
 * doesn't fit the tab shape, so a simple map() no longer made sense.
 */
function MobileTab({
  label, active, onClick, icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: (active: boolean) => React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 4, padding: "6px 2px", height: 56,
        border: "none", background: "transparent", cursor: "pointer",
        color: active ? ACCENT : NAV_INACTIVE,
        fontSize: 11, fontWeight: active ? 600 : 500, letterSpacing: "0.005em",
        borderRadius: 10,
        transition: "color 0.15s",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 22, width: 22 }}>
        {icon(active)}
      </span>
      <span style={{
        lineHeight: 1.1, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{label}</span>
    </button>
  );
}

/**
 * Compact scope picker rendered in the global mobile header while the
 * user is on /insights. Replaces the older "Insights ▾ / Einträge ▾"
 * dropdown — both surfaces are now standalone bottom-nav tabs again,
 * so the header slot is repurposed to hold the time-window selector
 * (Tag / Woche / Monat / Jahr + ◀ ▶) that every Insights card derives
 * its data from. State lives in `ScopeHeaderContext`; the Insights
 * page reads it for window math, this chip reads + writes for UI.
 */
function ScopeHeaderChip({
  mode, anchor, setMode, setAnchor,
}: {
  mode: ScopeMode;
  anchor: Date;
  setMode: (m: ScopeMode) => void;
  setAnchor: (d: Date) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("scopeHeader");
  const scope  = computeScopeWindow(mode, anchor);
  const nowMs  = Date.now();
  const isCurrent = scope.endMs > nowMs && scope.startMs <= nowMs;
  const canNext   = scope.endMs <= nowMs;

  // Step the anchor by one period in the active mode.
  const stepAnchor = (dir: -1 | 1) => {
    const a = new Date(anchor);
    if (mode === "day")   a.setDate(a.getDate() + dir);
    if (mode === "week")  a.setDate(a.getDate() + dir * 7);
    if (mode === "month") a.setMonth(a.getMonth() + dir);
    if (mode === "year")  a.setFullYear(a.getFullYear() + dir);
    setAnchor(a);
  };

  // Compact label for the closed chip.
  const labelFor = (): string => {
    if (mode === "day") {
      const today = startOfToday().getTime();
      if (scope.startMs === today) return t("today");
      const yesterday = startOfDaysAgo(1).getTime();
      if (scope.startMs === yesterday) return t("yesterday");
      return new Intl.DateTimeFormat(locale, {
        day: "numeric", month: "short", timeZone: userTimezone,
      }).format(new Date(scope.startMs));
    }
    if (mode === "week") {
      if (isCurrent) return t("this_week");
      const start = new Date(scope.startMs);
      const end   = new Date(scope.endMs - 86400000);
      const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: userTimezone });
      return `${fmt.format(start)}–${fmt.format(end)}`;
    }
    if (mode === "month") {
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: userTimezone })
        .format(new Date(scope.startMs));
    }
    return new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: userTimezone })
      .format(new Date(scope.startMs));
  };

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside pointerdown / Escape — same UX as QuickAddMenu so
  // the two header popovers feel identical to muscle memory.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const modes: { key: ScopeMode; label: string }[] = [
    { key: "day",   label: t("mode_day")   },
    { key: "week",  label: t("mode_week")  },
    { key: "month", label: t("mode_month") },
    { key: "year",  label: t("mode_year")  },
  ];

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? t("close_aria") : t("open_aria")}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", height: 28, borderRadius: 99,
          background: open ? `${ACCENT}22` : "var(--surface-soft)",
          border: `1px solid ${open ? ACCENT : "var(--border-strong)"}`,
          color: open ? ACCENT : "var(--text-body)",
          fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
          cursor: "pointer", transition: "all 0.15s",
          maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{labelFor()}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "fixed",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            width: 240,
            background: "var(--surface-alt)",
            border: `1px solid var(--border)`,
            borderRadius: 14,
            boxShadow: "var(--shadow-card)",
            padding: 10,
            zIndex: 60,
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          {/* Mode chips row — Tag / Woche / Monat / Jahr */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
            {modes.map(m => {
              const isActive = mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => { setMode(m.key); setAnchor(new Date()); }}
                  style={{
                    padding: "8px 4px",
                    background: isActive ? ACCENT : "transparent",
                    color: isActive ? "#fff" : "var(--text-strong)",
                    border: `1px solid ${isActive ? ACCENT : "var(--border)"}`,
                    borderRadius: 8,
                    fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* ◀ label ▶ row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => stepAnchor(-1)}
              aria-label={t("prev_aria")}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: "transparent", border: `1px solid var(--border)`,
                color: "var(--text-strong)", cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>
              {labelFor()}
            </div>
            <button
              type="button"
              onClick={() => canNext && stepAnchor(1)}
              disabled={!canNext}
              aria-label={t("next_aria")}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: "transparent", border: `1px solid var(--border)`,
                color: canNext ? "var(--text-strong)" : "var(--text-faint)",
                cursor: canNext ? "pointer" : "not-allowed",
                opacity: canNext ? 1 : 0.4,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

