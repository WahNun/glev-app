"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "@/lib/auth";
import GlevLockup from "@/components/GlevLockup";
import GlevLogo from "@/components/GlevLogo";
import AboutGlevModal from "@/components/AboutGlevModal";
import QuickAddMenu from "@/components/QuickAddMenu";
import { EngineHeaderProvider, useEngineHeader } from "@/lib/engineHeaderContext";
import { HistoryHeaderProvider, useHistoryHeader, type HistoryTab } from "@/lib/historyHeaderContext";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";
const BG      = "#09090B";

// Mobile nav uses slightly different surfaces than the rest of the app:
// the spec asks for #111117 with a 0.08-alpha top border (vs the global
// 0.06 BORDER), and inactive tabs use a brighter 0.4-alpha white than
// the desktop sidebar's 0.45 so the 4-tab bar reads cleanly on phones.
const NAV_SURFACE  = "#111117";
const NAV_BORDER   = "rgba(255,255,255,0.08)";
const NAV_INACTIVE = "rgba(255,255,255,0.4)";

// Desktop sidebar items. 4 entries, mirrors the mobile bottom-nav set
// vertically. The user explicitly requested the order
// "Dashboard / Glev / Verlauf / Einstellungen" (task #19) — Glev sits
// in slot 2, the same position it occupies as the centered FAB on
// mobile (Dashboard | [Glev FAB] | History | Settings). Labels reuse
// the nav.* i18n keys so a German user sees "Verlauf" and an English
// user sees "History". The "log" tab and standalone "insights" tab
// were dropped per user request — both are now reachable via the
// merged Verlauf page (/history) which has internal Insights/Entries
// sub-tabs.
type NavKey = "dashboard" | "glev" | "history" | "settings";
type NavItem = { key: NavKey; path: string; icon: (a: boolean) => React.ReactNode };
const NAV: NavItem[] = [
  { key: "dashboard", path: "/dashboard", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  )},
  // Glev brand mark in the nav rail. Recoloured monochrome (grey when
  // inactive, ACCENT when active) so its visual weight sits on the same
  // tier as the other line-icon tabs — the multi-node logo no longer
  // dominates the row. Active state additionally gets an ACCENT drop-
  // shadow halo so the selection pops without resorting to a different
  // shape from the rest.
  { key: "glev", path: "/engine", icon: (a) => (
    <span style={{ display: "inline-flex", filter: a ? `drop-shadow(0 0 6px ${ACCENT}99)` : undefined, transition: "filter 0.2s" }}>
      <GlevLogo size={18} color={a ? ACCENT : "rgba(255,255,255,0.45)"} bg="transparent"/>
    </span>
  )},
  { key: "history", path: "/history", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><polyline points="12 7 12 12 16 14"/></svg>
  )},
  { key: "settings", path: "/settings", icon: (a) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  )},
];

export default function Layout({ children }: { children: React.ReactNode }) {
  // Wrap the actual layout body in BOTH page-header providers so the
  // mobile global header (rendered inside LayoutInner) and each page
  // (rendered as `children`) share state for their respective header
  // controls. EngineHeaderProvider drives the engine tabs chip;
  // HistoryHeaderProvider drives the Insights/Einträge dropdown.
  return (
    <EngineHeaderProvider>
      <HistoryHeaderProvider>
        <LayoutInner>{children}</LayoutInner>
      </HistoryHeaderProvider>
    </EngineHeaderProvider>
  );
}

function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const tNav = useTranslations("nav");
  const [aboutOpen, setAboutOpen] = useState(false);
  // Mobile bottom-nav: tapping the Glev slot now goes STRAIGHT to the
  // engine voice screen (the meal log flow) instead of popping a
  // pick-your-flow action sheet. The two secondary flows (Glukose
  // messen / Aktivität loggen) live in the header "+" dropdown
  // (QuickAddMenu) so the bottom-nav tap stays a single decisive
  // gesture. The old `glevSheetOpen` state + bottom action sheet
  // were removed in this same change.
  const engineHdr  = useEngineHeader();
  const historyHdr = useHistoryHeader();

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

  // Same defensive reset for the history-header dropdown — when the
  // user leaves /history (or /insights / /entries which the history
  // page composes internally), the small "Insights ▾ / Einträge ▾"
  // chip must disappear from the global header even if the page's
  // own unmount handler hasn't fired yet.
  useEffect(() => {
    if (!pathname.startsWith("/history")) {
      historyHdr.setVisible(false);
    }
  }, [pathname, historyHdr]);

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
          <GlevLockup size={26} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Engine-page tab toggle. Only rendered when the engine page
              registers itself via EngineHeaderProvider. Sits oben rechts
              alongside the Live badge + user icon so the page body can
              start the chat panel immediately under the global header
              without any intermediate "Glev Engine" title block. */}
          {engineHdr.visible && (
            <button
              type="button"
              onClick={engineHdr.toggleTabs}
              aria-label={engineHdr.tabsExpanded ? "Tabs einklappen" : "Tabs ausklappen"}
              aria-expanded={engineHdr.tabsExpanded}
              aria-controls="engine-tabs-body"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 10px", height: 28, borderRadius: 99,
                background: engineHdr.tabsExpanded ? `${ACCENT}22` : "rgba(255,255,255,0.05)",
                border: `1px solid ${engineHdr.tabsExpanded ? ACCENT : "rgba(255,255,255,0.1)"}`,
                color: engineHdr.tabsExpanded ? ACCENT : "rgba(255,255,255,0.7)",
                fontSize: 11, fontWeight: 700, letterSpacing: "-0.01em",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <span>{engineHdr.activeLabel}</span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
                style={{ transition: "transform 0.2s", transform: engineHdr.tabsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          )}
          {/* History-page sub-tab dropdown. Only rendered while the
              user is on /history; the page registers itself via
              HistoryHeaderProvider on mount. Replaces the old in-body
              "Insights / Einträge" pill so /history opens straight to
              the cards without a row of vertical chrome at the top. */}
          {historyHdr.visible && (
            <HistoryHeaderChip tab={historyHdr.tab} setTab={historyHdr.setTab} />
          )}
          <div style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: `${GREEN}18`, color: GREEN, fontWeight: 600 }}>Live</div>
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
            onClick={() => router.push("/settings")}
            aria-label="Open settings"
            style={{
              width: 32, height: 32, borderRadius: 99, padding: 0,
              background: pathname.startsWith("/settings") ? `${ACCENT}25` : "rgba(255,255,255,0.05)",
              border: `1px solid ${pathname.startsWith("/settings") ? ACCENT : "rgba(255,255,255,0.1)"}`,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={pathname.startsWith("/settings") ? ACCENT : "rgba(255,255,255,0.6)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </button>
        </div>
      </header>

      <AboutGlevModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

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
          <GlevLockup size={28} />
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
                color: active ? ACCENT : "rgba(255,255,255,0.45)",
                fontSize: 13, fontWeight: active ? 600 : 400,
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
          color: "rgba(255,255,255,0.18)", fontSize: 12, textAlign: "left", width: "100%",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </aside>

      <main className="glev-main" style={{ flex: 1, padding: "28px 32px", maxWidth: "100%", overflowX: "hidden" }}>
        {children}
      </main>

      {/* MOBILE BOTTOM NAV — 4 visible tabs (Dashboard left, Glev center
          elevated, History right-of-center, Settings far right). Glev is a
          floating circular FAB that opens an action sheet instead of
          navigating; the spacer slot keeps the 4 underlying labels evenly
          distributed so the elevated button doesn't visually collide with
          its neighbours. The sheet itself lives below as a portal-style
          overlay so it can cover the nav. */}
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
        {/* Glev tab — equal-weight 4th-of-4 slot. Tapping routes
            STRAIGHT to /engine (no ?tab= query). The engine page
            defaults to the "engine" sub-tab on Step 1 (voice input),
            which is the entry point the user expects. Sub-screens
            (Log, Bolus, Aktivität, Fingerstick) are reachable from
            the header "+" dropdown (QuickAddMenu) and from the
            engine header tabs-chip; the bottom-nav tap stays a
            single decisive gesture into the headline tool. The
            three-way "pick a flow" action sheet was removed in this
            same change.
            Visual rules:
              - no background bubble / circle / FAB elevation
              - same icon size + stroke as the other 3 tabs
              - active = icon+label colour change to ACCENT whenever
                the user is anywhere under /engine. */}
        <MobileTab
          label={tNav("glev")}
          active={pathname.startsWith("/engine")}
          onClick={() => router.push("/engine")}
          icon={(a) => (
            <GlevLogo size={22} color={a ? ACCENT : NAV_INACTIVE} bg="transparent"/>
          )}
        />
        <MobileTab
          label={tNav("history")}
          active={pathname.startsWith("/history")}
          onClick={() => router.push("/history")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
              <polyline points="12 7 12 12 16 14" />
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
        fontSize: 11, fontWeight: active ? 600 : 500, letterSpacing: "0.01em",
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
 * Compact "Insights ▾ / Einträge ▾" chip rendered in the global
 * mobile header while the user is on /history. Mirrors the visual
 * shape of the engine tabs chip (same height, padding, fontSize)
 * so the two coexist cleanly when /engine is unrelated. Tapping
 * opens a small popover with the two tabs; selecting one writes
 * back into the shared HistoryHeaderContext, which the /history
 * page reads to swap its body between Insights and Einträge.
 */
function HistoryHeaderChip({
  tab, setTab,
}: {
  tab: HistoryTab;
  setTab: (t: HistoryTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside pointerdown / Escape — matches QuickAddMenu so
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

  const labelFor = (t: HistoryTab) => (t === "insights" ? "Insights" : "Einträge");

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Verlauf-Tabs schließen" : "Verlauf-Tabs öffnen"}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", height: 28, borderRadius: 99,
          background: open ? `${ACCENT}22` : "rgba(255,255,255,0.05)",
          border: `1px solid ${open ? ACCENT : "rgba(255,255,255,0.1)"}`,
          color: open ? ACCENT : "rgba(255,255,255,0.7)",
          fontSize: 11, fontWeight: 700, letterSpacing: "-0.01em",
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        <span>{labelFor(tab)}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 180,
            background: "#1A1A24",
            border: `1px solid rgba(255,255,255,0.08)`,
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            padding: 6,
            zIndex: 60,
          }}
        >
          {(["insights", "entries"] as const).map(t => {
            const isActive = tab === t;
            return (
              <button
                key={t}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => { setTab(t); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 12px",
                  background: isActive ? `${ACCENT}22` : "transparent",
                  border: "none",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.85)",
                  fontSize: 13.5, fontWeight: isActive ? 700 : 500,
                  cursor: "pointer", textAlign: "left",
                  borderRadius: 10,
                }}
              >
                <span>{labelFor(t)}</span>
                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
