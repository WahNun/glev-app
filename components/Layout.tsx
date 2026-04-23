"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { signOut } from "@/lib/auth";
import GlevLogo from "@/components/GlevLogo";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";
const BG      = "#09090B";

const NAV = [
  { label: "Dashboard", path: "/dashboard", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  )},
  { label: "Log Meal", path: "/log", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
  )},
  { label: "Entry Log", path: "/entries", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="12" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="18" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/></svg>
  )},
  { label: "Insights", path: "/insights", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 1 4 12.8V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.2A7 7 0 0 1 12 2z"/><path d="M9 21h6"/><path d="M9 18h6"/></svg>
  )},
  { label: "Glev Engine", path: "/engine", icon: (a: boolean) => (
    <GlevLogo size={20} color={a ? ACCENT : "rgba(255,255,255,0.55)"} bg="transparent"/>
  )},
  { label: "Import", path: "/import", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  )},
  { label: "Account", path: "/settings", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
  )},
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();

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
          .glev-main        { padding: 72px 16px 110px !important; }
        }
        .nav-btn { transition: background 0.15s, color 0.15s; }
        .nav-btn:hover { background: rgba(79,110,247,0.08) !important; }
        @keyframes glevMicPulse {
          0%,100% { box-shadow: 0 0 20px ${ACCENT}55; }
          50%     { box-shadow: 0 0 32px ${ACCENT}88, 0 0 60px ${ACCENT}33; }
        }
      `}</style>

      {/* MOBILE HEADER */}
      <header className="glev-mobile-head" onClick={() => router.push("/settings")} style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 99,
        padding: "14px 18px 12px",
        background: pathname.startsWith("/settings") ? "rgba(79,110,247,0.08)" : SURFACE,
        borderBottom: `1px solid ${pathname.startsWith("/settings") ? "rgba(79,110,247,0.25)" : BORDER}`,
        alignItems: "center", justifyContent: "space-between", cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GlevLogo size={30} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>Glev</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>Smart insulin decisions</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: `${GREEN}18`, color: GREEN, fontWeight: 600 }}>Live</div>
          <div style={{ width: 32, height: 32, borderRadius: 99, background: pathname.startsWith("/settings") ? `${ACCENT}25` : "rgba(255,255,255,0.05)", border: `1px solid ${pathname.startsWith("/settings") ? ACCENT : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={pathname.startsWith("/settings") ? ACCENT : "rgba(255,255,255,0.6)"} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          </div>
        </div>
      </header>

      <aside className="glev-sidebar" style={{
        width: 224, flexShrink: 0, background: SURFACE,
        borderRight: `1px solid ${BORDER}`, flexDirection: "column",
        padding: "20px 12px", position: "sticky", top: 0, height: "100vh",
        overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", marginBottom: 28 }}>
          <GlevLogo size={32} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.03em", color: "#fff" }}>Glev</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Smart Insulin</div>
          </div>
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
        justifyContent: "space-around", alignItems: "center",
        padding: "10px 24px max(20px, env(safe-area-inset-bottom))", zIndex: 100,
      }}>
        {[NAV[0], NAV[3], NAV[2], NAV[4]].map(({ label, path, icon }) => {
          const active = pathname.startsWith(path);
          return (
            <button key={path} onClick={() => router.push(path)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              padding: "4px 8px", border: "none", background: "transparent", cursor: "pointer",
              color: active ? ACCENT : "rgba(255,255,255,0.3)",
              fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
            }}>
              {icon(active)}
              <span>{(label === "Glev Engine" ? "Engine" : label).toUpperCase()}</span>
            </button>
          );
        })}
        {/* Floating LOG mic — overlaps the right side of the nav bar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginTop: -20 }}>
          <button onClick={() => router.push("/log")} style={{
            width: 56, height: 56, borderRadius: 99,
            background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "glevMicPulse 2.5s ease-in-out infinite",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="11" rx="3" fill="rgba(255,255,255,0.95)"/>
              <path d="M5 10a7 7 0 0 0 14 0" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
              <line x1="12" y1="19" x2="12" y2="22" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="9" y1="22" x2="15" y2="22" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          <span style={{ fontSize: 9, color: pathname.startsWith("/log") ? ACCENT : "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.04em" }}>LOG</span>
        </div>
      </nav>
    </div>
  );
}
