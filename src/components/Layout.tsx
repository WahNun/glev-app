"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth";

const ACCENT = "#4F6EF7";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";
const BG = "#09090B";

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
];

const LOGO_NODES = [{cx:16,cy:7},{cx:25,cy:12},{cx:25,cy:20},{cx:18,cy:26},{cx:9,cy:22},{cx:7,cy:14},{cx:16,cy:16}];
const LOGO_EDGES = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6],[1,6],[2,6],[3,6]];

function LogoMark({ size = 30 }: { size?: number }) {
  const b = "#4F6EF7";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="9" fill="#0F0F14"/>
      {LOGO_EDGES.map(([a, b2], i) => (
        <line key={i} x1={LOGO_NODES[a].cx} y1={LOGO_NODES[a].cy} x2={LOGO_NODES[b2].cx} y2={LOGO_NODES[b2].cy} stroke={b} strokeWidth="0.9" strokeOpacity="0.55"/>
      ))}
      {LOGO_NODES.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={i === 6 ? 3.5 : 2} fill={i === 6 ? b : `${b}40`} stroke={b} strokeWidth={i === 6 ? 0 : 0.8}/>
      ))}
    </svg>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG }}>
      <style>{`
        .glev-sidebar { display: flex; }
        .glev-mobile-nav { display: none; }
        @media (max-width: 768px) {
          .glev-sidebar { display: none !important; }
          .glev-mobile-nav { display: flex !important; }
          .glev-main { padding: 16px 16px 80px !important; }
        }
      `}</style>

      <aside className="glev-sidebar" style={{
        width: 220, flexShrink: 0, background: SURFACE,
        borderRight: `1px solid ${BORDER}`, flexDirection: "column",
        padding: "20px 12px", position: "sticky", top: 0, height: "100vh",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 28 }}>
          <LogoMark size={32} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>Glev</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>INSULIN SUPPORT</div>
          </div>
        </div>

        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map(({ label, path, icon }) => {
            const active = pathname.startsWith(path);
            return (
              <button key={path} onClick={() => router.push(path)} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                background: active ? `${ACCENT}18` : "transparent",
                color: active ? ACCENT : "rgba(255,255,255,0.5)",
                fontSize: 13, fontWeight: active ? 600 : 400,
                textAlign: "left", width: "100%", transition: "all 0.15s",
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
          color: "rgba(255,255,255,0.2)", fontSize: 12, textAlign: "left", width: "100%",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </aside>

      <main className="glev-main" style={{ flex: 1, padding: "24px 28px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        {children}
      </main>

      <nav className="glev-mobile-nav" style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: SURFACE, borderTop: `1px solid ${BORDER}`,
        justifyContent: "space-around", alignItems: "center",
        padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 100,
      }}>
        {NAV.map(({ label, path, icon }) => {
          const active = pathname.startsWith(path);
          return (
            <button key={path} onClick={() => router.push(path)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "4px 12px", border: "none", background: "transparent", cursor: "pointer",
              color: active ? ACCENT : "rgba(255,255,255,0.3)", fontSize: 9,
            }}>
              {icon(active)}
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
