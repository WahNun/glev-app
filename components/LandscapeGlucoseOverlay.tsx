"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCgmHistory, invalidateCgmCache } from "@/lib/cgm/clientCache";
import { parseLluTs as _parseLluTs } from "@/lib/time";
import {
  useCrosshair,
  CrosshairOverlay,
  CrosshairTooltip,
  type CrosshairPoint,
} from "@/components/ChartCrosshair";
import CgmFetchButton, { type CgmFetchResult } from "@/components/CgmFetchButton";

const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const SURFACE = "#09090B";
const DIM     = "#8b949e";
const FAINT   = "#5a6270";

function parseLluTs(s: string): number {
  return _parseLluTs(s) ?? Date.now();
}

function glucoseColor(v: number): string {
  if (v < 70)  return PINK;
  if (v > 180) return ORANGE;
  return GREEN;
}

function glucoseLineColor(v: number): string {
  const RED    = [0xef, 0x44, 0x44];
  const BLUE   = [0x3b, 0x82, 0xf6];
  const GREEN_ = [0x10, 0xb9, 0x81];
  const YELLOW = [0xea, 0xb3, 0x08];
  const ORANGE_= [0xf9, 0x73, 0x16];
  const lerp = (a: number[], b: number[], t: number) =>
    a.map((c, i) => Math.round(c + (b[i] - c) * Math.max(0, Math.min(1, t))));
  const hex = (rgb: number[]) =>
    `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  if (v < 55)  return hex(RED);
  if (v < 70)  return hex(lerp(RED, BLUE, (v - 55) / 15));
  if (v <= 180) return hex(GREEN_);
  if (v <= 250) return hex(lerp(YELLOW, ORANGE_, (v - 180) / 70));
  return hex(ORANGE_);
}

function formatAgo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1)   return "gerade eben";
  if (min === 1) return "vor 1 min";
  if (min < 60)  return `vor ${min} min`;
  const h = Math.round(min / 60);
  return h === 1 ? "vor 1 Std" : `vor ${h} Std`;
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

function TrendSvg({ direction, color, size = 30 }: { direction: "up" | "down" | "flat"; color: string; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (direction === "up") return <svg {...p}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="9 7 17 7 17 15" /></svg>;
  if (direction === "down") return <svg {...p}><line x1="7" y1="7" x2="17" y2="17" /><polyline points="9 17 17 17 17 9" /></svg>;
  return <svg {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="15 8 19 12 15 16" /></svg>;
}

type CgmPoint = { t: number; v: number };

type State =
  | { kind: "loading" }
  | { kind: "no-data" }
  | { kind: "ok"; current: CgmPoint; history: CgmPoint[]; trend: string };

export default function LandscapeGlucoseOverlay() {
  const [landscape, setLandscape] = useState(false);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [, setTick] = useState(0);

  useEffect(() => {
    function check() {
      const w = window.innerWidth;
      const h = window.innerHeight;
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

  const load = useCallback(async () => {
    try {
      const data = await fetchCgmHistory();
      if (!data) { setState({ kind: "no-data" }); return; }

      const now = Date.now();
      const cutoff = now - 24 * 60 * 60 * 1000;
      const history = (data.history ?? [])
        .filter((r) => r.value != null && r.timestamp)
        .map((r)  => ({ t: parseLluTs(r.timestamp!), v: r.value! }))
        .filter((r) => Number.isFinite(r.t) && r.t >= cutoff && r.t <= now)
        .sort((a, b) => a.t - b.t);

      const official = data.current?.value != null && data.current.timestamp
        ? { v: data.current.value, t: parseLluTs(data.current.timestamp) }
        : null;
      const newest = history.length ? history[history.length - 1] : null;
      const current =
        official && newest ? (newest.t > official.t ? newest : official)
        : (official ?? newest);

      if (!current) { setState({ kind: "no-data" }); return; }
      setState({ kind: "ok", current, history, trend: String(data.current?.trend ?? "") });
    } catch {
      setState({ kind: "no-data" });
    }
  }, []);

  useEffect(() => {
    if (!landscape) return;
    let cancelled = false;
    const go = async () => { if (!cancelled) await load(); };
    go();
    const poll = setInterval(go, 60_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [landscape, load]);

  useEffect(() => {
    if (!landscape) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [landscape]);

  const onRefresh = useCallback(async (r: CgmFetchResult) => {
    if (r.ok) { invalidateCgmCache(); await load(); }
  }, [load]);

  if (!landscape) return null;

  const ok      = state.kind === "ok";
  const current = ok ? state.current : null;
  const history = ok ? state.history : [];
  const trend   = ok ? parseTrend(state.trend) : "flat";
  const color   = current ? glucoseColor(current.v) : DIM;
  const now     = Date.now();

  // Chart height is fixed so the centered value stays at true 50% regardless.
  const CHART_H = 138;

  return (
    <div
      aria-label="Live-Glukose Querformat"
      style={{
        position:   "fixed",
        inset:      0,
        background: SURFACE,
        zIndex:     9999,
      }}
    >
      {/* ── Header — absolute top strip ───────────────────── */}
      <div style={{
        position:       "absolute",
        top:            0,
        left:           0,
        right:          0,
        padding:        "9px 18px 0",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: GREEN, textTransform: "uppercase" }}>
          GLUCOSE · LIVE
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {current && (
            <span style={{ fontSize: 11, color: DIM, fontFamily: "var(--font-mono, monospace)" }}>
              {formatAgo(now - current.t)}
            </span>
          )}
          <CgmFetchButton variant="ghost" onResult={onRefresh} title="Refresh CGM" />
        </div>
      </div>

      {/* ── Big value — truly centered on screen ──────────── */}
      <div style={{
        position:       "absolute",
        top:            "50%",
        left:           0,
        right:          0,
        transform:      "translateY(-50%)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        gap:            16,
      }}>
        {current ? (
          <>
            <span style={{
              fontSize:      96,
              fontWeight:    800,
              letterSpacing: "-0.04em",
              color,
              fontFamily:    "var(--font-mono, monospace)",
              lineHeight:    1,
            }}>
              {Math.round(current.v)}
            </span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
              <span style={{ fontSize: 14, color: DIM, fontWeight: 500 }}>mg/dL</span>
              <TrendSvg direction={trend} color={color} size={30} />
            </div>
          </>
        ) : state.kind === "loading" ? (
          <span style={{ color: FAINT, fontSize: 32, letterSpacing: "0.2em" }}>· · ·</span>
        ) : (
          <span style={{ color: FAINT, fontSize: 16 }}>Keine CGM-Daten</span>
        )}
      </div>

      {/* ── Rolling chart — absolute bottom strip ─────────── */}
      <div style={{
        position: "absolute",
        bottom:   0,
        left:     0,
        right:    0,
        height:   CHART_H,
        padding:  "0 18px 6px",
        boxSizing: "border-box",
      }}>
        {history.length > 0
          ? <LandscapeChart history={history} />
          : null
        }
      </div>
    </div>
  );
}

/* ─── LandscapeChart ──────────────────────────────────────────────────
   Same adaptive-window rolling chart as RollingChart in
   CurrentDayGlucoseCard, adapted for the dark full-screen overlay.
   Crosshair on touch: vertical + horizontal dashed lines, snapping
   dot, vibration feedback, floating tooltip. */

const RANGE_LOW  = 70;
const RANGE_HIGH = 180;
const Y_TICKS    = [70, 180, 250];

function LandscapeChart({ history }: { history: CgmPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 640, h: 160 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = size;
  const padL = 28, padR = 10, padT = 6, padB = 20;
  const now = Date.now();
  const MIN_WIN = 4  * 60 * 60 * 1000;
  const MAX_WIN = 14 * 60 * 60 * 1000;

  const winSpan = useMemo(() => {
    const all = history.filter((r) => r.t <= now && r.t >= now - MAX_WIN);
    if (!all.length) return MAX_WIN;
    const oldest = Math.min(...all.map((r) => r.t));
    return Math.max(MIN_WIN, Math.min(MAX_WIN, now - oldest + 30 * 60 * 1000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const winStart = now - winSpan;
  const visible  = useMemo(
    () => history.filter((r) => r.t >= winStart && r.t <= now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, winStart],
  );

  const yMin = 40, yMax = 300;
  const toX = (t: number) => padL + ((t - winStart) / (now - winStart)) * (W - padL - padR);
  const toY = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const xLabels: Array<{ t: number; label: string }> = useMemo(() => {
    const spanH = winSpan / 3_600 / 1_000;
    const h1 = Math.max(1, Math.round(spanH));
    const h2 = Math.max(1, Math.round((spanH * 2) / 3));
    const h3 = Math.max(1, Math.round(spanH / 3));
    return [
      { t: now - h1 * 3_600_000, label: `-${h1}h` },
      { t: now - h2 * 3_600_000, label: `-${h2}h` },
      { t: now - h3 * 3_600_000, label: `-${h3}h` },
      { t: now,                   label: "now"     },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winSpan]);

  const path = visible.map((r, i) => `${i === 0 ? "M" : "L"}${toX(r.t).toFixed(1)},${toY(r.v).toFixed(1)}`).join(" ");
  const lastPt = visible[visible.length - 1];
  const lastX  = lastPt ? toX(lastPt.t) : 0;
  const lastY  = lastPt ? toY(lastPt.v) : 0;
  const lastC  = lastPt ? glucoseLineColor(lastPt.v) : GREEN;

  const crosshairPoints = useMemo<CrosshairPoint[]>(() => {
    if (W <= 0 || H <= 0) return [];
    return visible.map((r) => ({
      x:       toX(r.t),
      y:       toY(r.v),
      color:   glucoseLineColor(r.v),
      tooltip: [
        new Date(r.t).toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", hour12: false }),
        `${Math.round(r.v)} mg/dL`,
      ],
    }));
  // toX/toY depend on W/H/winStart/now — visible + W + H covers all.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, W, H]);

  const { active, handlers } = useCrosshair(crosshairPoints);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative", touchAction: "pan-y" }}
      {...handlers}
    >
      {W > 0 && H > 0 && (
        <svg
          width={W} height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {/* In-range band */}
          <rect
            x={padL} y={toY(RANGE_HIGH)}
            width={W - padL - padR}
            height={toY(RANGE_LOW) - toY(RANGE_HIGH)}
            fill={GREEN} fillOpacity="0.07"
          />

          {/* Y-axis ticks */}
          {Y_TICKS.map((v) => (
            <text key={`y${v}`} x={padL - 5} y={toY(v) + 3} textAnchor="end" fontSize="9" fill={FAINT}>{v}</text>
          ))}

          {/* X-axis labels */}
          {xLabels.map((x) => (
            <text key={`x${x.label}`} x={toX(x.t)} y={H - 4} textAnchor="middle" fontSize="9" fill={FAINT}>{x.label}</text>
          ))}

          {/* Touch-revealed grid */}
          {active && (
            <g style={{ pointerEvents: "none" }}>
              {Y_TICKS.map((v) => (
                <line key={`gh${v}`} x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)}
                  stroke="#ffffff18" strokeDasharray="3 4" />
              ))}
              {Array.from({ length: 7 }, (_, i) => {
                const t = winStart + i * 2 * 3_600_000;
                return (
                  <line key={`gv${i}`} x1={toX(t)} y1={padT} x2={toX(t)} y2={H - padB}
                    stroke="#ffffff18" strokeWidth="1" strokeDasharray="2 4" />
                );
              })}
            </g>
          )}

          {/* Trace */}
          <path d={path} fill="none" stroke={lastC} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />

          {/* Last-point dot */}
          {lastPt && <circle cx={lastX} cy={lastY} r="4" fill={lastC} stroke={SURFACE} strokeWidth="1.5" />}

          {/* Crosshair overlay */}
          <CrosshairOverlay active={active} top={padT} bottom={H - padB} left={padL} right={W - padR} />
        </svg>
      )}
      <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
    </div>
  );
}
