"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";

const ACCENT  = "#4F6EF7";
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
  { label: "Entries", path: "/entries", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="12" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/><circle cx="4" cy="18" r="1.5" fill={a ? ACCENT : "rgba(255,255,255,0.4)"}/></svg>
  )},
  { label: "Insights", path: "/insights", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  )},
  { label: "Glev Engine", path: "/engine", icon: (a: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a ? ACCENT : "rgba(255,255,255,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
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

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG }}>
      <style>{`
        .glev-sidebar    { display: flex; }
        .glev-mobile-nav { display: none !important; }
        .glev-mobile-fab { display: none !important; }
        @media (max-width: 768px) {
          .glev-sidebar    { display: none !important; }
          .glev-mobile-nav { display: flex !important; }
          .glev-mobile-fab { display: flex !important; }
          .glev-main       { padding: 16px 16px 90px !important; }
        }
        .nav-btn { transition: background 0.15s, color 0.15s; }
        .nav-btn:hover { background: rgba(79,110,247,0.08) !important; }
      `}</style>

      <aside className="glev-sidebar" style={{
        width: 224, flexShrink: 0, background: SURFACE,
        borderRight: `1px solid ${BORDER}`, flexDirection: "column",
        padding: "20px 12px", position: "sticky", top: 0, height: "100vh",
        overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 10px", marginBottom: 28 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, background: `${ACCENT}20`,
            border: `1px solid ${ACCENT}40`, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
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
        padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100,
      }}>
        {NAV.slice(0, 5).map(({ label, path, icon }) => {
          const active = pathname.startsWith(path);
          return (
            <button key={path} onClick={() => router.push(path)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "4px 8px", border: "none", background: "transparent", cursor: "pointer",
              color: active ? ACCENT : "rgba(255,255,255,0.3)", fontSize: 9, fontWeight: active ? 600 : 400,
            }}>
              {icon(active)}
              <span>{label === "Log Meal" ? "Log" : label}</span>
            </button>
          );
        })}
      </nav>

      {!pathname.startsWith("/log") && (
        <button className="glev-mobile-fab" onClick={() => router.push("/log")} style={{
          position: "fixed", right: 20, bottom: 76, zIndex: 200,
          width: 52, height: 52, borderRadius: 99,
          background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          border: "none", cursor: "pointer", boxShadow: `0 4px 20px ${ACCENT}60`,
          alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      )}
    </div>
  );
}
