"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { hapticSelection } from "@/lib/haptics";
import { useTranslations } from "next-intl";
import { signOut } from "@/lib/auth";
import GlevLockup from "@/components/GlevLockup";
import GlevLogo from "@/components/GlevLogo";
import AccountSheet from "@/components/AccountSheet";
import DashboardQuickAddSheet from "@/components/DashboardQuickAddSheet";
import AiHelperSheet from "@/components/AiHelperSheet";
import GlevAIButton from "@/components/GlevAIButton";
import { fetchAiConsent } from "@/lib/userSettings";
import { EngineHeaderProvider, useEngineHeader } from "@/lib/engineHeaderContext";
import { EngineSourceHeaderProvider, useEngineSourceHeader } from "@/lib/engineSourceHeaderContext";
import { EngineWizardStepProvider, useEngineWizardStep } from "@/lib/engineWizardStepContext";
import { VoiceRecordingProvider, useVoiceRecording } from "@/lib/voiceRecordingContext";
import {
  ScopeHeaderProvider, useScopeHeader,
  type ScopeMode,
} from "@/lib/scopeHeaderContext";

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
      <EngineSourceHeaderProvider>
        <EngineWizardStepProvider>
          <ScopeHeaderProvider>
            <VoiceRecordingProvider>
              <LayoutInner>{children}</LayoutInner>
            </VoiceRecordingProvider>
          </ScopeHeaderProvider>
        </EngineWizardStepProvider>
      </EngineSourceHeaderProvider>
    </EngineHeaderProvider>
  );
}

function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const tNav = useTranslations("nav");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  // The mobile-header AccountSheet trigger was removed in the
  // 2026-05-17 header-decluttering revision (header now only carries
  // the brand lockup + the recording-state pill). Konto/Profil flows
  // are reachable via the Settings bottom-nav tab. AccountSheet
  // import + render were dropped along with the trigger so we don't
  // leave dead code behind.
  // Bottom-nav "Glev" slot is no longer a direct route to /engine — it now
  // opens the shared quick-add sheet (Engine + all logging entry points).
  // State lives here so the sheet works from every protected screen.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [aiToast, setAiToast] = useState(false);

  useEffect(() => {
    fetchAiConsent().then(setAiConsent).catch(() => {});
  }, []);
  // CGM-source for the "● Live" header pill on /dashboard.
  const [cgmSource, setCgmSource] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/cgm/source", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { source: string | null } | null) => { if (d?.source) setCgmSource(d.source); })
      .catch(() => {});
  }, []);
  // Voice-recording bridge: while the engine is recording, the FAB's
  // tap means "stop recording" (not "open quick-add"), and a "Speak"
  // pill appears in the header as a global cue + secondary stop tap.
  const voice = useVoiceRecording();
  // Footer-nav helper: always navigate, but gracefully stop any active
  // voice recording first (2026-05-17 user request: "footer navigation
  // sollte zu jeder zeit erlaubt sein egal welchen zustand bestimmte
  // tabs gerade repräsentieren"). Without this, tapping Dashboard /
  // Entries / Insights / Settings while recording would leave the mic
  // stream and the pulsing header pill running on the next screen.
  // The centre Glev FAB keeps its own behaviour (tap = stop recording)
  // and is intentionally NOT routed through navTo.
  //
  // 2026-05-17 round 6 (TestFlight feedback: "einstellungen und insights
  // laden sehr verzögert") — heavy routes like /insights and /settings
  // can take 1-2 s to swap in on iOS WKWebView, and during that gap the
  // tap looked dead. We fire INSTANT feedback the moment the user taps:
  //   1. Selection haptic (native click feel).
  //   2. Optimistic active highlight on the tapped tab (`pendingPath`).
  //   3. A small spinner on top of the tab icon while the new route
  //      streams in.
  // Once the new route's RSC payload streams in, `pathname` updates and
  // we clear `pendingPath`, so the active highlight returns to being
  // sourced from the URL.
  //
  // 2026-05-18 (TestFlight feedback: "dashboard und entries gehen nicht
  // mehr") — we previously wrapped `router.push` in `startTransition`.
  // On iOS WKWebView that combo can defer the push when the prefetch
  // loop is hammering the connection in parallel, making the tap feel
  // dead. router.push is now called synchronously; the pending visual
  // is driven solely by `pendingPath` (cleared by the pathname effect
  // when the route lands).
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useEffect(() => {
    if (pendingPath && pathname.startsWith(pendingPath)) {
      setPendingPath(null);
    }
  }, [pathname, pendingPath]);

  // Header scroll-fade: hide on scroll-down, reveal on scroll-up.
  // Only active on mobile (the fixed header is only rendered there).
  // Engine keeps the header always visible — its cockpit doesn't scroll
  // inside .glev-main so the listener never fires anyway, but we also
  // reset `headerHidden` whenever the route changes so navigating away
  // from a long page never leaves the header stuck in the hidden state.
  const mainRef = useRef<HTMLElement>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  useEffect(() => {
    setHeaderHidden(false);
    lastScrollYRef.current = 0;
  }, [pathname]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = el.scrollTop;
      const delta = y - lastScrollYRef.current;
      if (delta > 6) {
        setHeaderHidden(true);
      } else if (delta < -4) {
        setHeaderHidden(false);
      }
      lastScrollYRef.current = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const navTo = (path: string) => {
    hapticSelection();
    // 2026-05-18 round 7 (TestFlight tap loss fix): defer voice stop into
    // a microtask so its setState cascade (recording=false, engine page
    // teardown, re-render) cannot run synchronously between this call and
    // the router.push below. Previously a tab tap during an active voice
    // recording would (a) trigger the capture-phase tap-anywhere-stop
    // listener in VoiceRecordingProvider AND (b) call requestStop again
    // here — the resulting double-flush sometimes left React in a state
    // where the router.push appeared to be queued but never committed on
    // WKWebView, looking like the tap was "dead".
    if (voice.recording) {
      queueMicrotask(() => { try { voice.requestStop(); } catch {} });
    }
    setPendingPath(path);
    router.push(path);
  };

  // 2026-05-17 round 6 (lever A — prefetch): on iOS WKWebView the very
  // first tap on a bottom-nav tab pays the full RSC + JS-chunk roundtrip
  // because there is no `<Link>` hover-prefetch on touch and the app
  // shell starts with an empty cache. We warm every primary tab once,
  // shortly after the app is interactive, so the very first bottom-nav
  // tap only re-renders cached chunks.
  //
  // 2026-05-18 TestFlight fix: previously the warm loop re-ran on every
  // `pathname` change, so each tab tap kicked off 3 fresh RSC prefetches
  // that competed with the user's NEXT tap for WKWebView's small HTTP/2
  // connection pool. That looked like "sporadic" footer-tap response.
  // Now: warm exactly once per session (run on first mount, with the
  // prefetch list captured once). Next.js' own router cache keeps the
  // already-visited tabs warm without us re-firing prefetches.
  // 2026-05-18 round 10 (TestFlight: "seiten laden langsam"):
  // Next.js 15 router cache for dynamic prefetched routes expires after
  // ~30 s. The old code warmed exactly once per session, so after the
  // first half-minute every tab swap paid the full RSC + Supabase RTT
  // again — which on iOS WKWebView feels like a 1-2 s freeze. Now we
  // re-warm after every navigation, but ONLY when the browser is idle
  // and the new route has settled (idleCallback fires after current
  // commit + paint). That keeps competing prefetches from clogging the
  // tiny HTTP/2 pool during the user's NEXT tap.
  useEffect(() => {
    const tabs = ["/dashboard", "/entries", "/insights", "/settings"];
    const warm = () => {
      for (const p of tabs) {
        if (pathname.startsWith(p)) continue; // current tab already loaded
        try { router.prefetch(p); } catch {}
      }
    };
    const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }) : null;
    if (w && typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 3000 });
      return () => {
        const cancel = (w as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cancel === "function") cancel(id);
      };
    }
    const id = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(id);
  }, [pathname, router]);
  // Mobile bottom-nav: tapping the Glev slot now goes STRAIGHT to the
  // engine voice screen (the meal log flow) instead of popping a
  // pick-your-flow action sheet. The two secondary flows (Glukose
  // messen / Aktivität loggen) live in the header "+" dropdown
  // (QuickAddMenu) so the bottom-nav tap stays a single decisive
  // gesture. The old `glevSheetOpen` state + bottom action sheet
  // were removed in this same change.
  const engineHdr  = useEngineHeader();
  const scopeHdr   = useScopeHeader();
  const sourceHdr  = useEngineSourceHeader();
  const wizardStep = useEngineWizardStep();
  const tEngineHdr = useTranslations("engine");

  // 2026-05-18: this debug ping previously ran on every Layout mount
  // (i.e. every client-side navigation) and pulled the last 20 meals
  // + an exact count from Supabase. On iOS WKWebView's small HTTP
  // connection pool that was enough to make the very next bottom-nav
  // tap feel "sporadic" — router.push had to wait behind the debug
  // request. Now gated to localhost dev only.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && /^localhost(:|$)/.test(window.location.host)) {
      fetch("/api/debug/state").then(r => r.json()).then(d => console.log("[DEBUG:STATE]", d)).catch(() => {});
    }
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

  // And the engine nutrition-source pill — only ever relevant while
  // the user is on /engine; clear defensively on every other route
  // so a leftover Step-2 source doesn't bleed onto Dashboard /
  // Settings / etc. if Next's streaming defers the engine page's
  // unmount cleanup.
  useEffect(() => {
    if (!pathname.startsWith("/engine")) {
      sourceHdr.setSource(null);
      wizardStep.setStep(null);
    }
  }, [pathname, sourceHdr, wizardStep]);

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
          /* Lock the document so iOS WKWebView cannot rubber-band the
             whole page. overscroll-behavior on html/body alone is NOT
             honoured reliably in WKWebView (= the Capacitor iOS shell),
             so the document-level bounce kept making the fixed header
             grow at top-scroll and the fixed footer grow at bottom-
             scroll. By position:fixed-locking html+body we forbid any
             document scroll, and move the actual scrolling into the
             <main> container below — which then can't bounce because
             its content fits inside a fixed-size viewport with
             overscroll-behavior: contain. */
          html, body {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            overscroll-behavior: none !important;
          }
          .glev-main        {
            /* Take the full viewport so we can scroll INSIDE this
               element instead of letting the document scroll. dvh
               (dynamic viewport height) tracks iOS keyboard / status-
               bar overlays better than 100vh in WKWebView. Padding
               still reserves space for the fixed header (top) and
               fixed nav (bottom) so children clear the chrome. */
            height: 100dvh !important;
            overflow-y: auto !important;
            overscroll-behavior-y: contain !important;
            -webkit-overflow-scrolling: auto !important;
            /* Vertical paddings match the ACTUAL fixed chrome heights
               so the scrollable content sits visually flush with the
               header's bottom border and the nav's top border (no dark
               page-bg band above/below cards).

               2026-05-17 round 2 (user request: "zu viel blank space
               unter footer nav und über dem header"): header & nav
               chrome both trimmed.

               2026-05-17 round 3 (user request: header "too tall, no
               need for so much mass — cut in half"): header content
               halved from 38px → 22px.

               2026-05-17 round 4 (user request: "der header darf
               schon inetwa so dick wie der footer sein"): header
               restored to footer-matching mass. Lockup 16 → 32 px,
               top + bottom pad 3 → 16 px each. That gave 64 px which
               STILL read thinner than the footer.

               2026-05-17 round 5 (user request: "wieso ist es so
               schwer den header genauso dick wie footer nav zu
               machen"): header content band raised to 72 px.

               2026-05-18 round 7 (user request: "header ist immer
               noch zu dick im ios testflight … genau die dicke wie
               der footer"): a 56-px content band still ended up
               visually taller than the footer because the iOS safe-
               area-top (47–59 px on notched phones) sits ON TOP of
               that band — the footer only carries ~34 px of safe-
               area-bottom. Header content band trimmed to 44 px
               (6 + 32 + 6) so the visible chrome below the status
               bar reads slimmer than the footer's tab strip.

               Header total height = safe-area-top + 44 px
                 (6 top pad + 32 lockup + 6 bottom pad).

               Nav total height = 4 (top pad) + 56 (MobileTab fixed
               height — NOT 22+4+12; the button is hard-fixed to 56 px
               regardless of icon/label sizes) + max(8, safe-area-
               bottom - 22). So:
                 • notched (sa-bot ≈ 34): 4 + 56 + 12 = 72 px
                 • non-notched (sa-bot = 0): 4 + 56 + 8 = 68 px

               Main bottom padding must always EXCEED nav height by a
               safe buffer so sub-pixel scroll rounding can never let
               the next card peek out below the labels (2026-05-18 user
               report: thin strip of content visible under the labels).
               Floor 76 px = 68 nav + 8 buffer. Notched branch
               sa-bot + 46 = 34 + 46 = 80 → 8 px buffer over 72-px nav.
               Architect 2026-05-17 caught that the previous math used
               icon+label dimensions and was under-counting nav height
               by ~16 px. */
            /* Task #363: vertical padding is now derived from the
               --nav-top-total / --nav-bottom-total CSS variables
               defined in app/globals.css — single source of truth for
               header & footer chrome geometry. Buffer of 8 px under
               the footer prevents sub-pixel scroll rounding from
               leaking a strip of the next card under the labels. */
            padding: calc(var(--nav-top-total) + 4px) 16px calc(var(--nav-bottom-total) + 8px) !important;
          }
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
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 99, overflow: "visible",
        // iOS notch / Dynamic Island: push content below the status bar by
        // honouring safe-area-inset-top, with a sensible fallback for
        // browsers that don't expose it (e.g. desktop dev tools).
        // 2026-05-18 round 7 (user request: "header ist immer noch zu
        // dick im ios testflight, wir haben doch schon tausendmal
        // gesagt er soll genau die dicke wie der footer bekommen"):
        // The 12/12 + 32 = 56 px content band matched the MobileTab
        // numerically, but on iPhone the `safe-area-inset-top` adds
        // another ~47–59 px of header chrome above the lockup that
        // the footer simply doesn't have (its sab is only ~34 px).
        // Net result: header ended up ~30–40 px taller than the
        // footer in actual screen pixels. Shrink the content band
        // to 44 px (6 + 32 + 6) so the visible block under the
        // status bar reads as a slim app bar, not a second header.
        // Keep .glev-main's padding-top compensator in sync above.
        // 2026-05-18 round 8: header content band 4 + 28 + 4 = 36 px
        // sits below the safe-area-top zone. With capacitor
        // contentInset:"never" the BG now paints through the status
        // bar via sa-top, matching how the footer paints through
        // sa-bottom — visually the two chrome bars look equally slim.
        // 2026-05-18 round 9 (user: "header könnte ein kleines bisschen
        // mehr blank space unter dem wordmark"): bottom pad 4 → 10 px
        // so the wordmark has visible breathing room above the header
        // border instead of kissing it. Top pad stays tight (4 px) —
        // the status-bar safe-area zone already separates the wordmark
        // from the clock/battery row above.
        // Task #363: vertical padding now sources from the central
        // --nav-top-safe variable in app/globals.css.
        // Task #382: bottom pad implemented (was documented but stayed
        // at 4 px — now correctly set to 10 px).
        height: "var(--nav-top-total)",
        paddingTop: "var(--nav-top-safe)",
        paddingBottom: 11,
        paddingLeft:  "max(18px, env(safe-area-inset-left))",
        paddingRight: "max(18px, env(safe-area-inset-right))",
        background: SURFACE,
        borderBottom: `1px solid ${BORDER}`,
        alignItems: "center", justifyContent: "space-between",
        // Scroll-fade: slide up + fade out on scroll-down, reverse on scroll-up.
        transform: headerHidden ? "translateY(-100%)" : "translateY(0)",
        opacity: headerHidden ? 0 : 1,
        transition: "transform 220ms cubic-bezier(.4,0,.2,1), opacity 220ms ease",
        // Keep pointer-events off when hidden so taps don't land on the
        // invisible header instead of the content below.
        pointerEvents: headerHidden ? "none" : undefined,
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
          {pathname.startsWith("/dashboard") && cgmSource && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              height: 20, padding: "0 7px", borderRadius: 99,
              background: "#22D3A014",
              border: "1px solid #22D3A035",
              color: "#22D3A0",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
              flexShrink: 0, userSelect: "none",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22D3A0", boxShadow: "0 0 4px #22D3A0bb" }} aria-hidden />
              Live
            </div>
          )}
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
              setMode={scopeHdr.setMode}
              setAnchor={scopeHdr.setAnchor}
            />
          )}
          {/* Engine wizard step indicator — slim 3-segment track
              centered in the header. Published by the engine page
              via EngineWizardStepProvider; cleared on route change.
              Style mirrors InsightsCockpitIndicator: thin 2 px track,
              ACCENT sliding fill with glow, faint labels below.
              Uses position:absolute so it doesn't disturb the logo
              (flex:1) or the right chip group (flex-shrink:0). */}
          {pathname.startsWith("/engine") && wizardStep.step !== null && (() => {
            const ACCENT_HDR = "#4F6EF7";
            const labels = [
              tEngineHdr("step_label_food"),
              tEngineHdr("step_label_macros"),
              tEngineHdr("step_label_result"),
            ];
            const total = labels.length;
            const active = wizardStep.step;
            const segPct = 100 / total;
            return (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 6,
                  transform: "translateX(-50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  pointerEvents: "none",
                  width: 148,
                }}
              >
                {/* Step labels row */}
                <div style={{ display: "flex", width: "100%", justifyContent: "space-between" }}>
                  {labels.map((label, i) => (
                    <span
                      key={label}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: i === active ? ACCENT_HDR : "var(--text-faint)",
                        transition: "color 240ms ease",
                        width: `${segPct}%`,
                        textAlign: "center",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                {/* Segmented track */}
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: 2,
                    background: "var(--border-soft)",
                    borderRadius: 99,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      height: "100%",
                      width: `${segPct}%`,
                      background: ACCENT_HDR,
                      borderRadius: 99,
                      transform: `translateX(${active * 100}%)`,
                      transition: "transform 240ms cubic-bezier(.2,.7,.2,1)",
                      boxShadow: `0 0 6px ${ACCENT_HDR}88`,
                    }}
                  />
                </div>
              </div>
            );
          })()}
          {/* Engine nutrition-source provenance pill — published by
              the engine page via EngineSourceHeaderProvider whenever
              /api/parse-food or /api/chat-macros returns a source.
              Lives here (next to the brand lockup) instead of inside
              the Step-2 macros card so the card body keeps the full
              vertical real estate for macros + glucose + time + CTA
              on iPhone 13 mini. Palette mirrors the in-card pill it
              replaced: green = DB, orange = mixed, pink = estimated,
              red+pulse = unknown (hard warning before dosing). */}
          {sourceHdr.source && (() => {
            // Slimmed-down provenance indicator (2026-05-17 user
            // request: "dürfte dünner und unauffälliger werden, vom
            // style lieber wie die Leiste im Insights-Screen"). The
            // previous version was a 28-px filled pill with bg+border
            // that competed with the brand lockup; this rendition
            // drops bg/border for the three benign states and renders
            // the label in the dot's semantic colour itself (which
            // passes WCAG AA on the dark header surface for all three
            // and is more meaningful than neutral grey). The unknown
            // state KEEPS its filled bg + border because it is a hard
            // pre-dose safety warning whose salience must not be
            // diluted — architect flagged this explicitly. The
            // "Source:" prefix is dropped (context = engine header).
            const isUnknown = sourceHdr.source === "unknown";
            const dotColor = sourceHdr.source === "database"
              ? "#22D3A0"
              : sourceHdr.source === "mixed"
                ? "#FF9500"
                : sourceHdr.source === "estimated"
                  ? "#FF2D78"
                  : "#FF6B6B";
            const label = tEngineHdr(`nutrition_source_${sourceHdr.source}`);
            const tip   = tEngineHdr(`nutrition_source_explain_${sourceHdr.source}`);
            return (
              <div
                title={tip}
                aria-label={`${tEngineHdr("nutrition_source_label")}: ${label}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  height: isUnknown ? 24 : "auto",
                  padding: isUnknown ? "0 10px" : 0,
                  borderRadius: isUnknown ? 99 : 0,
                  background: isUnknown ? "#FF2D2D22" : "transparent",
                  border: isUnknown ? "1px solid #FF2D2D80" : "none",
                  color: dotColor,
                  fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: dotColor,
                }} aria-hidden="true" />
                {label}
              </div>
            );
          })()}
          {/* Per 2026-05-17 UX revision the header "+" QuickAddMenu and
              the account avatar were removed: the centre bottom-nav
              Glev FAB now hosts the quick-add sheet (single global
              entry-point), and account/settings live in the bottom-nav
              Settings tab. The header keeps the brand lockup on the
              left and a recording-state pill on the right — only
              visible while the engine is actively listening. */}
          {voice.recording && (
            <button
              type="button"
              onClick={voice.requestStop}
              aria-label="Sprachaufnahme beenden"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                height: 32, padding: "0 12px", borderRadius: 99,
                background: `${ACCENT}1f`,
                border: `1px solid ${ACCENT}`,
                color: ACCENT,
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.005em",
                cursor: "pointer",
                animation: "glevMicPulse 1.4s ease-in-out infinite",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: ACCENT,
                boxShadow: `0 0 8px ${ACCENT}`,
              }} aria-hidden="true" />
              Speak
            </button>
          )}
        </div>
      </header>

      {/* Wordmark-tap surface — unified with the /settings Account row
          to a single AccountSheet (2026-05-17). The previous bespoke
          AboutGlevModal showed only Version + email and looked nothing
          like the Account sheet; users now see the same avatar + plan
          pill + stats + change-password + sign-out wherever they enter
          (header wordmark or settings row), with the app version as a
          discreet footer in the sheet. */}
      <AccountSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />

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

        <div style={{ marginTop: 16, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
          {signOutConfirm ? (
            <div style={{ padding: "6px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>Sign out?</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  aria-label="Confirm sign out"
                  onClick={handleSignOut}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                    cursor: "pointer", background: "#ef4444", color: "#fff",
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  Confirm
                </button>
                <button
                  aria-label="Cancel sign out"
                  onClick={() => setSignOutConfirm(false)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none",
                    cursor: "pointer", background: "var(--surface-2, var(--surface))",
                    color: "var(--text-dim)", fontSize: 12,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              aria-label="Sign out of Glev"
              onClick={() => setSignOutConfirm(true)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                borderRadius: 10, border: "none", cursor: "pointer", background: "transparent",
                color: "var(--text-ghost)", fontSize: 13, textAlign: "left", width: "100%",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          )}
        </div>
      </aside>

      <main ref={mainRef} className="glev-main" style={{ flex: 1, padding: "28px 32px", maxWidth: "100%", overflowX: "hidden", zoom: 1.12 }}>
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
        // 2026-05-18 round 8: with capacitor `contentInset: "never"`
        // the WebView now extends through the home-indicator zone, so
        // we honour env(safe-area-inset-bottom) properly. The colored
        // nav surface paints all the way to the physical phone edge
        // (no blank gap under the labels), and labels sit safely above
        // the home indicator pill via the sa-bot bottom padding.
        // Web/Android (sa-bot = 0) → 4 px floor.
        // 2026-05-18 round 9 (user: "footer ist zu hoch zu viel blank
        // space unter den icons"): the full sa-bottom (~34 px on iPhone
        // X+) leaves the home-indicator pill alone but visually creates
        // a big empty band under the labels. Cut it in half — labels
        // still clear the home indicator (sa-bot/2 ≈ 17 px is more than
        // the 8 px pill height + ~6 px breathing room) and the colored
        // footer band reads compact. Web/Android (sa-bot = 0) → 4 px.
        // Task #363: footer geometry now sources from the central
        // --nav-bottom-* variables in app/globals.css.
        height: "var(--nav-bottom-total)",
        paddingTop:    "var(--nav-bottom-top-pad)",
        paddingBottom: "var(--nav-bottom-safe)",
        paddingLeft:   4,
        paddingRight:  4,
        zIndex: 100,
        // Scroll-fade: slides down + fades out on scroll-down, mirrors header.
        transform: headerHidden ? "translateY(100%)" : "translateY(0)",
        opacity: headerHidden ? 0 : 1,
        transition: "transform 220ms cubic-bezier(.4,0,.2,1), opacity 220ms ease",
        pointerEvents: headerHidden ? "none" : undefined,
      }}>
        <MobileTab
          label={tNav("dashboard")}
          active={pathname.startsWith("/dashboard")}
          pending={pendingPath === "/dashboard"}
          onClick={() => navTo("/dashboard")}
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
          pending={pendingPath === "/entries"}
          onClick={() => navTo("/entries")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          )}
        />
        <MobileGlevFab
          label={tNav("glev")}
          active={quickAddOpen || voice.recording}
          recording={voice.recording}
          // Short-tap behaviour (2026-05-17 round 5 — user request:
          // "der glev button sollte direkt in den engine screen
          // springen und aufnahme starten wenn man ihn kurz drückt
          // außerhalb des glev screens"). Two states only now:
          //   1. Recording in progress → stop (any tap length).
          //   2. Anything else → jump to /engine and auto-start a
          //      voice take. The `vt` (voice-token) cache-buster
          //      guarantees the engine page treats every tap as a
          //      fresh trigger even when the user is already on
          //      /engine — without it, the searchParams shape
          //      (?tab=engine&voice=1) is identical across taps and
          //      the auto-start effect's de-dup guard would swallow
          //      repeat taps. See engine/page.tsx voiceLastTokenRef.
          // The quick-add sheet now lives EXCLUSIVELY behind the
          // long-press affordance below.
          onShortPress={() => {
            if (voice.recording) {
              voice.requestStop();
              return;
            }
            router.push("/engine");
          }}
          // Long-press always opens the menu, regardless of session
          // state — that's the "secondary" affordance per 2026-05-17
          // user request: short tap = repeat voice, long press = menu.
          onLongPress={() => {
            if (voice.recording) {
              // Don't yank focus away mid-recording.
              return;
            }
            setQuickAddOpen(true);
          }}
        />
        <MobileTab
          label={tNav("insights")}
          active={pathname.startsWith("/insights")}
          pending={pendingPath === "/insights"}
          onClick={() => navTo("/insights")}
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
          pending={pendingPath === "/settings"}
          onClick={() => navTo("/settings")}
          icon={(a) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : NAV_INACTIVE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          )}
        />
      </nav>

      {/* Shared quick-add sheet, triggered by the centre Glev slot in
          the bottom nav. Same component (and same `useQuickAddVisibleItems`
          source of truth) the dashboard CTA opens — so Engine, Insulin,
          Fingerstick, Activity, Cycle, Symptoms and Influences all sit
          one tap away regardless of which screen the user is on. */}
      <DashboardQuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <AiHelperSheet open={aiSheetOpen} onClose={() => setAiSheetOpen(false)} />

      {/* Coming-soon toast — shown when user taps FAB without ai_consent */}
      {aiToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(18,20,36,0.95)",
            border: "1px solid rgba(79,110,247,0.3)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 13,
            fontWeight: 500,
            padding: "10px 18px",
            borderRadius: 20,
            whiteSpace: "nowrap",
            zIndex: 2000,
            pointerEvents: "none",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          Coming soon — AI-Features in Kürze
        </div>
      )}

    </div>
  );
}

/**
 * Centre nav slot that visually replaces a normal MobileTab with a raised
 * Glev-branded bubble (round, accent ring + soft halo, same look as the
 * Engine "Speak" button). Tapping it opens the shared quick-add sheet
 * (Engine + logging shortcuts) instead of routing — per the 2026-05-17
 * UX revision the bottom-nav Glev slot no longer points at /engine
 * directly; the sheet hosts that link plus everything else.
 */
function MobileGlevFab({
  label, active, onShortPress, onLongPress, recording = false,
}: {
  label: string;
  active: boolean;
  onShortPress: () => void;
  onLongPress: () => void;
  recording?: boolean;
}) {
  // Long-press detection: 500 ms threshold matches the iOS/Material
  // convention for context-menu-style long presses. We intentionally
  // do NOT debounce a separate onClick handler because pointer events
  // already cover mouse + touch + pen; the onClick prop on the button
  // is kept only as a keyboard-activation fallback (Enter / Space)
  // and is gated by `pointerHandledRef` so taps don't double-fire.
  const timerRef = useRef<number | null>(null);
  const longFiredRef = useRef(false);
  const pointerHandledRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    pointerHandledRef.current = true;
    longFiredRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      longFiredRef.current = true;
      // Tiny haptic confirms the long-press fired even without UI
      // change (e.g. user is on /dashboard when they long-press).
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate?.(15); } catch { /* noop */ }
      }
      onLongPress();
    }, 500);
  };

  const handlePointerUp = () => {
    clearTimer();
    if (!longFiredRef.current) {
      onShortPress();
    }
  };

  const handlePointerCancel = () => {
    // Cancel = scroll started, finger moved out, pen lifted abnormally,
    // etc. Discard the gesture entirely so we don't fire either action.
    clearTimer();
    longFiredRef.current = false;
  };

  const handleClick = () => {
    // Pointer cycle already handled this gesture; swallow the synthetic
    // click that browsers fire after pointerup so the action doesn't
    // run twice. Reset the flag so a subsequent KEYBOARD activation
    // (where no pointer events fire) still goes through.
    if (pointerHandledRef.current) {
      pointerHandledRef.current = false;
      return;
    }
    onShortPress();
  };

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onClick={handleClick}
      data-glev-fab="true"
      aria-haspopup="dialog"
      aria-expanded={active}
      aria-label={recording ? `${label} — Aufnahme beenden` : label}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        // IDENTICAL flex layout to MobileTab on purpose — that's how the
        // "Glev" caption ends up on the exact same baseline as the
        // captions of the surrounding tabs. The lifted bubble is drawn
        // OUTSIDE the flex flow (position: absolute inside a normal
        // 22×22 icon slot) so it can overlap the nav top edge without
        // pushing the label around.
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 3, padding: "3px 2px", height: 44,
        border: "none", background: "transparent", cursor: "pointer",
        color: ACCENT,
        fontSize: 11, fontWeight: 600, letterSpacing: "0.005em",
        WebkitTapHighlightColor: "transparent",
        // The bubble protrudes above this button (overflowing the nav
        // top border by design, per 2026-05-17 user request). overflow
        // must stay visible — the parent <nav> already defaults to
        // overflow: visible too, so the bubble paints freely.
        overflow: "visible",
      }}
    >
      {/* Outer icon slot: 22×22 — positioning anchor for the Glev AI
          bubble. The GlevAIButton (64×64) is absolutely positioned and
          lifted so its centre lands on the nav top edge (½ above, ½
          below). pointer-events: none so the outer <button> handles
          all short/long-press interactions. */}
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22,
        }}
      >
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, calc(-50% - 17px))",
            pointerEvents: "none",
          }}
        >
          <GlevAIButton onPress={() => {}} isListening={recording} />
        </span>
      </span>
      <span
        style={{
          lineHeight: 1.1, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
        }}
      >{label}</span>
    </button>
  );
}

/**
 * Single button slot in the new 4-tab mobile bottom nav. Kept as a tiny
 * local component so each tab definition above stays a single readable
 * JSX block instead of being buried in a NAV.map() loop — the Glev FAB
 * doesn't fit the tab shape, so a simple map() no longer made sense.
 */
function MobileTab({
  label, active, onClick, icon, pending = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: (active: boolean) => React.ReactNode;
  /**
   * 2026-05-17 round 6: when the user has tapped this tab but the new
   * route hasn't finished streaming in yet, we visually treat the tab
   * as active AND overlay a small spinner on the icon — so on slow
   * iOS WKWebView transitions the tap doesn't look dead.
   */
  pending?: boolean;
}) {
  // Treat pending as visually active so the highlight lands the instant
  // the finger lifts, not after RSC streaming finishes.
  const visualActive = active || pending;

  // 2026-05-18 round 7 (TestFlight footer-tap loss fix):
  // Previously this tab fired navigation from `onClick` only. On iOS
  // WKWebView the synthesised click event would intermittently be lost:
  //   1. Right after a route swap: React re-mounts the entire nav row
  //      below new RSC output. The button DOM node the WebKit hit-test
  //      resolved at touchstart is no longer the node that receives the
  //      click — so the handler never runs, and the tap feels "dead".
  //   2. While a voice recording is active: VoiceRecordingProvider's
  //      capture-phase pointerdown listener calls setRecording(false)
  //      BEFORE the click bubbles. That synchronous state cascade
  //      tore down the engine page mid-dispatch and the click event
  //      was sometimes never delivered to this button at all.
  // Mirror the Glev FAB: act on `pointerup` directly (which fires before
  // the click is synthesized), with movement/cancel guards so a vertical
  // scroll gesture started on the nav doesn't accidentally navigate.
  // `onClick` is kept ONLY as a keyboard activation fallback (Enter /
  // Space — no pointer events fire for keyboard) and is gated by
  // `pointerHandledRef` so taps don't double-fire.
  const pointerHandledRef = useRef(false);
  const validRef = useRef(false);

  // 2026-05-18 round 8 (TestFlight "only Glev button works" fix):
  // The previous 10 px movement-slop guard was killing every footer
  // tap on iOS — fingers naturally drift a few pixels between
  // touchdown and touchup on small tab targets, which flipped
  // validRef=false in handlePointerMove. pointerup then bailed AND
  // the click fallback was blocked by pointerHandledRef. Dead tap.
  // The Glev FAB works precisely because it does NOT have this
  // guard. Mirror the FAB pattern exactly: pointerdown arms the
  // gesture, pointerup fires onClick unconditionally (iOS' native
  // scroll detection already cancels the pointer cycle via
  // pointercancel for actual swipes — no manual slop check needed).
  // 2026-05-18 round 10 (TestFlight: "knöpfe gehen schon wieder nicht
  // auf anhieb"): the previous version set pointerHandledRef = true in
  // pointerdown. When iOS WKWebView dropped the pointerup event (which
  // happens intermittently if React commits a re-render between
  // pointerdown and pointerup — the underlying DOM node changes
  // identity and the pointer cycle aborts WITHOUT firing pointercancel),
  // the synthesized click DID still fire on the new node — but
  // handleClick saw pointerHandledRef === true and bailed. Dead tap.
  // Fix: only mark pointerHandled in pointerup. If pointerup never
  // fires, handleClick falls through and navigates normally.
  // 2026-05-22 round 11 (dead-tap fix — small 38px target):
  // `setPointerCapture` routes ALL pointer events to this element even
  // if the pointer drifts outside the button boundary between down and
  // up. Without capture, `pointerLeave` fires as soon as the pointer
  // moves 1px outside, resets `validRef`, and then `pointerUp` fires
  // on a different element → dead tap. With capture, `pointerLeave`
  // only fires AFTER the pointer is released (capture cleared on
  // `pointerUp`/`pointerCancel`), so the gesture always completes.
  // `touchAction: "manipulation"` (already on the button) prevents the
  // capture from blocking native iOS scroll gestures.
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    validRef.current = true;
  };

  const handlePointerUp = () => {
    if (!validRef.current) return;
    validRef.current = false;
    pointerHandledRef.current = true;
    onClick();
  };

  const handlePointerCancel = () => {
    // Scroll started / finger lifted out / pen aborted — discard the
    // gesture so neither pointerup nor the click fallback fires.
    validRef.current = false;
    pointerHandledRef.current = false;
  };

  const handleClick = () => {
    // Pointer cycle already handled this gesture; swallow the synthetic
    // click that browsers fire after pointerup so navTo doesn't run
    // twice. Reset the flag so a subsequent KEYBOARD activation (where
    // no pointer events fire) still goes through.
    if (pointerHandledRef.current) {
      pointerHandledRef.current = false;
      return;
    }
    onClick();
  };

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onClick={handleClick}
      aria-current={active ? "page" : undefined}
      aria-busy={pending || undefined}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 3, padding: "3px 2px 0px 2px", height: 38,
        border: "none", background: "transparent", cursor: "pointer",
        color: visualActive ? ACCENT : NAV_INACTIVE,
        fontSize: 11, fontWeight: visualActive ? 600 : 500, letterSpacing: "0.005em",
        borderRadius: 10,
        transition: "color 0.15s",
        // Subtle scale-down on press for tactile feedback on iOS where
        // the WebkitTapHighlightColor is invisible against the dark nav.
        WebkitTapHighlightColor: "transparent",
        // 2026-05-18: `manipulation` disables iOS' 300ms double-tap-to-zoom
        // delay AND the browser's gesture-recognition wait, so the first
        // tap registers immediately even when the WKWebView main thread
        // is still settling after the previous route swap.
        touchAction: "manipulation",
      }}
    >
      <span style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 22, width: 22,
      }}>
        {icon(visualActive)}
        {pending ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", inset: -3,
              borderRadius: "50%",
              border: `2px solid ${ACCENT}33`,
              borderTopColor: ACCENT,
              animation: "glevTabSpin 0.7s linear infinite",
              pointerEvents: "none",
            }}
          />
        ) : null}
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
 * user is on /insights. Renders the four mode chips (Tag / Woche /
 * Monat / Jahr) INLINE — no dropdown, no extra tap to open. Picking a
 * mode resets the anchor to "now" so the user always lands on the
 * current period; date stepping (◀ Today ▶) is rendered separately by
 * the insights page itself at the top of the body. State lives in
 * `ScopeHeaderContext`; the page reads it for window math, this chip
 * group reads + writes for UI.
 *
 * 2026-05-18 (user request): "kann im insights screen nicht einfach
 * gleich im header diese chips gezeigt werden? das dropdown ist
 * unnötig" — replaced the previous closed-chip-+-popover pattern.
 */
function ScopeHeaderChip({
  mode, setMode, setAnchor,
}: {
  mode: ScopeMode;
  setMode: (m: ScopeMode) => void;
  setAnchor: (d: Date) => void;
}) {
  const t = useTranslations("scopeHeader");
  const ACCENT_HDR = "#4F6EF7";
  const modes: { key: ScopeMode; label: string }[] = [
    { key: "day",   label: t("mode_day")   },
    { key: "week",  label: t("mode_week")  },
    { key: "month", label: t("mode_month") },
    { key: "year",  label: t("mode_year")  },
  ];
  const total = modes.length;
  const activeIndex = modes.findIndex(m => m.key === mode);
  const segPct = 100 / total;

  return (
    <div
      role="radiogroup"
      aria-label={t("open_aria")}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        width: 148,
      }}
    >
      {/* Labels row — identical style to Engine wizard step labels */}
      <div style={{ display: "flex", width: "100%" }}>
        {modes.map((m, i) => {
          const isActive = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => { setMode(m.key); setAnchor(new Date()); }}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: isActive ? ACCENT_HDR : "var(--text-faint)",
                transition: "color 240ms ease",
                width: `${segPct}%`,
                textAlign: "center",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                touchAction: "manipulation",
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {/* Segmented track — identical to Engine wizard step indicator */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 2,
          background: "var(--border-soft)",
          borderRadius: 99,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${segPct}%`,
            background: ACCENT_HDR,
            borderRadius: 99,
            transform: `translateX(${activeIndex * 100}%)`,
            transition: "transform 240ms cubic-bezier(.2,.7,.2,1)",
            boxShadow: `0 0 6px ${ACCENT_HDR}88`,
          }}
        />
      </div>
    </div>
  );
}

