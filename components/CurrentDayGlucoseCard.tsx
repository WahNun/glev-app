"use client";

import { useEffect, useState, useCallback } from "react";
import CgmFetchButton, { type CgmFetchResult } from "@/components/CgmFetchButton";

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

const CARD_STYLE_TAG = `
  .glev-today-card { height: 220px; }
  @media (max-width: 768px) {
    .glev-today-card { height: 300px; }
  }
`;

export default function CurrentDayGlucoseCard() {
  const [s, setS] = useState<State>({ kind: "loading" });
  const [flipped, setFlipped] = useState(false);

  const loadHistory = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const res = await fetch("/api/cgm/history", { cache: "no-store" });
      if (res.status === 401 || res.status === 404 || res.status === 412) {
        if (!signal?.cancelled) setS({ kind: "no-cgm" });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        const msg = (body && typeof body.error === "string" ? body.error : "") || `HTTP ${res.status}`;
        const m = msg.toLowerCase();
        if (
          res.status === 502 ||
          m.includes("no patients") ||
          m.includes("not connected") ||
          m.includes("credential") ||
          m.includes("not linked") ||
          m.includes("no cgm")
        ) {
          if (!signal?.cancelled) setS({ kind: "no-cgm" });
          return;
        }
        if (!signal?.cancelled) setS({ kind: "error", msg });
        return;
      }
      const data = (await res.json()) as { current: Reading | null; history: Reading[] };
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
        {/* FRONT */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: "18px 20px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflow: "hidden",
          }}
        >
          <Header
            title="Today's Glucose"
            sub={s.kind === "ok"
              ? `${s.readings.length} readings · ${new Date().toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric" })}`
              : s.kind === "loading" ? "Loading CGM data…"
              : s.kind === "no-cgm" ? "Connect a CGM in Settings to see live glucose."
              : `CGM error: ${s.msg}`}
            current={s.kind === "ok" ? s.current : null}
            flippable={s.kind === "ok"}
            onCgmRefresh={onCgmRefresh}
            showRefresh={s.kind === "ok" || s.kind === "error"}
          />
          {s.kind === "ok" && s.readings.length > 0 ? (
            <DayChart readings={s.readings} />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
              {s.kind === "loading" ? "…" : s.kind === "no-cgm" ? "No CGM connected" : s.kind === "ok" ? "No readings yet today" : ""}
            </div>
          )}
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

function Header({
  title, sub, current, flippable, onCgmRefresh, showRefresh,
}: {
  title: string;
  sub: string;
  current: { v: number; t: number } | null;
  flippable: boolean;
  onCgmRefresh?: (r: CgmFetchResult) => void;
  showRefresh?: boolean;
}) {
  const c = current ? colorFor(current.v) : "rgba(255,255,255,0.5)";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{sub}</div>
        {showRefresh && onCgmRefresh && (
          <div style={{ marginTop: 8 }}>
            <CgmFetchButton size="sm" label="Refresh" onResult={onCgmRefresh} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
        {current && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", fontWeight: 600 }}>NOW</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: c, letterSpacing: "-0.03em", lineHeight: 1 }}>
              {Math.round(current.v)}
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500, marginLeft: 4 }}>mg/dL</span>
            </div>
          </div>
        )}
        {flippable && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>↺</span>}
      </div>
    </div>
  );
}

function DayChart({ readings }: { readings: Array<{ t: number; v: number }> }) {
  // Wider-than-tall but with enough vertical room that the trace stays
  // readable when the SVG scales to a narrow phone width.
  const W = 720;
  const H = 240;
  const padL = 30;
  const padR = 12;
  const padT = 14;
  const padB = 28;

  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const dayStart = today0.getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  const xMin = dayStart;
  const xMax = dayEnd;

  const yMin = 40;
  const yMax = 300;
  const toX = (t: number) => padL + ((t - xMin) / (xMax - xMin)) * (W - padL - padR);
  const toY = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const path = readings.map((r, i) => `${i === 0 ? "M" : "L"}${toX(r.t).toFixed(1)},${toY(r.v).toFixed(1)}`).join(" ");
  const last = readings[readings.length - 1];
  const lastX = toX(last.t);
  const lastY = toY(last.v);
  const lastC = colorFor(last.v);

  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21];
  const yTicks = [70, 110, 180, 250];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", overflow: "visible", flex: 1 }}>
      {/* In-range band */}
      <rect
        x={padL} y={toY(RANGE_HIGH)}
        width={W - padL - padR}
        height={toY(RANGE_LOW) - toY(RANGE_HIGH)}
        fill={GREEN} fillOpacity="0.06"
      />
      {/* Y grid */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 4" />
          <text x={padL - 5} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.25)">{v}</text>
        </g>
      ))}
      {/* X hour ticks */}
      {hourTicks.map((h) => {
        const t = dayStart + h * 3600 * 1000;
        return (
          <text key={h} x={toX(t)} y={H - 4} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.25)">
            {h.toString().padStart(2, "0")}
          </text>
        );
      })}
      {/* Now indicator */}
      <line x1={toX(Date.now())} y1={padT} x2={toX(Date.now())} y2={H - padB} stroke={ACCENT} strokeOpacity="0.25" strokeDasharray="2 3" />
      {/* Line */}
      <path d={path} fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point */}
      <circle cx={lastX} cy={lastY} r="3.5" fill={lastC} stroke={SURFACE} strokeWidth="1.5" />
    </svg>
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

// LibreLinkUp timestamps look like "11/24/2024 4:23:12 PM"
function parseLluTs(s: string): number {
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (m) {
    let h = parseInt(m[4], 10);
    const ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10), h, parseInt(m[5], 10), parseInt(m[6], 10)).getTime();
  }
  return Date.now();
}
