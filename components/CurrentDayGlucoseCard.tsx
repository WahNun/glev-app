"use client";
import { fetchCgmHistory } from "@/lib/cgm/clientCache";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import CgmFetchButton, { type CgmFetchResult } from "@/components/CgmFetchButton";
import { useCrosshair, CrosshairOverlay, CrosshairTooltip, type CrosshairPoint } from "@/components/ChartCrosshair";
import { parseLluTs as _parseLluTs } from "@/lib/time";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.08)";

const RANGE_LOW = 70;
const RANGE_HIGH = 180;

type Reading = { value: number | null; unit: string; timestamp: string | null; trend: string };

type State =
  | { kind: "loading" }
  | { kind: "no-cgm" }
  | { kind: "error"; msg: string }
  | { kind: "ok"; readings: Array<{ t: number; v: number }>; current: { v: number; t: number } | null };

// The chart fills the remaining space inside the card via the DayChart's
// own ResizeObserver, so the card height directly controls how much room
// the trace gets. Numbers chosen to give a generous chart area on both
// viewports without crowding the dashboard grid.
const CARD_STYLE_TAG = `
  .glev-today-card { height: 320px; }
  @media (max-width: 768px) {
    .glev-today-card { height: 300px; }
  }
`;

export default function CurrentDayGlucoseCard() {
  const [s, setS] = useState<State>({ kind: "loading" });
  const [flipped, setFlipped] = useState(false);

  const loadHistory = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const data = await fetchCgmHistory();
      if (!data) throw new Error("CGM unavailable");
      const today0 = new Date();
      today0.setHours(0, 0, 0, 0);
      const todayStart = today0.getTime();
      const now = Date.now();

      const all = (data.history || [])
        .filter((r) => r.value != null && r.timestamp)
        .map((r) => ({ t: parseLluTs(r.timestamp!), v: r.value! }))
        .filter((r) => r.t >= todayStart && r.t <= now)
        .sort((a, b) => a.t - b.t);

      const cur = data.current && data.current.value != null && data.current.timestamp
        ? { v: data.current.value, t: parseLluTs(data.current.timestamp) }
        : (all.length ? { v: all[all.length - 1].v, t: all[all.length - 1].t } : null);

      if (!signal?.cancelled) setS({ kind: "ok", readings: all, current: cur });
    } catch (e) {
      if (!signal?.cancelled) setS({ kind: "error", msg: e instanceof Error ? e.message : "fetch failed" });
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    loadHistory(signal);
    return () => { signal.cancelled = true; };
  }, [loadHistory]);

  // Refresh full daily history after the user pulls a new latest reading.
  const onCgmRefresh = useCallback((r: CgmFetchResult) => {
    if (r.ok) loadHistory();
  }, [loadHistory]);

  return (
    <div
      onClick={() => s.kind === "ok" && setFlipped((f) => !f)}
      className="glev-today-card"
      style={{
        position: "relative",
        cursor: s.kind === "ok" ? "pointer" : "default",
        perspective: 1200,
      }}
    >
      <style>{CARD_STYLE_TAG}</style>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* FRONT — hero glucose tile, mirroring the landing-page mockup
            (`AppMockupPhone.tsx` ~line 282 "Live glucose hero") 1:1:
            "GLUCOSE · LIVE" pill (GREEN, uppercase) + "Xm ago" timestamp,
            big mono value + mg/dL + trend arrow with 15-min delta,
            rolling 2-hour sparkline filling the remaining height. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            background: `linear-gradient(135deg, ${ACCENT}10, ${SURFACE})`,
            border: `1px solid ${ACCENT}30`,
            borderRadius: 16,
            padding: "16px 18px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflow: "hidden",
          }}
        >
          <HeroFront state={s} onCgmRefresh={onCgmRefresh} flippable={s.kind === "ok"} />
        </div>

        {/* BACK */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: `linear-gradient(145deg, ${ACCENT}10, ${SURFACE} 65%)`,
            border: `1px solid ${ACCENT}33`,
            borderRadius: 16,
            padding: "18px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "hidden",
          }}
        >
          {s.kind === "ok" && <BackStats readings={s.readings} />}
        </div>
      </div>
    </div>
  );
}

/* HeroFront — replaces the old Header. Renders the entire FRONT card
   contents for every state of `s` (loading / no-cgm / error / ok).
   Visual reference: `AppMockupPhone.tsx` "Live glucose hero" tile.

   Layout (ok state):
     ┌──────────────────────────────────────────────┐
     │ GLUCOSE · LIVE          1m ago [Refresh] ↺  │
     │ 142  mg/dL                       ↗ +8 / 15m │
     │ ┌──────────────────────────────────────────┐ │
     │ │  rolling 2h sparkline (RollingChart)      │ │
     │ └──────────────────────────────────────────┘ │
     │ −2h          −1h                  now        │
     └──────────────────────────────────────────────┘ */
function HeroFront({
  state, onCgmRefresh, flippable,
}: {
  state: State;
  onCgmRefresh: (r: CgmFetchResult) => void;
  flippable: boolean;
}) {
  const ok = state.kind === "ok";
  const current = ok ? state.current : null;
  const readings = ok ? state.readings : [];
  const valueColor = current ? colorFor(current.v) : "rgba(255,255,255,0.5)";
  const ageLabel = current ? formatAge(Date.now() - current.t) : null;
  const delta = useMemo(
    () => computeDelta15m(readings, current),
    [readings, current],
  );

  return (
    <>
      {/* Header row — uppercase pill label LEFT, age + refresh + flip RIGHT */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.12em",
          color: GREEN, textTransform: "uppercase",
        }}>
          GLUCOSE · LIVE
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ageLabel && (
            <span style={{
              fontSize: 10, color: "rgba(255,255,255,0.4)",
              fontFamily: "var(--font-mono)",
            }}>
              {ageLabel}
            </span>
          )}
          {(ok || state.kind === "error") && (
            <CgmFetchButton size="sm" label="Refresh" onResult={onCgmRefresh} />
          )}
          {flippable && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>↺</span>
          )}
        </div>
      </div>

      {/* Value + trend row — only when we have a current reading */}
      {ok && current ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{
            fontSize: 48, fontWeight: 800, letterSpacing: "-0.04em",
            color: valueColor, fontFamily: "var(--font-mono)", lineHeight: 1,
          }}>
            {Math.round(current.v)}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>mg/dL</span>
          {delta && (
            <span style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
              color: valueColor, fontSize: 11, fontWeight: 600,
            }}>
              <TrendArrow direction={delta.direction} color={valueColor} />
              {delta.label}
            </span>
          )}
        </div>
      ) : (
        <div style={{
          minHeight: 48, display: "flex", alignItems: "center",
          color: "rgba(255,255,255,0.45)", fontSize: 12,
        }}>
          {state.kind === "loading" ? "Loading CGM data…"
            : state.kind === "no-cgm" ? "Connect a CGM in Settings to see live glucose."
            : state.kind === "error" ? `CGM error: ${state.msg}`
            : "No readings yet today"}
        </div>
      )}

      {/* Chart fills remaining card height */}
      {ok && readings.length > 0 ? (
        <RollingChart readings={readings} />
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </>
  );
}

/* Trend arrow icon — three flavours (NE up, SE down, →flat) matching
   the hero mockup's stroke style. Color is passed in so it tracks the
   current value's range color (GREEN / ORANGE / PINK). */
function TrendArrow({ direction, color }: { direction: "up" | "down" | "flat"; color: string }) {
  const common = {
    width: 14, height: 14, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: 2.5,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  if (direction === "up") {
    return (
      <svg {...common}>
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="9 7 17 7 17 15" />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg {...common}>
        <line x1="7" y1="7" x2="17" y2="17" />
        <polyline points="9 17 17 17 17 9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="15 8 19 12 15 16" />
    </svg>
  );
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

/* Compute the delta in mg/dL between the current reading and the reading
   closest to (current.t − 15min). Requires ≥5min of separation so a brief
   gap doesn't yield a misleading "±0" trend. Returns null if there is no
   suitable historical reading. */
function computeDelta15m(
  readings: Array<{ t: number; v: number }>,
  current: { v: number; t: number } | null,
): { label: string; direction: "up" | "down" | "flat" } | null {
  if (!current || readings.length < 2) return null;
  const target = current.t - 15 * 60 * 1000;
  let best: { t: number; v: number } | null = null;
  let bestDist = Infinity;
  for (const r of readings) {
    if (r.t > current.t) continue;
    const d = Math.abs(r.t - target);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  if (!best || current.t - best.t < 5 * 60 * 1000) return null;
  const delta = Math.round(current.v - best.v);
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const direction: "up" | "down" | "flat" = delta > 2 ? "up" : delta < -2 ? "down" : "flat";
  return { label: `${sign}${Math.abs(delta)} / 15m`, direction };
}

/* RollingChart — last 2 hours of readings on a (now−2h) → now domain.
   Filters the full-day `readings` array to the visible window; the data
   hook itself (`loadHistory` in the parent) is unchanged. X-axis labels
   are "−2h", "−1h", "now" per the hero spec. Line + last-point color
   tracks `colorFor(last)` so out-of-range periods read at a glance. */
function RollingChart({ readings }: { readings: Array<{ t: number; v: number }> }) {
  // Measure the container so the SVG always renders in true pixel space.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 200 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = size.w;
  const H = size.h;
  const padL = 28;
  const padR = 10;
  const padT = 8;
  const padB = 22;

  // Rolling 2-hour window ending at now. Source readings come from the
  // parent which loads the full day; we just slice client-side here.
  const now = Date.now();
  const winStart = now - 2 * 3600 * 1000;
  const visible = useMemo(
    () => readings.filter((r) => r.t >= winStart && r.t <= now),
    [readings, winStart, now],
  );

  const yMin = 40;
  const yMax = 300;
  const toX = (t: number) => padL + ((t - winStart) / (now - winStart)) * (W - padL - padR);
  const toY = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const yTicks = [70, 110, 180, 250];
  const xLabels: Array<{ t: number; label: string }> = [
    { t: winStart,                  label: "−2h" },
    { t: winStart + 3600 * 1000,    label: "−1h" },
    { t: now,                       label: "now"  },
  ];

  const path = visible.map((r, i) => `${i === 0 ? "M" : "L"}${toX(r.t).toFixed(1)},${toY(r.v).toFixed(1)}`).join(" ");
  const last = visible[visible.length - 1];
  const lastX = last ? toX(last.t) : 0;
  const lastY = last ? toY(last.v) : 0;
  const lastC = last ? colorFor(last.v) : ACCENT;

  // Crosshair-snappable points (pixel space).
  const crosshairPoints = useMemo<CrosshairPoint[]>(() => {
    if (W <= 0 || H <= 0) return [];
    return visible.map((r) => {
      const fmtTime = new Date(r.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
      return {
        x: toX(r.t),
        y: toY(r.v),
        color: colorFor(r.v),
        tooltip: [fmtTime, `${Math.round(r.v)} mg/dL`],
      };
    });
    // toX/toY depend on W/H/winStart/now; visible + W + H captures it all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, W, H]);

  const { active, handlers } = useCrosshair(crosshairPoints);

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        // Stop the parent card from flipping while the user is interacting
        // with the crosshair.
        e.stopPropagation();
      }}
      style={{ flex: 1, minHeight: 0, position: "relative", touchAction: "pan-y" }}
      {...handlers}
    >
      {W > 0 && H > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ display: "block", position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {/* In-range band */}
          <rect
            x={padL} y={toY(RANGE_HIGH)}
            width={W - padL - padR}
            height={toY(RANGE_LOW) - toY(RANGE_HIGH)}
            fill={GREEN} fillOpacity="0.06"
          />
          {/* Y grid + labels (70 / 110 / 180 / 250) */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 4" />
              <text x={padL - 5} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.25)">{v}</text>
            </g>
          ))}
          {/* X markers + labels (−2h / −1h / now) */}
          {xLabels.map((x) => (
            <g key={x.label}>
              <line x1={toX(x.t)} y1={padT} x2={toX(x.t)} y2={H - padB} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={toX(x.t)} y={H - 6} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.3)">{x.label}</text>
            </g>
          ))}
          {/* Trace */}
          <path d={path} fill="none" stroke={lastC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Last point */}
          {last && <circle cx={lastX} cy={lastY} r="4" fill={lastC} stroke={SURFACE} strokeWidth="1.5" />}
          {/* Crosshair */}
          <CrosshairOverlay
            active={active}
            top={padT}
            bottom={H - padB}
            left={padL}
            right={W - padR}
          />
        </svg>
      )}
      <CrosshairTooltip active={active} containerWidth={W} containerHeight={H} />
    </div>
  );
}

function BackStats({ readings }: { readings: Array<{ t: number; v: number }> }) {
  if (readings.length === 0) {
    return <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>No readings yet today.</div>;
  }
  const values = readings.map((r) => r.v);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const inRange = values.filter((v) => v >= RANGE_LOW && v <= RANGE_HIGH).length;
  const tir = Math.round((inRange / values.length) * 100);
  const above = values.filter((v) => v > RANGE_HIGH).length;
  const below = values.filter((v) => v < RANGE_LOW).length;
  const tar = Math.round((above / values.length) * 100);
  const tbr = Math.round((below / values.length) * 100);
  const max = readings.reduce((a, b) => (b.v > a.v ? b : a));
  const min = readings.reduce((a, b) => (b.v < a.v ? b : a));
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

  const stats: Array<{ l: string; v: string; c?: string }> = [
    { l: "Daily avg", v: `${avg} mg/dL`, c: colorFor(avg) },
    { l: "Time in range", v: `${tir}%`, c: tir >= 70 ? GREEN : tir >= 50 ? ORANGE : PINK },
    { l: "Time above 180", v: `${tar}%`, c: tar > 25 ? ORANGE : "rgba(255,255,255,0.85)" },
    { l: "Time below 70", v: `${tbr}%`, c: tbr > 4 ? PINK : "rgba(255,255,255,0.85)" },
    { l: "Highest", v: `${Math.round(max.v)} @ ${fmtTime(max.t)}`, c: ORANGE },
    { l: "Lowest", v: `${Math.round(min.v)} @ ${fmtTime(min.t)}`, c: PINK },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Today's summary
        </div>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>↺ back</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
        {stats.map((s) => (
          <div key={s.l} style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: s.c || "rgba(255,255,255,0.9)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function colorFor(v: number) {
  if (v < RANGE_LOW) return PINK;
  if (v > RANGE_HIGH) return ORANGE;
  return GREEN;
}

// LibreLinkUp timestamps look like "11/24/2024 4:23:12 PM" (UTC server time).
// Delegate to the shared parser so display times honour the user's device TZ.
function parseLluTs(s: string): number {
  return _parseLluTs(s) ?? Date.now();
}
