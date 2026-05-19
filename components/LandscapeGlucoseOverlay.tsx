"use client";

import { useEffect, useState } from "react";

const HYPO  = 70;
const HYPER = 180;
const GREEN  = "#22D3A0";
const ORANGE = "#FF9500";
const PINK   = "#FF2D78";
const DIM    = "#5a6270";
const MUTED  = "#8b949e";

function glucoseColor(v: number): string {
  if (v < HYPO)  return PINK;
  if (v > HYPER) return ORANGE;
  return GREEN;
}

function parseTrend(trend: string | number | undefined): "up" | "down" | "flat" {
  if (trend == null) return "flat";
  const s = String(trend).toLowerCase();
  if (s === "2" || s === "3" || s === "4"
    || s.includes("up") || s.includes("rising") || s.includes("rais")) return "up";
  if (s === "6" || s === "7" || s === "8"
    || s.includes("down") || s.includes("falling") || s.includes("drop")) return "down";
  return "flat";
}

function formatAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.round(diff / 60_000);
    if (min < 1)  return "gerade eben";
    if (min === 1) return "vor 1 min";
    if (min < 60)  return `vor ${min} min`;
    const h = Math.round(min / 60);
    return h === 1 ? "vor 1 Std" : `vor ${h} Std`;
  } catch {
    return "";
  }
}

function TrendSvg({
  direction,
  color,
  size = 36,
}: {
  direction: "up" | "down" | "flat";
  color: string;
  size?: number;
}) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: 2.5,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  if (direction === "up") return (
    <svg {...p}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="9 7 17 7 17 15" />
    </svg>
  );
  if (direction === "down") return (
    <svg {...p}>
      <line x1="7" y1="7" x2="17" y2="17" />
      <polyline points="9 17 17 17 17 9" />
    </svg>
  );
  return (
    <svg {...p}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="15 8 19 12 15 16" />
    </svg>
  );
}

type Cgm = { value: number; unit: string; timestamp: string; trend: string };

export default function LandscapeGlucoseOverlay() {
  const [landscape, setLandscape] = useState(false);
  const [cgm,       setCgm]       = useState<Cgm | null>(null);
  const [noData,    setNoData]    = useState(false);
  // Tick every 30 s so the "vor X min" label stays current without re-fetching.
  const [, setTick] = useState(0);

  useEffect(() => {
    function check() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Only intercept on phone-sized landscape (height ≤ 500 px).
      // Desktop landscape (tall viewports) is left as-is.
      setLandscape(w > h && h <= 500);
    }
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  useEffect(() => {
    if (!landscape) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/cgm/latest", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const c = j?.current;
        if (c?.value != null) {
          setCgm({
            value: Math.round(Number(c.value)),
            unit: c.unit ?? "mg/dL",
            timestamp: c.timestamp ?? "",
            trend: String(c.trend ?? ""),
          });
          setNoData(false);
        } else {
          setNoData(true);
        }
      } catch {
        if (!cancelled) setNoData(true);
      }
    }
    load();
    const poll = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [landscape]);

  // Refresh the "vor X min" label every 30 s.
  useEffect(() => {
    if (!landscape) return;
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [landscape]);

  if (!landscape) return null;

  const color     = cgm ? glucoseColor(cgm.value) : MUTED;
  const direction = parseTrend(cgm?.trend);
  const ago       = cgm?.timestamp ? formatAgo(cgm.timestamp) : "";

  return (
    <div
      aria-label="Live-Glukose Querformat"
      style={{
        position:       "fixed",
        inset:          0,
        background:     "#09090B",
        zIndex:         9999,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            8,
      }}
    >
      {cgm ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span
              style={{
                fontSize:      96,
                fontWeight:    700,
                color,
                fontFamily:    "var(--font-mono, monospace)",
                lineHeight:    1,
                letterSpacing: "-0.04em",
              }}
            >
              {cgm.value}
            </span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <span style={{ fontSize: 15, color: MUTED, fontWeight: 500 }}>{cgm.unit}</span>
              <TrendSvg direction={direction} color={color} size={34} />
            </div>
          </div>

          {ago ? (
            <span style={{ fontSize: 13, color: DIM, letterSpacing: "0.01em" }}>{ago}</span>
          ) : null}
        </>
      ) : noData ? (
        <span style={{ color: DIM, fontSize: 15 }}>Keine CGM-Daten</span>
      ) : (
        <span style={{ color: DIM, fontSize: 22 }}>·&thinsp;·&thinsp;·</span>
      )}
    </div>
  );
}
