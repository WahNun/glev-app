"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/lib/auth";
import GlevLogo from "@/components/GlevLogo";
import GlevLockup from "@/components/GlevLockup";
import AboutGlevModal from "@/components/AboutGlevModal";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";
const BG      = "#09090B";

const NAV = [
  { label: "Dashboard", path: "/dashboard", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  )},
  { label: "Log", path: "/entries", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="12" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="18" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/></svg>
  )},
  { label: "Glev", path: "/engine", icon: (a: boolean) => (
    <GlevLogo size={20} color={a ? ACCENT : "rgba(255,255,255,0.55)"} bg="transparent"/>
  )},
  { label: "Insights", path: "/insights", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 4 12.8V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.2A7 7 0 0 1 12 2z"/><path d="M9 21h6"/><path d="M9 18h6"/></svg>
  )},
  { label: "Settings", path: "/settings", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  )},
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    fetch("/api/debug/state").then(r => r.json()).then(d => console.log("[DEBUG:STATE]", d)).catch(() => {});
  }, []);

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
          <div style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: `${GREEN}18`, color: GREEN, fontWeight: 600 }}>Live</div>
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
          {NAV.map(({ label, path, icon }) => {
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
                {label}
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

      <nav className="glev-mobile-nav" style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: SURFACE, borderTop: `1px solid ${BORDER}`,
        // Equal-share buttons across the full width — no extra side
        // padding so the 5 labels never collide with each other on
        // narrow phones (320–360 px).
        padding: "6px 4px max(12px, env(safe-area-inset-bottom))", zIndex: 100,
      }}>
        {NAV.map(({ label, path, icon }) => {
          const active = pathname.startsWith(path);
          // Each button claims an equal slice (`flex: 1 1 0` + `min-width: 0`)
          // so labels stay on one line and the active accent pill never spills
          // into its neighbour. Sentence-case + slightly larger 11 px text is
          // far more legible on mobile than the previous 9 px ALL-CAPS.
          return (
            <button
              key={path}
              onClick={() => router.push(path)}
              aria-current={active ? "page" : undefined}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 4, padding: "6px 2px", height: 56,
                border: "none", background: "transparent", cursor: "pointer",
                color: active ? ACCENT : "rgba(255,255,255,0.45)",
                fontSize: 11, fontWeight: active ? 600 : 500, letterSpacing: "0.01em",
                borderRadius: 10,
                transition: "color 0.15s",
              }}
            >
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 22, width: 22,
              }}>
                {icon(active)}
              </span>
              <span style={{
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
