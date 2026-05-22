"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { calcTotalIOB, calcSingleIOB, getDIAMinutes, buildDoses, type BolusDose, type InsulinType } from "@/lib/iob";
import { getInsulinSettings } from "@/lib/userSettings";
import type { InsulinLog } from "@/lib/insulin";
import type { Meal } from "@/lib/meals";

const GREEN  = "#22D3A0";
const AMBER  = "#F59E0B";
const ORANGE = "#FF9500";

function iobColor(iob: number): string {
  if (iob < 1) return GREEN;
  if (iob < 3) return AMBER;
  return ORANGE;
}

const RADIUS = 36;
const CIRC   = 2 * Math.PI * RADIUS;
const MAX_IOB = 5;
const SZ = 96;

function CircleGauge({ iob, color, cleared }: { iob: number; color: string; cleared: boolean }) {
  const filled = Math.min(iob / MAX_IOB, 1) * CIRC;
  return (
    <svg
      width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} aria-hidden="true"
      style={{ filter: cleared ? "none" : `drop-shadow(0 0 8px ${color}55)` }}
    >
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none" stroke="var(--surface-soft)" strokeWidth={9}
      />
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none"
        stroke={cleared ? "var(--surface-soft)" : color}
        strokeWidth={9}
        strokeDasharray={`${filled} ${CIRC}`}
        strokeLinecap="round"
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
          transition: "stroke-dasharray .6s ease, stroke .3s ease",
        }}
      />
    </svg>
  );
}

/** Parabolic decay sparkline covering all active doses combined.
 *  Gray = elapsed portion, coloured = remaining, dashed line = now. */
function IOBSparkline({
  doses, diaMin, now, color, cleared,
}: {
  doses: BolusDose[];
  diaMin: number;
  now: number;
  color: string;
  cleared: boolean;
}) {
  const W = 220, H = 48, PAD = 4;
  const STEPS = 80;

  if (doses.length === 0) {
    return (
      <div style={{ height: H, background: "var(--surface-soft)", borderRadius: 8, opacity: 0.5 }} />
    );
  }

  // Only include doses that haven't fully cleared yet at `now`.
  // This prevents an early-morning dose from stretching the X-axis so far
  // that a later dose becomes invisible (1–2 px wide).
  // If everything has cleared (e.g. the card is in "cleared" state), fall back
  // to all doses so the full decay curve is still visible.
  const activeDoses = doses.filter(d => {
    const elapsedMin = (now - new Date(d.administeredAt).getTime()) / 60_000;
    return elapsedMin >= 0 && elapsedMin < diaMin;
  });
  const windowDoses = activeDoses.length > 0 ? activeDoses : doses;

  const earliestMs       = Math.min(...windowDoses.map(d => new Date(d.administeredAt).getTime()));
  const latestClearanceMs = Math.max(...windowDoses.map(d => new Date(d.administeredAt).getTime() + diaMin * 60_000));
  const totalDurationMs  = Math.max(latestClearanceMs - earliestMs, 1);

  const maxIOB = doses.reduce((s, d) => s + d.units, 0);

  const rawPts = Array.from({ length: STEPS + 1 }, (_, i) => {
    const tMs     = earliestMs + (i / STEPS) * totalDurationMs;
    const iobAtT  = doses.reduce((s, d) => s + calcSingleIOB(d, tMs, diaMin), 0);
    const ratio   = maxIOB > 0 ? Math.max(0, Math.min(1, iobAtT / maxIOB)) : 0;
    const x       = (i / STEPS) * W;
    const y       = PAD + (1 - ratio) * (H - PAD * 2);
    return { x, y };
  });

  const pts   = rawPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const nowX  = Math.max(0, Math.min(W, ((now - earliestMs) / totalDurationMs) * W));
  const uid   = `iob-card-${Math.round(earliestMs / 1000)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <clipPath id={`${uid}-future`}>
          <rect x={nowX} y="0" width={W - nowX} height={H} />
        </clipPath>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--text-ghost)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />
      {!cleared && (
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          clipPath={`url(#${uid}-future)`}
        />
      )}
      {!cleared && (
        <line
          x1={nowX} y1={PAD - 2} x2={nowX} y2={H - PAD + 2}
          stroke={color} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8"
        />
      )}
    </svg>
  );
}

interface Props {
  insulin: InsulinLog[];
  insulinType: InsulinType;
  /** Today's meals — used to include meal-insulin doses that were never
   *  mirrored into insulin_logs (the most common case for the meal-log
   *  wizard path). Deduplicated against linked bolus logs to avoid
   *  double-counting when the user explicitly tagged a bolus to a meal. */
  meals?: Meal[];
  /** Latest CGM glucose reading (mg/dL). When provided, the detail section
   *  shows a projected "Erwartet: ~X mg/dL" target alongside the
   *  expected drop. Optional — the drop row is shown regardless. */
  currentBg?: number;
}

export default function IOBCard({ insulin, insulinType, meals, currentBg }: Props) {
  const t = useTranslations("dashboard");
  const [now, setNow]           = useState(() => Date.now());
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("glev_iob_expanded") === "true";
  });
  const detailRef               = useRef<HTMLDivElement>(null);

  const cf = useMemo(() => getInsulinSettings().cf, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("glev_iob_expanded", String(expanded));
    }
  }, [expanded]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const iv = setInterval(tick, 5 * 60_000);
    window.addEventListener("focus", tick, { passive: true });
    return () => { clearInterval(iv); window.removeEventListener("focus", tick); };
  }, []);

  /** User-configured DIA from localStorage mirror — read once per render
   *  cycle alongside the correction factor. Falls back to 180 min when
   *  no value has been saved yet (same as the historic hard-coded default). */
  const userDiaMinutes = useMemo(() => getInsulinSettings().diaMinutes, []);
  const diaMin = getDIAMinutes(insulinType, userDiaMinutes);

  const doses: BolusDose[] = useMemo(() => buildDoses(insulin, meals), [insulin, meals]);

  const iob     = calcTotalIOB(doses, insulinType, now, userDiaMinutes);
  const cleared = iob < 0.05;
  const color   = iobColor(iob);

  const activeDoses = doses.filter(d => {
    const elapsed = (now - new Date(d.administeredAt).getTime()) / 60_000;
    return elapsed >= 0 && elapsed < diaMin;
  });

  const clearsInMin = cleared ? 0 : activeDoses.reduce((max, d) => {
    const elapsed = (now - new Date(d.administeredAt).getTime()) / 60_000;
    if (elapsed >= diaMin) return max;
    return Math.max(max, Math.ceil(diaMin - elapsed));
  }, 0);

  const expectedDrop = Math.round(iob * cf);

  const projectedBg = currentBg != null && currentBg > 0
    ? Math.max(20, Math.round(currentBg - expectedDrop))
    : null;

  const insulinBrandBolus = useMemo(() => getInsulinSettings().insulinBrandBolus, []);
  const insulinTypeLabel = insulinBrandBolus?.trim()
    ? insulinBrandBolus.trim()
    : insulinType === "rapid"
      ? t("iob_dia_rapid")
      : t("iob_dia_regular");

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        boxShadow: cleared ? "none" : `inset 0 0 28px ${color}09`,
        overflow: "hidden",
        cursor: "pointer",
      }}
      onClick={() => setExpanded(e => !e)}
      aria-expanded={expanded}
    >
      {/* ── COMPACT FRONT ── */}
      <div
        style={{
          padding: "14px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        {/* Gauge */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <CircleGauge iob={iob} color={color} cleared={cleared} />
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
          }}>
            <div style={{
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1,
              fontFamily: "var(--font-mono)",
              color: cleared ? "var(--text-ghost)" : color,
              textShadow: cleared ? "none" : `0 0 18px ${color}77`,
            }}>
              {cleared ? "0.0" : iob.toFixed(1)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
          </div>
        </div>

        {/* Right side: title, chip, risk */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{
            fontSize: 11, color: "var(--text-dim)",
            letterSpacing: "0.1em", fontWeight: 700,
          }}>
            {t("active_insulin").toUpperCase()}
          </div>

          {/* Clearance chip */}
          {cleared ? (
            <span style={{
              alignSelf: "flex-start",
              padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: "var(--surface-soft)", color: "var(--text-ghost)",
              letterSpacing: "0.04em",
            }}>
              {t("iob_fully_cleared")}
            </span>
          ) : (
            <span style={{
              alignSelf: "flex-start",
              padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: `${color}22`, color, letterSpacing: "0.04em",
            }}>
              {t("iob_cleared_in", { minutes: clearsInMin })}
            </span>
          )}

          {/* Risk label */}
          {!cleared && (
            <div style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.4 }}>
              {iob < 1 ? t("iob_risk_low") : iob < 3 ? t("iob_risk_moderate") : t("iob_risk_high")}
            </div>
          )}
        </div>

        {/* Chevron */}
        <button
          onClick={e => { e.stopPropagation(); setExpanded(ex => !ex); }}
          aria-label={t("iob_details_toggle_aria")}
          aria-expanded={expanded}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 2px",
            flexShrink: 0,
            color: "var(--text-ghost)",
            fontSize: 14,
            lineHeight: 1,
            transition: "transform 0.3s ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ›
        </button>
      </div>

      {/* ── COLLAPSIBLE DETAIL ── */}
      <div
        ref={detailRef}
        data-testid="iob-detail-section"
        style={{
          overflow: "hidden",
          maxHeight: expanded ? 600 : 0,
          opacity: expanded ? 1 : 0,
          transition: "max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease",
        }}
      >
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "14px 16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          {/* detail header */}
          <div style={{
            fontSize: 11,
            color: cleared ? "var(--text-dim)" : color,
            letterSpacing: "0.1em", fontWeight: 700,
          }}>
            {t("iob_back_title").toUpperCase()}
          </div>

          {/* decay sparkline */}
          <IOBSparkline
            doses={doses}
            diaMin={diaMin}
            now={now}
            color={color}
            cleared={cleared}
          />

          {/* active dose list */}
          {activeDoses.length > 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", gap: 5,
            }}>
              {activeDoses
                .slice()
                .sort((a, b) =>
                  new Date(b.administeredAt).getTime() - new Date(a.administeredAt).getTime()
                )
                .map((d, i) => {
                  const singleIOB  = calcSingleIOB(d, now, diaMin);
                  const timeStr    = new Date(d.administeredAt).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit",
                  });
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex", alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px", borderRadius: 8,
                        background: "var(--surface-soft)",
                        border: "1px solid var(--border)",
                        fontSize: 12, gap: 6,
                      }}
                    >
                      <span style={{
                        color: "var(--text-dim)",
                        fontFamily: "var(--font-mono)", flexShrink: 0,
                      }}>
                        {timeStr}
                      </span>
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                        {d.units.toFixed(1)} IE
                      </span>
                      <span style={{
                        color, fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        marginLeft: "auto", flexShrink: 0,
                      }}>
                        {t("iob_dose_remaining", { units: singleIOB.toFixed(1) })}
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>
                {t("iob_no_active_doses")}
              </span>
            </div>
          )}

          {/* Expected BG impact */}
          {!cleared && (
            <div style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}>
              <div style={{
                fontSize: 10, color: "var(--text-ghost)",
                letterSpacing: "0.08em", fontWeight: 700,
                textTransform: "uppercase",
              }}>
                {t("iob_bg_impact_label")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  padding: "3px 11px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                  background: `${color}22`, color,
                  fontFamily: "var(--font-mono)",
                }}>
                  {t("iob_bg_impact_value", { drop: expectedDrop })}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>
                  {t("iob_bg_impact_formula", { iob: iob.toFixed(1), cf })}
                </span>
              </div>
              {projectedBg != null && (
                <span style={{
                  padding: "3px 11px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                  background: "var(--surface-soft)",
                  color: "var(--text-muted)",
                  alignSelf: "flex-start",
                }}>
                  {t("iob_projected_bg", { target: projectedBg })}
                </span>
              )}
              <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4 }}>
                {t("iob_bg_hint")}
              </div>
            </div>
          )}

          {/* DIA info footer */}
          <div style={{
            fontSize: 11, color: "var(--text-faint)", textAlign: "center",
            borderTop: "1px solid var(--border)", paddingTop: 7,
          }}>
            {t("iob_dia_info", { minutes: diaMin, type: insulinTypeLabel })}
          </div>
        </div>
      </div>
    </div>
  );
}
