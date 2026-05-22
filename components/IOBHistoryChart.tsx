"use client";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { buildDoses, buildIOBHistory, detectIOBPeaks, getDIAMinutes, getActiveDosesAtTime, type InsulinType } from "@/lib/iob";
import type { InsulinLog } from "@/lib/insulin";
import type { Meal } from "@/lib/meals";

const GREEN  = "#22D3A0";
const AMBER  = "#F59E0B";
const ORANGE = "#FF9500";

const LS_KEY = "glev:iob_history_hours";

function iobColor(iob: number): string {
  if (iob < 1) return GREEN;
  if (iob < 3) return AMBER;
  return ORANGE;
}

type WindowHours = 12 | 24;

interface Props {
  insulin: InsulinLog[];
  insulinType: InsulinType;
  meals?: Meal[];
}

export default function IOBHistoryChart({ insulin, insulinType, meals }: Props) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [hours, setHours] = useState<WindowHours>(() => {
    if (typeof window === "undefined") return 24;
    const stored = window.localStorage.getItem(LS_KEY);
    return stored === "12" ? 12 : 24;
  });
  const [activePeakIdx, setActivePeakIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const iv = setInterval(tick, 5 * 60_000);
    window.addEventListener("focus", tick, { passive: true });
    return () => { clearInterval(iv); window.removeEventListener("focus", tick); };
  }, []);

  const closePeakPopover = useCallback(() => setActivePeakIdx(null), []);

  useEffect(() => {
    if (activePeakIdx === null) return;
    const handleDoc = (e: MouseEvent | TouchEvent) => {
      if (svgRef.current && !svgRef.current.contains(e.target as Node)) {
        closePeakPopover();
      }
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("touchstart", handleDoc);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("touchstart", handleDoc);
    };
  }, [activePeakIdx, closePeakPopover]);

  function pickWindow(h: WindowHours) {
    setHours(h);
    try { window.localStorage.setItem(LS_KEY, String(h)); } catch { /* quota */ }
  }

  const doses = useMemo(() => buildDoses(insulin, meals), [insulin, meals]);
  const diaMin = getDIAMinutes(insulinType);

  const samples = useMemo(
    () => buildIOBHistory(doses, diaMin, hours, now),
    [doses, diaMin, hours, now],
  );

  const currentIOB = samples[samples.length - 1].iob;
  const maxIOB     = Math.max(...samples.map(s => s.iob), 0.1);
  const hasActivity = samples.some(s => s.iob > 0.05);
  const color      = iobColor(currentIOB);

  const W = 300, H = 88, PAD_L = 26, PAD_R = 6, PAD_T = 8, PAD_B = 22;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const steps  = samples.length - 1;

  const pts = samples.map((s, i) => ({
    x: PAD_L + (i / steps) * chartW,
    y: PAD_T + (1 - s.iob / maxIOB) * chartH,
    iob: s.iob,
  }));

  const polyPts = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const areaPath = [
    `M ${pts[0].x.toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    ...pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L ${pts[pts.length - 1].x.toFixed(1)},${(PAD_T + chartH).toFixed(1)}`,
    "Z",
  ].join(" ");

  const yFloor = PAD_T + chartH;
  const yTop   = PAD_T;
  const yMidV  = maxIOB / 2;
  const yMidY  = PAD_T + 0.5 * chartH;

  const labelEvery = hours <= 12 ? 3 : 6;
  const timeLabels: Array<{ x: number; label: string; i: number }> = [];
  for (let h = 0; h <= hours; h += labelEvery) {
    const tMs  = now - hours * 60 * 60_000 + h * 60 * 60_000;
    const x    = PAD_L + (h / hours) * chartW;
    const label = new Date(tMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    timeLabels.push({ x, label, i: h });
  }

  // Detect local maxima using the extracted pure function (lib/iob.ts → detectIOBPeaks).
  // We enrich each IOBPeak with SVG coordinates for rendering.
  const peaks = useMemo(() => {
    if (!hasActivity) return [];
    return detectIOBPeaks(samples).map(pk => {
      const idx = samples.findIndex(s => s.tMs === pk.tMs);
      return { ...pk, x: idx >= 0 ? pts[idx].x : 0, y: idx >= 0 ? pts[idx].y : 0 };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, hasActivity]);

  const uid = `iob-hist-${Math.round(now / 60_000)}`;

  const PILL_W = 46;
  const PILL_H = 16;
  const PILL_GAP = 5;

  const POPUP_W = 148;
  const POPUP_ROW_H = 17;
  const POPUP_HEAD_H = 18;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        padding: "18px 18px 14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          fontSize: 11, color: "var(--text-dim)",
          letterSpacing: "0.1em", fontWeight: 700,
        }}>
          {t("iob_history_title").toUpperCase()}
        </div>

        {/* 12 h / 24 h pill toggle */}
        <div style={{
          display: "flex",
          gap: 4,
          background: "var(--surface-raised, rgba(255,255,255,0.06))",
          borderRadius: 20,
          padding: "2px 3px",
          border: "1px solid var(--border)",
        }}>
          {([12, 24] as WindowHours[]).map(opt => {
            const active = hours === opt;
            return (
              <button
                key={opt}
                onClick={() => pickWindow(opt)}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--bg, #0f0f10)" : "var(--text-ghost)",
                  background: active ? "var(--accent, #22D3A0)" : "transparent",
                  border: "none",
                  borderRadius: 14,
                  padding: "2px 8px",
                  cursor: "pointer",
                  lineHeight: 1.5,
                  transition: "background 0.18s, color 0.18s",
                }}
              >
                {opt}&nbsp;h
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart area */}
      {!hasActivity ? (
        <div style={{
          height: H,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>
            {t("iob_history_empty")}
          </span>
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          style={{ display: "block", overflow: "visible" }}
          onClick={closePeakPopover}
        >
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal grid — floor, mid, top */}
          <line
            x1={PAD_L} y1={yFloor} x2={W - PAD_R} y2={yFloor}
            stroke="var(--border)" strokeWidth="0.6"
          />
          <line
            x1={PAD_L} y1={yMidY} x2={W - PAD_R} y2={yMidY}
            stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 4"
          />
          <line
            x1={PAD_L} y1={yTop} x2={W - PAD_R} y2={yTop}
            stroke="var(--border)" strokeWidth="0.4" strokeDasharray="2 5"
            opacity="0.5"
          />

          {/* Y-axis labels */}
          <text x={PAD_L - 4} y={yFloor - 1} fontSize="7" fill="var(--text-faint)" textAnchor="end">0</text>
          <text x={PAD_L - 4} y={yMidY + 3}  fontSize="7" fill="var(--text-faint)" textAnchor="end">
            {yMidV.toFixed(1)}
          </text>
          <text x={PAD_L - 4} y={yTop + 4}   fontSize="7" fill="var(--text-faint)" textAnchor="end">
            {maxIOB.toFixed(1)}
          </text>

          {/* Area fill */}
          <path d={areaPath} fill={`url(#${uid}-fill)`} />

          {/* IOB line */}
          <polyline
            points={polyPts}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Peak markers */}
          {peaks.map((pk, idx) => {
            const peakColor = iobColor(pk.iob);
            const timeStr = new Date(pk.tMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const label = t("iob_peak_label", { time: timeStr, units: pk.iob.toFixed(1) });

            const pillX = Math.max(PAD_L, Math.min(W - PAD_R - PILL_W, pk.x - PILL_W / 2));
            const pillY = pk.y - PILL_GAP - PILL_H;

            const isActive = activePeakIdx === idx;

            const activeDoses = isActive
              ? getActiveDosesAtTime(doses, pk.tMs, diaMin)
              : [];
            const popupH = POPUP_HEAD_H + Math.max(1, activeDoses.length) * POPUP_ROW_H + 6;
            const popupX = Math.max(0, Math.min(W - POPUP_W, pk.x - POPUP_W / 2));
            const rawPopupY = pillY - popupH - 4;
            const popupY = rawPopupY < 0 ? pk.y + 10 : rawPopupY;

            return (
              <g
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePeakIdx(prev => prev === idx ? null : idx);
                }}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={label}
              >
                {/* Wider invisible hit target around the pill + dot */}
                <rect
                  x={(pillX - 4).toFixed(1)}
                  y={(pillY - 4).toFixed(1)}
                  width={PILL_W + 8}
                  height={PILL_H + pk.y - pillY + 10}
                  fill="transparent"
                />

                {/* Vertical stem from pill to dot */}
                <line
                  x1={pk.x.toFixed(1)}
                  y1={(pillY + PILL_H).toFixed(1)}
                  x2={pk.x.toFixed(1)}
                  y2={(pk.y - 3.5).toFixed(1)}
                  stroke={peakColor}
                  strokeWidth="0.8"
                  opacity="0.5"
                />
                {/* Pill background */}
                <rect
                  x={pillX.toFixed(1)}
                  y={pillY.toFixed(1)}
                  width={PILL_W}
                  height={PILL_H}
                  rx="3"
                  ry="3"
                  fill={isActive ? peakColor : "var(--surface)"}
                  stroke={peakColor}
                  strokeWidth={isActive ? "0" : "0.8"}
                  opacity="0.95"
                />
                {/* Pill label text */}
                <text
                  x={(pillX + PILL_W / 2).toFixed(1)}
                  y={(pillY + PILL_H / 2 + 3).toFixed(1)}
                  fontSize="6.5"
                  fill={isActive ? "var(--bg, #0f0f10)" : peakColor}
                  textAnchor="middle"
                  fontWeight="600"
                  fontFamily="var(--font-mono)"
                >
                  {label}
                </text>
                {/* Peak dot */}
                <circle
                  cx={pk.x.toFixed(1)}
                  cy={pk.y.toFixed(1)}
                  r="3"
                  fill={peakColor}
                  stroke="var(--surface)"
                  strokeWidth="1"
                />

                {/* Dose popover — rendered as foreignObject in SVG space */}
                {isActive && (
                  <foreignObject
                    x={popupX}
                    y={popupY}
                    width={POPUP_W}
                    height={popupH}
                    style={{ overflow: "visible" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{
                        background: "var(--surface)",
                        border: `1px solid ${peakColor}`,
                        borderRadius: 6,
                        padding: "5px 8px 6px",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                        fontSize: 9,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text)",
                        width: POPUP_W,
                        boxSizing: "border-box",
                      }}
                    >
                      {/* Popover header */}
                      <div style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: peakColor,
                        letterSpacing: "0.06em",
                        marginBottom: 4,
                        textTransform: "uppercase",
                      }}>
                        {t("iob_peak_popover_title", { time: new Date(pk.tMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
                      </div>

                      {/* Dose rows */}
                      {activeDoses.length === 0 ? (
                        <div style={{ color: "var(--text-ghost)", fontSize: 8 }}>
                          {t("iob_no_active_doses")}
                        </div>
                      ) : (
                        activeDoses.map((d, di) => {
                          const doseTime = new Date(d.administeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                          const sourceName = d.label
                            || (d.source === "meal" ? t("iob_peak_popover_meal_label") : t("iob_peak_manual_bolus"));
                          const isMeal = d.source === "meal" && !!d.mealId;
                          return (
                            <div
                              key={di}
                              onClick={isMeal ? (e) => {
                                e.stopPropagation();
                                router.push(`/entries#${d.mealId}`);
                              } : undefined}
                              role={isMeal ? "link" : undefined}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 6,
                                padding: "1px 0",
                                borderTop: di > 0 ? "0.5px solid var(--border)" : undefined,
                                cursor: isMeal ? "pointer" : "default",
                              }}
                            >
                              <span style={{
                                color: isMeal ? "var(--text)" : "var(--text-dim)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 88,
                                fontSize: 8.5,
                                flexShrink: 1,
                                minWidth: 0,
                              }}>
                                {doseTime} · {sourceName}
                              </span>
                              <span style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                                flexShrink: 0,
                              }}>
                                <span style={{
                                  color: peakColor,
                                  fontWeight: 700,
                                  whiteSpace: "nowrap",
                                  fontSize: 9,
                                }}>
                                  {t("iob_peak_dose_units", { units: d.units.toFixed(1) })}
                                </span>
                                {isMeal && (
                                  <svg
                                    width="7" height="10"
                                    viewBox="0 0 6 10"
                                    fill="none"
                                    style={{ opacity: 0.45, flexShrink: 0 }}
                                  >
                                    <path
                                      d="M1 1l4 4-4 4"
                                      stroke="var(--text-dim)"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}

          {/* "Now" marker — rightmost edge */}
          <line
            x1={W - PAD_R} y1={PAD_T}
            x2={W - PAD_R} y2={PAD_T + chartH}
            stroke={color} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.7"
          />

          {/* Current IOB dot */}
          <circle
            cx={(W - PAD_R).toFixed(1)}
            cy={pts[pts.length - 1].y.toFixed(1)}
            r="3"
            fill={color}
            opacity="0.9"
          />

          {/* Time labels */}
          {timeLabels.map((l, idx) => (
            <text
              key={l.i}
              x={l.x}
              y={H - 2}
              fontSize="7"
              fill="var(--text-faint)"
              textAnchor={
                idx === 0
                  ? "start"
                  : idx === timeLabels.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {l.label}
            </text>
          ))}
        </svg>
      )}

      {/* Footer row */}
      <div style={{
        fontSize: 10, color: "var(--text-faint)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>{t("iob_history_interval", { minutes: 15 })}</span>
        <span style={{
          fontFamily: "var(--font-mono)",
          color: currentIOB > 0.05 ? color : "var(--text-ghost)",
          fontWeight: 700, fontSize: 11,
        }}>
          {t("iob_history_current", { units: currentIOB.toFixed(1) })}
        </span>
      </div>
    </div>
  );
}
