"use client";
import { useEffect, useState, useMemo } from "react";
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

const RADIUS = 44;
const CIRC   = 2 * Math.PI * RADIUS;
const MAX_IOB = 5;
const SZ = 120;

function CircleGauge({ iob, color, cleared }: { iob: number; color: string; cleared: boolean }) {
  const filled = Math.min(iob / MAX_IOB, 1) * CIRC;
  return (
    <svg
      width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} aria-hidden="true"
      style={{ filter: cleared ? "none" : `drop-shadow(0 0 10px ${color}55)` }}
    >
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none" stroke="var(--surface-soft)" strokeWidth={10}
      />
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none"
        stroke={cleared ? "var(--surface-soft)" : color}
        strokeWidth={10}
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
  doses, insulinType, now, color, cleared,
}: {
  doses: BolusDose[];
  insulinType: InsulinType;
  now: number;
  color: string;
  cleared: boolean;
}) {
  const diaMin = getDIAMinutes(insulinType);
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
      {/* full gray baseline */}
      <polyline
        points={pts}
        fill="none"
        stroke="var(--text-ghost)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />
      {/* coloured remaining portion */}
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
      {/* current-time dashed marker */}
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
  /** Latest CGM glucose reading (mg/dL). When provided, the back side
   *  shows a projected "Erwartet: ~X mg/dL" target alongside the
   *  expected drop. Optional — the drop row is shown regardless. */
  currentBg?: number;
}

export default function IOBCard({ insulin, insulinType, meals, currentBg }: Props) {
  const t = useTranslations("dashboard");
  const [now, setNow]       = useState(() => Date.now());
  const [flipped, setFlipped] = useState(false);

  /** Correction factor from localStorage mirror — same value the Engine
   *  uses.  Read once per render cycle; never triggers a suspense/async
   *  boundary so the card stays a pure synchronous component. */
  const cf = useMemo(() => getInsulinSettings().cf, []);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const iv = setInterval(tick, 5 * 60_000);
    window.addEventListener("focus", tick, { passive: true });
    return () => { clearInterval(iv); window.removeEventListener("focus", tick); };
  }, []);

  const diaMin = getDIAMinutes(insulinType);

  /** Combined BolusDose list from both insulin_logs and meals.insulin_units.
   *  Meals whose `id` is already linked via a bolus log's `related_entry_id`
   *  are skipped to prevent double-counting. */
  const doses: BolusDose[] = useMemo(() => buildDoses(insulin, meals), [insulin, meals]);

  const iob     = calcTotalIOB(doses, insulinType, now);
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

  /** Expected glucose drop from the remaining active insulin:
   *  IOB × CF (mg/dL per unit), rounded to the nearest integer. */
  const expectedDrop = Math.round(iob * cf);

  /** Projected glucose target = current CGM − expected drop, clamped
   *  to a physiologically plausible floor (20 mg/dL) so the chip never
   *  shows a nonsensical negative value. */
  const projectedBg = currentBg != null && currentBg > 0
    ? Math.max(20, Math.round(currentBg - expectedDrop))
    : null;

  const insulinTypeLabel = insulinType === "rapid"
    ? t("iob_dia_rapid")
    : t("iob_dia_regular");

  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{
        position: "relative",
        perspective: 1200,
        cursor: "pointer",
        minHeight: 310,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          minHeight: 310,
        }}
      >
        {/* ── FRONT ── */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: "18px 18px 16px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            boxShadow: cleared ? "none" : `inset 0 0 28px ${color}09`,
          }}
        >
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              fontSize: 11, color: "var(--text-dim)",
              letterSpacing: "0.1em", fontWeight: 700,
            }}>
              {t("active_insulin").toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>↺</span>
          </div>

          {/* gauge */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "center", position: "relative",
          }}>
            <CircleGauge iob={iob} color={color} cleared={cleared} />
            <div style={{
              position: "absolute",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
            }}>
              <div style={{
                fontSize: 34, fontWeight: 800, lineHeight: 1,
                fontFamily: "var(--font-mono)",
                color: cleared ? "var(--text-ghost)" : color,
                textShadow: cleared ? "none" : `0 0 22px ${color}77`,
              }}>
                {cleared ? "0.0" : iob.toFixed(1)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
            </div>
          </div>

          {/* clearance chip */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            {cleared ? (
              <span style={{
                padding: "4px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: "var(--surface-soft)", color: "var(--text-ghost)",
                letterSpacing: "0.04em",
              }}>
                {t("iob_fully_cleared")}
              </span>
            ) : (
              <span style={{
                padding: "4px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: `${color}22`, color, letterSpacing: "0.04em",
              }}>
                {t("iob_cleared_in", { minutes: clearsInMin })}
              </span>
            )}
          </div>

          {/* risk label */}
          {!cleared && (
            <div style={{
              textAlign: "center", fontSize: 11,
              color: "var(--text-ghost)", lineHeight: 1.4,
            }}>
              {iob < 1 ? t("iob_risk_low") : iob < 3 ? t("iob_risk_moderate") : t("iob_risk_high")}
            </div>
          )}
        </div>

        {/* ── BACK ── */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: "16px 18px 14px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            boxShadow: cleared ? "none" : `inset 0 0 28px ${color}09`,
          }}
        >
          {/* back header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              fontSize: 11,
              color: cleared ? "var(--text-dim)" : color,
              letterSpacing: "0.1em", fontWeight: 700,
            }}>
              {t("iob_back_title").toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>

          {/* decay sparkline */}
          <IOBSparkline
            doses={doses}
            insulinType={insulinType}
            now={now}
            color={color}
            cleared={cleared}
          />

          {/* active dose list */}
          {activeDoses.length > 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", gap: 5,
              flex: 1, minHeight: 0, overflowY: "auto",
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
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>
                {t("iob_no_active_doses")}
              </span>
            </div>
          )}

          {/* ── Expected BG impact (IOB × CF) ── */}
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
              {/* Drop chip */}
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
              {/* Projected target (only when current BG is known) */}
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
              {/* Compliance hint */}
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
