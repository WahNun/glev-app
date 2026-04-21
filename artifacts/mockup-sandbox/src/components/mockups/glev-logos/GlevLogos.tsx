import React from "react";

// ─── Colors ──────────────────────────────────────────────────────────────────
const BLUE = "#4F6EF7";
const PINK = "#FF2D78";
const GREEN = "#22D3A0";
const DARK = "#09090B";

// ─── Logo Mark Components ────────────────────────────────────────────────────

/** A · Minimal Tech — geometric "G" slab */
function LogoA({ size = 32 }: { size?: number }) {
  const r = size * 0.16;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="9" fill={BLUE} />
      <text x="16" y="23" textAnchor="middle" fontFamily="'Inter',sans-serif" fontWeight="800" fontSize="18" fill="white">G</text>
    </svg>
  );
}

/** B · Health Precision — ECG pulse inside rounded rect */
function LogoB({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="10" fill={DARK} />
      <rect width="32" height="32" rx="10" fill={`url(#lgB${size})`} />
      <defs>
        <linearGradient id={`lgB${size}`} x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor={BLUE} />
          <stop offset="100%" stopColor={PINK} />
        </linearGradient>
      </defs>
      <polyline
        points="4,16 8,16 10,10 12,22 14,13 16,19 18,16 28,16"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** C · Modern AI — neural / connected-dots "G" */
function LogoC({ size = 32 }: { size?: number }) {
  const nodes = [
    { cx: 16, cy: 7 },
    { cx: 25, cy: 12 },
    { cx: 25, cy: 20 },
    { cx: 18, cy: 26 },
    { cx: 9, cy: 22 },
    { cx: 7, cy: 14 },
    { cx: 19, cy: 17 },
  ];
  const edges = [
    [0, 1],[1, 2],[2, 3],[3, 4],[4, 5],[5, 0],[0, 6],[1, 6],[2, 6],[3, 6],
  ];
  const scale = size / 32;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="10" fill="#0F0F14" />
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].cx} y1={nodes[a].cy}
          x2={nodes[b].cx} y2={nodes[b].cy}
          stroke={BLUE} strokeWidth="0.8" strokeOpacity="0.5"
        />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.cx} cy={n.cy} r={i === 6 ? 3.5 : 2}
          fill={i === 6 ? BLUE : "#4F6EF740"}
          stroke={BLUE} strokeWidth="0.8" />
      ))}
    </svg>
  );
}

// ─── Context renderers ───────────────────────────────────────────────────────

type LogoProps = { size?: number };

const LOGOS: {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  bg: string;
  textColor: string;
  mutedColor: string;
  Mark: React.FC<LogoProps>;
}[] = [
  {
    id: "A",
    name: "Minimal Tech",
    tagline: "Clean geometry — inspired by Revolut & Linear",
    accent: BLUE,
    bg: "#FFFFFF",
    textColor: "#09090B",
    mutedColor: "#666",
    Mark: LogoA,
  },
  {
    id: "B",
    name: "Health Precision",
    tagline: "ECG pulse — medical authority, Apple-clean",
    accent: PINK,
    bg: "#FFFFFF",
    textColor: "#09090B",
    mutedColor: "#666",
    Mark: LogoB,
  },
  {
    id: "C",
    name: "Modern AI",
    tagline: "Neural graph — intelligent, adaptive, future-first",
    accent: GREEN,
    bg: "#FFFFFF",
    textColor: "#09090B",
    mutedColor: "#666",
    Mark: LogoC,
  },
];

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
      <span style={{ fontSize: 10, color: "#9CA3AF", letterSpacing: "0.1em", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
    </div>
  );
}

function MobileHeader({ logo }: { logo: typeof LOGOS[0] }) {
  const { Mark, textColor, mutedColor, bg } = logo;
  return (
    <div style={{
      width: 320, borderRadius: 14, overflow: "hidden",
      boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
      border: "1px solid #E5E7EB",
    }}>
      <div style={{
        background: bg, padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #F3F4F6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mark size={30} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: textColor, letterSpacing: "-0.02em", lineHeight: 1 }}>Glev</div>
            <div style={{ fontSize: 9, color: mutedColor, marginTop: 1 }}>Smart insulin decisions</div>
          </div>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: 99, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⋯</div>
      </div>
      <div style={{ background: "#FAFAFA", padding: "12px 16px", fontSize: 12, color: "#6B7280" }}>
        Dashboard · Wednesday April 21
      </div>
    </div>
  );
}

function DashboardTopbar({ logo }: { logo: typeof LOGOS[0] }) {
  const { Mark, accent, textColor, mutedColor, bg } = logo;
  return (
    <div style={{
      width: 600, borderRadius: 14, overflow: "hidden",
      boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
      border: "1px solid #E5E7EB",
    }}>
      <div style={{
        background: bg, padding: "16px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #F3F4F6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mark size={36} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: textColor, letterSpacing: "-0.03em", lineHeight: 1 }}>Glev</div>
            <div style={{ fontSize: 10, color: mutedColor, marginTop: 2 }}>Smart insulin decisions</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 11, color: mutedColor, padding: "6px 14px", borderRadius: 8, background: "#F3F4F6" }}>Dashboard</div>
          <div style={{ fontSize: 11, color: mutedColor, padding: "6px 14px", borderRadius: 8 }}>Quick Log</div>
          <div style={{ fontSize: 11, color: "white", padding: "6px 14px", borderRadius: 8, background: accent, fontWeight: 600 }}>+ Log</div>
        </div>
      </div>
      <div style={{ background: "#FAFAFA", padding: "10px 22px", fontSize: 11, color: "#9CA3AF" }}>
        Control Score: <strong style={{ color: textColor }}>78%</strong> · Time in Range: <strong style={{ color: textColor }}>62%</strong> · Entries: 32
      </div>
    </div>
  );
}

function SplashScreen({ logo }: { logo: typeof LOGOS[0] }) {
  const { Mark, accent, bg } = logo;
  const isDark = logo.id === "C";
  const splashBg = isDark
    ? "#0F0F14"
    : `linear-gradient(135deg, ${BLUE}10 0%, ${accent}08 100%)`;
  const textCol = isDark ? "#FFFFFF" : "#09090B";
  const mutedCol = isDark ? "rgba(255,255,255,0.4)" : "#6B7280";
  return (
    <div style={{
      width: 220, height: 320, borderRadius: 24, overflow: "hidden",
      background: splashBg,
      boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E5E7EB"}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 14,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 22, overflow: "hidden",
        boxShadow: `0 4px 24px ${accent}40`,
      }}>
        <Mark size={72} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: textCol, letterSpacing: "-0.04em", lineHeight: 1 }}>Glev</div>
        <div style={{ fontSize: 11, color: mutedCol, marginTop: 5, letterSpacing: "0.01em" }}>Smart insulin decisions</div>
      </div>
      <div style={{
        marginTop: 8, padding: "10px 28px",
        background: accent, borderRadius: 50, fontSize: 13, fontWeight: 600,
        color: "white", letterSpacing: "0.01em",
        boxShadow: `0 4px 16px ${accent}40`,
      }}>
        Get Started
      </div>
    </div>
  );
}

// ─── Column ─────────────────────────────────────────────────────────────────

function LogoColumn({ logo }: { logo: typeof LOGOS[0] }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0,
      padding: "28px 32px",
      background: "white",
      borderRadius: 20,
      border: "1px solid #E5E7EB",
      width: 660,
      boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <logo.Mark size={44} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#09090B", letterSpacing: "-0.03em" }}>
            {logo.id} — {logo.name}
          </div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{logo.tagline}</div>
        </div>
      </div>

      <Divider label="MOBILE HEADER" />
      <MobileHeader logo={logo} />

      <Divider label="DASHBOARD TOP BAR" />
      <DashboardTopbar logo={logo} />

      <Divider label="SPLASH SCREEN" />
      <SplashScreen logo={logo} />
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function GlevLogos() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#F8F9FA",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      padding: "40px 32px",
    }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#09090B", margin: 0, letterSpacing: "-0.04em" }}>
          Glev — Logo Concepts
        </h1>
        <p style={{ fontSize: 14, color: "#6B7280", marginTop: 6 }}>
          3 design directions · each shown in mobile header, dashboard top bar, and splash screen
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {LOGOS.map((logo) => (
          <LogoColumn key={logo.id} logo={logo} />
        ))}
      </div>
    </div>
  );
}
