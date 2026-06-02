"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { calcTotalIOB, calcSingleIOB, getDIAMinutes, buildDoses, calcBasalRemaining, calcBasalFraction, resolveBolusTypeLabel, resolveBasalTypeLabel, type BolusDose, type InsulinType } from "@/lib/iob";
import { getInsulinSettings } from "@/lib/userSettings";
import { DEFAULT_BASAL_WINDOW_H } from "@/lib/engine/constants";
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
  /** Called when the user taps the "Log Basal" quick-action button on the
   *  basal view. The parent is responsible for opening the log form. */
  onLogBasal?: () => void;
  /** Called when the user taps the "+ Bolus loggen" chip on the bolus view.
   *  The parent is responsible for opening the bolus log form. */
  onLogBolus?: () => void;
}

export default function IOBCard({ insulin, insulinType, meals, currentBg, onLogBasal, onLogBolus }: Props) {
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

  // Peak IOB = total units from all still-active doses.
  // At the moment of injection IOB equals the full dose amount, so the
  // fraction iob / peakIOB correctly reflects how much of the original
  // dose is still on board (e.g. 1.5 IE remaining of 2 IE injected → 75%).
  const peakIOB = activeDoses.reduce((sum, d) => sum + d.units, 0);
  const bolusFraction = peakIOB > 0 ? Math.min(iob / peakIOB, 1) : 0;

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
  const insulinTypeLabel = resolveBolusTypeLabel(
    insulinBrandBolus,
    insulinType,
    t("iob_dia_rapid"),
    t("iob_dia_regular"),
  );

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

  // User-configured basal action window (hours) — falls back to 24h when
  // unset. Mirrors `user_settings.basal_action_window_h` via getInsulinSettings().
  const basalWindowH = useMemo(
    () => getInsulinSettings().basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H,
    [],
  );
  const BASAL_WINDOW_MIN = basalWindowH * 60;
  const basalElapsedMin = lastBasal
    ? (now - new Date(lastBasal.created_at).getTime()) / 60_000
    : null;
  // Ring fill: linear decay from 1.0 (freshly injected) to 0.0 (window
  // expired). Shows the user exactly how much of their action window is left.
  const basalFraction   = basalElapsedMin !== null
    ? calcBasalFraction(basalElapsedMin, BASAL_WINDOW_MIN)
    : 0;
  const basalOverdue    = basalElapsedMin !== null && basalElapsedMin > BASAL_WINDOW_MIN;
  // Approximate remaining basal units using linear decay over the 24h window.
  const basalRemaining  = lastBasal && basalElapsedMin !== null
    ? calcBasalRemaining(lastBasal.units, basalElapsedMin, BASAL_WINDOW_MIN)
    : null;
  // Treat < 0.1 IE as fully decayed — avoid displaying a confusingly tiny number.
  const basalDecayed    = basalRemaining !== null && basalRemaining < 0.1;
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
                <CircleGauge iob={iob} color={color} cleared={cleared} fraction={bolusFraction} />
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
                {onLogBolus && !cleared && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onLogBolus(); }}
                    style={{
                      alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                      border: `1px solid ${color}44`,
                      background: `${color}10`,
                      color,
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                      touchAction: "manipulation",
                    }}
                  >
                    + {t("iob_log_bolus_btn")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Basal gauge — shrinks with elapsed Wirkdauer.
                  fraction prop is bound to basalFraction so the ring acts as a
                  depletion meter: full = fresh injection, empty = window expired.
                  The number inside always shows the originally injected dose
                  (lastBasal.units), not a residual value. */}
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
                    fontSize: lastBasal ? 20 : 18, fontWeight: 800, lineHeight: 1,
                    fontFamily: "var(--font-mono)",
                    color: lastBasal ? basalColor : "var(--text-ghost)",
                    textShadow: lastBasal && !basalOverdue && !basalDecayed ? `0 0 18px ${BASAL_INDIGO}77` : "none",
                  }}>
                    {lastBasal
                      ? lastBasal.units.toFixed(1)
                      : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
                </div>
              </div>

              {/* Basal info */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", fontWeight: 700 }}>
                  {resolveBasalTypeLabel(insulinBrandBasal, t("iob_tab_basal")).toUpperCase()}
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
                    {onLogBasal && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onLogBasal(); }}
                        style={{
                          alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99,
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                          border: `1px solid ${BASAL_INDIGO}44`,
                          background: `${BASAL_INDIGO}10`,
                          color: BASAL_INDIGO,
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                          touchAction: "manipulation",
                        }}
                      >
                        + {t("iob_log_basal_btn")}
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 99,
                      fontSize: 11, fontWeight: 700,
                      background: "var(--surface-soft)", color: "var(--text-ghost)", letterSpacing: "0.04em",
                    }}>
                      {t("iob_basal_no_log")}
                    </span>
                    {onLogBasal && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onLogBasal(); }}
                        style={{
                          padding: "3px 12px", borderRadius: 99,
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                          border: `1px solid ${BASAL_INDIGO}55`,
                          background: `${BASAL_INDIGO}18`,
                          color: BASAL_INDIGO,
                          cursor: "pointer",
                          WebkitTapHighlightColor: "transparent",
                          touchAction: "manipulation",
                        }}
                      >
                        + {t("iob_log_basal_btn")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Basal disclaimer — ganz unten in der kompakten Karte */}
        {view === "basal" && lastBasal && (
          <div style={{
            fontSize: 9, color: "var(--text-ghost)", lineHeight: 1.3,
            borderTop: "1px solid var(--border)", paddingTop: 6,
            textAlign: "center",
          }}>
            {t("iob_basal_approx_note")}
          </div>
        )}
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
          /* ── Basal expanded detail — coverage bar + context ── */
          <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px 14px", display: "flex", flexDirection: "column", gap: 11 }}>

            {/* Section header */}
            <div style={{ fontSize: 11, color: basalOverdue ? ORANGE : BASAL_INDIGO, letterSpacing: "0.1em", fontWeight: 700 }}>
              {t("iob_basal_coverage_title").toUpperCase()}
            </div>

            {lastBasal ? (
              <>
                {/* Coverage bar: left = elapsed (dim), right = remaining (indigo) */}
                {(() => {
                  const elapsedPct = Math.min(100, (basalElapsedMin ?? 0) / BASAL_WINDOW_MIN * 100);
                  return (
                    <div style={{ position: "relative", height: 10, borderRadius: 99, background: "var(--surface-soft)", overflow: "visible" }}>
                      {/* elapsed portion */}
                      <div style={{
                        position: "absolute", left: 0, top: 0, bottom: 0,
                        width: `${elapsedPct}%`,
                        background: basalOverdue ? `${ORANGE}40` : `${BASAL_INDIGO}28`,
                        borderRadius: 99,
                      }} />
                      {/* remaining portion */}
                      {!basalOverdue && (
                        <div style={{
                          position: "absolute", right: 0, top: 0, bottom: 0,
                          width: `${100 - elapsedPct}%`,
                          background: `${BASAL_INDIGO}70`,
                          borderRadius: 99,
                        }} />
                      )}
                      {/* current-position needle */}
                      <div style={{
                        position: "absolute", top: -3, bottom: -3,
                        left: `${elapsedPct}%`,
                        width: 3,
                        background: basalOverdue ? ORANGE : BASAL_INDIGO,
                        borderRadius: 2,
                        transform: "translateX(-50%)",
                        boxShadow: `0 0 6px ${basalOverdue ? ORANGE : BASAL_INDIGO}99`,
                      }} />
                    </div>
                  );
                })()}

                {/* Time labels below bar */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-dim)" }}>
                    vor {basalElapsedH}h {basalElapsedM}min
                  </span>
                  {basalOverdue ? (
                    <span style={{ color: ORANGE, fontWeight: 700 }}>{t("iob_basal_overdue")}</span>
                  ) : (
                    <span style={{ color: BASAL_INDIGO, fontWeight: 600 }}>
                      ~{basalNextInH}h {t("iob_basal_remaining")}
                    </span>
                  )}
                </div>

                {/* Last dose row + brand chip */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Injected (original) dose — reference row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                      {t("iob_basal_injected_label")}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, fontFamily: "var(--font-mono)", textAlign: "right" }}>
                      {lastBasal.units.toFixed(1)} IE
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
                      {t("iob_basal_last_label")}
                    </span>
                    <span style={{ fontSize: 12, color: BASAL_INDIGO, fontWeight: 700, fontFamily: "var(--font-mono)", textAlign: "right" }}>
                      {new Date(lastBasal.created_at).toLocaleDateString([], { day: "2-digit", month: "2-digit" })}{" "}
                      {new Date(lastBasal.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div>
                    <span style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: 99,
                      background: `${BASAL_INDIGO}18`, color: BASAL_INDIGO,
                      fontSize: 11, fontWeight: 600,
                    }}>
                      {resolveBasalTypeLabel(insulinBrandBasal, t("iob_tab_basal"))}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 4 }}>
                <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>{t("iob_basal_no_log")}</span>
              </div>
            )}
          </div>
        ) : (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "14px 16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          {/* Section header */}
          <div style={{
            fontSize: 11,
            color: cleared ? "var(--text-dim)" : color,
            letterSpacing: "0.1em", fontWeight: 700,
          }}>
            {t("iob_basal_coverage_title").toUpperCase()}
          </div>

          {/* Coverage bar — same layout as basal */}
          {!cleared && clearsInMin > 0 ? (() => {
            const bolusElapsedMin = diaMin - clearsInMin;
            const elapsedPct = Math.min(100, Math.max(0, (bolusElapsedMin / diaMin) * 100));
            const elapsedH = Math.floor(bolusElapsedMin / 60);
            const elapsedM = bolusElapsedMin % 60;
            const clearsInH = Math.floor(clearsInMin / 60);
            const clearsInMRem = clearsInMin % 60;
            return (
              <>
                <div data-testid="iob-wirkdauer-bar" style={{ position: "relative", height: 10, borderRadius: 99, background: "var(--surface-soft)", overflow: "visible" }}>
                  {/* elapsed portion */}
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${elapsedPct}%`,
                    background: `${color}28`,
                    borderRadius: 99,
                  }} />
                  {/* remaining portion */}
                  <div style={{
                    position: "absolute", right: 0, top: 0, bottom: 0,
                    width: `${100 - elapsedPct}%`,
                    background: `${color}70`,
                    borderRadius: 99,
                  }} />
                  {/* current-position needle */}
                  <div style={{
                    position: "absolute", top: -3, bottom: -3,
                    left: `${elapsedPct}%`,
                    width: 3,
                    background: color,
                    borderRadius: 2,
                    transform: "translateX(-50%)",
                    boxShadow: `0 0 6px ${color}99`,
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-dim)" }}>
                    vor {elapsedH}h {elapsedM}min
                  </span>
                  <span style={{ color, fontWeight: 600 }}>
                    ~{clearsInH > 0 ? `${clearsInH}h ${clearsInMRem}min` : `${clearsInMin}min`} {t("iob_basal_remaining")}
                  </span>
                </div>
              </>
            );
          })() : (
            <div data-testid="iob-wirkdauer-cleared" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>
                {t("iob_no_active_doses")}
              </span>
            </div>
          )}

          {/* Active dose list */}
          {activeDoses.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
              {activeDoses
                .slice()
                .sort((a, b) =>
                  new Date(b.administeredAt).getTime() - new Date(a.administeredAt).getTime()
                )
                .map((d, i) => {
                  const singleIOB    = calcSingleIOB(d, now, diaMin);
                  const timeStr      = new Date(d.administeredAt).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit",
                  });
                  const doseElapsedMin = Math.max(0, (now - new Date(d.administeredAt).getTime()) / 60_000);
                  const doseElapsedPct = Math.min(100, (doseElapsedMin / diaMin) * 100);
                  const doseCleared    = doseElapsedMin >= diaMin;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex", flexDirection: "column",
                        padding: "6px 8px 7px", borderRadius: 8,
                        background: "var(--surface-soft)",
                        border: "1px solid var(--border)",
                        fontSize: 12, gap: 5,
                      }}
                    >
                      {/* text row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                          color: doseCleared ? "var(--text-ghost)" : color,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          marginLeft: "auto", flexShrink: 0,
                        }}>
                          {t("iob_dose_remaining", { units: singleIOB.toFixed(1) })}
                        </span>
                      </div>
                      {/* per-dose Wirkdauer bar */}
                      <div style={{ position: "relative", height: 4, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{
                          position: "absolute", left: 0, top: 0, bottom: 0,
                          width: `${doseElapsedPct}%`,
                          background: doseCleared ? "var(--text-ghost)" : `${color}50`,
                          borderRadius: 99,
                        }} />
                        {!doseCleared && (
                          <div style={{
                            position: "absolute", right: 0, top: 0, bottom: 0,
                            width: `${100 - doseElapsedPct}%`,
                            background: `${color}cc`,
                            borderRadius: 99,
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
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
