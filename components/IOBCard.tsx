"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { calcTotalIOB, calcSingleIOB, getDIAMinutes, buildDoses, type BolusDose, type InsulinType } from "@/lib/iob";
import { getInsulinSettings } from "@/lib/userSettings";
import type { InsulinLog } from "@/lib/insulin";
import type { Meal } from "@/lib/meals";

const GREEN        = "#22D3A0";
const AMBER        = "#F59E0B";
const ORANGE       = "#FF9500";
const BASAL_INDIGO = "#6366F1";   // basal ring — visually distinct from bolus

function iobColor(iob: number): string {
  if (iob < 1) return GREEN;
  if (iob < 3) return AMBER;
  return ORANGE;
}

const RADIUS = 36;
const CIRC   = 2 * Math.PI * RADIUS;
const MAX_IOB = 5;
const SZ = 96;

function CircleGauge({ iob, color, cleared, fraction }: {
  iob: number; color: string; cleared: boolean;
  /** When provided, overrides the iob/MAX_IOB fill calculation (0–1). */
  fraction?: number;
}) {
  const filled = Math.min(fraction !== undefined ? fraction : iob / MAX_IOB, 1) * CIRC;
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
  const [basalExpanded, setBasalExpanded] = useState(false);
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

  const insulinBrandBolus  = useMemo(() => getInsulinSettings().insulinBrandBolus,  []);
  const insulinBrandBolus2 = useMemo(() => getInsulinSettings().insulinBrandBolus2, []);
  const insulinBrandBasal  = useMemo(() => getInsulinSettings().insulinBrandBasal,  []);

  // Last 5 basal injections for the basal expanded detail panel.
  const recentBasalLogs = useMemo(
    () => insulin
      .filter(i => i.insulin_type === "basal")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5),
    [insulin],
  );
  const insulinTypeLabel = insulinBrandBolus?.trim()
    ? insulinBrandBolus.trim()
    : insulinType === "rapid"
      ? t("iob_dia_rapid")
      : t("iob_dia_regular");

  // ── Bolus | Basal toggle ─────────────────────────────────────────────────
  const [view, setView] = useState<"bolus" | "basal">("bolus");

  // Last basal injection from insulin_logs (type === "basal")
  const lastBasal = useMemo(() => {
    if (!insulin || insulin.length === 0) return null;
    const entries = insulin
      .filter(l => l.insulin_type === "basal" && l.units > 0)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return entries[0] ?? null;
  }, [insulin]);

  const BASAL_WINDOW_MIN = 24 * 60;
  const basalElapsedMin = lastBasal
    ? (now - new Date(lastBasal.created_at).getTime()) / 60_000
    : null;
  // Countdown: full ring = freshly injected, empty ring = window expired.
  const basalFraction   = basalElapsedMin !== null
    ? Math.max(0, 1 - basalElapsedMin / BASAL_WINDOW_MIN)
    : 0;
  const basalOverdue    = basalElapsedMin !== null && basalElapsedMin > BASAL_WINDOW_MIN;
  const basalColor      = basalOverdue ? ORANGE : BASAL_INDIGO;
  const basalElapsedH   = basalElapsedMin !== null ? Math.floor(basalElapsedMin / 60) : 0;
  const basalElapsedM   = basalElapsedMin !== null ? Math.floor(basalElapsedMin % 60)  : 0;
  const basalNextInH    = basalElapsedMin !== null
    ? Math.max(0, Math.floor((BASAL_WINDOW_MIN - basalElapsedMin) / 60))
    : 0;

  const isExpanded = view === "bolus" ? expanded : basalExpanded;
  const chevron = (
    <button
      onClick={e => {
        e.stopPropagation();
        if (view === "bolus") setExpanded(ex => !ex);
        else setBasalExpanded(ex => !ex);
      }}
      aria-label={t("iob_details_toggle_aria")}
      aria-expanded={isExpanded}
      style={{
        background: "none", border: "none", cursor: "pointer",
        padding: "4px 6px", flexShrink: 0,
        color: "var(--text-ghost)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform 0.3s ease",
        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  );

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        boxShadow: view === "bolus" && !cleared ? `inset 0 0 28px ${color}09` : "none",
        overflow: "hidden",
        cursor: "pointer",
      }}
      onClick={() => {
        if (view === "bolus") setExpanded(e => !e);
        else setBasalExpanded(e => !e);
      }}
      aria-expanded={isExpanded}
    >
      {/* ── COMPACT FRONT ── */}
      <div style={{ padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Toggle row — Bolus | Basal chips + chevron */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {(["bolus", "basal"] as const).map(v => {
              const active = view === v;
              const chipColor = v === "bolus" ? color : basalColor;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={e => { e.stopPropagation(); setView(v); }}
                  style={{
                    padding: "3px 10px", borderRadius: 99,
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
                    border: `1px solid ${active ? chipColor + "55" : "var(--border)"}`,
                    background: active ? `${chipColor}18` : "var(--surface-soft)",
                    color: active ? chipColor : "var(--text-ghost)",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                    touchAction: "manipulation",
                    transition: "background 150ms, border-color 150ms, color 150ms",
                  }}
                >
                  {v === "bolus" ? t("iob_tab_bolus") : t("iob_tab_basal")}
                </button>
              );
            })}
          </div>
          {chevron}
        </div>

        {/* Gauge row — switches based on view */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>

          {view === "bolus" ? (
            <>
              {/* Bolus gauge */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <CircleGauge iob={iob} color={color} cleared={cleared} />
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 1,
                }}>
                  <div style={{
                    fontSize: 26, fontWeight: 800, lineHeight: 1,
                    fontFamily: "var(--font-mono)",
                    color: cleared ? "var(--text-ghost)" : color,
                    textShadow: cleared ? "none" : `0 0 18px ${color}77`,
                  }}>
                    {cleared ? "0.0" : iob.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
                </div>
              </div>

              {/* Bolus info */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", fontWeight: 700 }}>
                  {t("active_insulin").toUpperCase()}
                </div>
                {cleared ? (
                  <span style={{
                    alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                    fontSize: 11, fontWeight: 700,
                    background: "var(--surface-soft)", color: "var(--text-ghost)", letterSpacing: "0.04em",
                  }}>
                    {t("iob_fully_cleared")}
                  </span>
                ) : (
                  <span style={{
                    alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                    fontSize: 11, fontWeight: 700,
                    background: `${color}22`, color, letterSpacing: "0.04em",
                  }}>
                    {t("iob_cleared_in", { minutes: clearsInMin })}
                  </span>
                )}
                {!cleared && (
                  <div style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                    {iob < 1 ? t("iob_risk_low") : iob < 3 ? t("iob_risk_moderate") : t("iob_risk_high")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Basal gauge — fraction = elapsed / 24h */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <CircleGauge
                  iob={0} color={lastBasal ? basalColor : "var(--text-ghost)"}
                  cleared={!lastBasal} fraction={basalFraction}
                />
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 1,
                }}>
                  <div style={{
                    fontSize: lastBasal ? 22 : 20, fontWeight: 800, lineHeight: 1,
                    fontFamily: "var(--font-mono)",
                    color: lastBasal ? basalColor : "var(--text-ghost)",
                    textShadow: lastBasal && !basalOverdue ? `0 0 18px ${BASAL_INDIGO}77` : "none",
                  }}>
                    {lastBasal ? lastBasal.units.toFixed(1) : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
                </div>
              </div>

              {/* Basal info */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", fontWeight: 700 }}>
                  {(insulinBrandBasal?.trim() || t("iob_tab_basal")).toUpperCase()}
                </div>
                {lastBasal ? (
                  <>
                    <span style={{
                      alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                      background: basalOverdue ? `${ORANGE}22` : `${BASAL_INDIGO}18`,
                      color: basalOverdue ? ORANGE : BASAL_INDIGO,
                    }}>
                      {basalOverdue
                        ? t("iob_basal_overdue")
                        : `vor ${basalElapsedH}h ${basalElapsedM}min`}
                    </span>
                    {!basalOverdue && (
                      <div style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                        {t("iob_basal_next_in", { hours: basalNextInH })}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{
                    alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                    fontSize: 11, fontWeight: 700,
                    background: "var(--surface-soft)", color: "var(--text-ghost)", letterSpacing: "0.04em",
                  }}>
                    {t("iob_basal_no_log")}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── COLLAPSIBLE DETAIL ── */}
      <div
        ref={detailRef}
        data-testid="iob-detail-section"
        style={{
          overflow: "hidden",
          maxHeight: isExpanded ? 600 : 0,
          opacity: isExpanded ? 1 : 0,
          transition: "max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease",
        }}
      >
        {view === "basal" ? (
          /* ── Basal expanded detail ── */
          <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ fontSize: 11, color: BASAL_INDIGO, letterSpacing: "0.1em", fontWeight: 700 }}>
              {t("iob_basal_history_title").toUpperCase()}
            </div>
            {recentBasalLogs.length > 0 ? (
              recentBasalLogs.map((b, i) => {
                const timeStr = new Date(b.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const dateStr = new Date(b.created_at).toLocaleDateString([], { day: "2-digit", month: "2-digit" });
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 8, background: "var(--surface-soft)", border: "1px solid var(--border)", fontSize: 12, gap: 6 }}>
                    <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{dateStr} {timeStr}</span>
                    <span style={{ color: BASAL_INDIGO, fontWeight: 700, fontFamily: "var(--font-mono)", marginLeft: "auto", flexShrink: 0 }}>{b.units.toFixed(1)} IE</span>
                  </div>
                );
              })
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>{t("iob_basal_no_log")}</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", borderTop: "1px solid var(--border)", paddingTop: 7 }}>
              {t("iob_basal_dia_info", { brand: insulinBrandBasal?.trim() || t("iob_tab_basal") })}
            </div>
          </div>
        ) : (
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
            {t("iob_dia_info", {
              minutes: diaMin,
              type: [insulinTypeLabel, insulinBrandBolus2?.trim()].filter(Boolean).join(" + "),
            })}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
