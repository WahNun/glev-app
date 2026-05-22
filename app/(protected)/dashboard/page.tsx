"use client";

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import RefreshingBar from "@/components/RefreshingBar";
import { useRouter } from "next/navigation";
import { fetchMeals, computeCalories, unifiedOutcome, type Meal } from "@/lib/meals";
import { computeControlScore } from "@/lib/controlScore";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { type InsulinType } from "@/lib/iob";
import IOBCard from "@/components/IOBCard";
import IOBHistoryChart from "@/components/IOBHistoryChart";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import { evaluateExercise, exerciseTypeLabelI18n } from "@/lib/exerciseEval";
import { fetchMacroTargets, DEFAULT_MACRO_TARGETS, type MacroTargets, getTargetRange, fetchTargetRange, type TargetRange, fetchInsulinType } from "@/lib/userSettings";
import { fetchCgmSamples } from "@/lib/cgmSamplesClient";
import { TYPE_COLORS, getEvalColor, chipLabelsFrom } from "@/lib/mealTypes";
import DashboardQuickAddSheet from "@/components/DashboardQuickAddSheet";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import MealEntryLightExpand from "@/components/MealEntryLightExpand";
import PendingGlucoseStrip from "@/components/PendingGlucoseStrip";
import CurrentDayGlucoseCard from "@/components/CurrentDayGlucoseCard";
import GlucoseTrendFront from "@/components/GlucoseTrendChart";
import MacroRing from "@/components/MacroRing";
import SkeletonBlock from "@/components/SkeletonBlock";
import GlevLogo from "@/components/GlevLogo";
import { hapticSelection } from "@/lib/haptics";
import { parseDbDate, parseDbTs, localeToBcp47 } from "@/lib/time";
import { useLocale, useTranslations } from "next-intl";
import { isToday, startOfDaysAgo } from "@/lib/utils/datetime";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCardOrder } from "@/lib/cardOrder";
import PagerIndicator from "@/components/PagerIndicator";

// Four-cluster cockpit layout (replaces the earlier 5-cluster "widget
// wall"). Order is intentionally staged: Glucose is the primary
// instrument at the top, Metabolic merges the meal-response group
// (macros + outcome distribution + good/spike/hypo rates) into a
// single horizontally-swipeable card stack, Control combines the
// score with the trend chart so the two analytical readouts live
// together, and Recents stays as the chronological tail. Users can
// still reorder via the grip handle in each cluster header — the
// `useCardOrder` hook silently drops unknown saved IDs from the
// pre-refactor era ("macros", "rates", "score-trend") and appends
// any cluster the saved list doesn't mention, so existing users
// migrate gracefully without us having to touch their preferences.
const DASHBOARD_CLUSTER_DEFAULT_ORDER = ["glucose", "metabolic", "control", "recents"];

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="var(--surface)", BORDER="var(--border)";

interface CardData {
  key: string; label: string; color: string;
  value: string;          // displayed value (e.g. "30")
  unit: string;           // unit appended (e.g. "/100" or "%")
  bar: number;            // progress 0..100
  sub: string;            // contextual caption (e.g. "15 entries", "3 good")
  formula: string; explanation: string; interpretation: string;
}

type DashT = (key: string, values?: Record<string, string | number>) => string;
function buildCards(meals: Meal[], t: DashT): CardData[] {
  // Unified outcome bucketing — each meal lands in EXACTLY one of
  // GOOD / SPIKE / HYPO / OTHER (no double-counting). UNDERDOSE used
  // to leak into both spike AND hypo buckets in older code; the
  // unified resolver below makes that impossible by giving each row
  // a single canonical outcome string. OTHER (null, legacy unknown)
  // is excluded from numerator and denominator so a
  // pending meal never drags the score down.
  const total = meals.length;
  let good = 0, spike = 0, hypo = 0;
  for (const m of meals) {
    const ev = unifiedOutcome(m);
    if      (ev === "GOOD") good++;
    else if (ev === "SPIKE" || ev === "SPIKE_STRONG" || ev === "UNDERDOSE" || ev === "LOW") spike++;
    else if (ev === "OVERDOSE" || ev === "HIGH") hypo++;
  }
  const goodRate  = total ? (good / total) * 100 : 0;
  const spikeRate = total ? (spike / total) * 100 : 0;
  const hypoRate  = total ? (hypo / total) * 100 : 0;
  // Spec formula: weight the GOOD-rate (0.7) plus the inverse of the
  // combined spike+hypo rate (0.3), clamped to 0..100. UNDERDOSE only
  // shows up in `spike`, so it penalises the score exactly once.
  const rawScore  = goodRate * 0.7 + (100 - spikeRate - hypoRate) * 0.3;
  const score     = total ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  return [
    {
      key:"control", label:t("control_score_label"), color:ACCENT,
      value: total ? score.toString() : "—", unit: "/100",
      bar: score,
      sub: t("entries_7d", { n: total }),
      formula: t("control_score_formula"),
      explanation: t("control_score_explain"),
      interpretation: "",
    },
    {
      key:"good", label:t("good_label"), color:GREEN,
      value: total ? goodRate.toFixed(1) : "—", unit: "%",
      bar: goodRate,
      sub: t("good_sub", { n: good }),
      formula: t("good_formula"),
      explanation: t("good_explanation"),
      interpretation: t("good_interpretation"),
    },
    {
      key:"spike", label:t("spike_label"), color:ORANGE,
      value: total ? spikeRate.toFixed(1) : "—", unit: "%",
      bar: spikeRate,
      sub: t("spike_sub"),
      formula: t("spike_formula"),
      explanation: t("spike_explanation"),
      interpretation: t("spike_interpretation"),
    },
    {
      key:"hypo", label:t("hypo_label"), color:PINK,
      value: total ? hypoRate.toFixed(1) : "—", unit: "%",
      bar: hypoRate,
      sub: t("hypo_sub"),
      formula: t("hypo_formula"),
      explanation: t("hypo_explanation"),
      interpretation: t("hypo_interpretation"),
    },
  ];
}

/**
 * Compact 3-up row showing the Good / Spike / Hypo rate cards as a
 * single horizontal triplet — the layout the user requested back on
 * the dashboard (screenshot 2026-05-17). Replaces the previous
 * per-card horizontal pager so all three rates are visible at once
 * without swiping. Colour tokens stay aligned with the FlipCard
 * backs and the Outcome distribution (GREEN/ORANGE/PINK).
 */
function RateTripletCard({ cards }: { cards: CardData[] }) {
  const t = useTranslations("dashboard");
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position: "relative", perspective: 1200, cursor: "pointer", minHeight: 140 }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          minHeight: 140,
        }}
      >
        {/* ── FRONT ── */}
        <div
          className="glev-stat-card"
          style={{
            background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
            padding: 10, boxSizing: "border-box",
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden",
          }}
        >
          {cards.map(c => (
            <div key={c.key} style={{
              background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
              borderRadius: 12, padding: "12px 12px 10px", boxSizing: "border-box",
              display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
            }}>
              <div style={{
                fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em",
                fontWeight: 700, textTransform: "uppercase", lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{c.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                <span style={{
                  fontSize: 30, fontWeight: 800, color: c.color,
                  letterSpacing: "-0.02em", lineHeight: 1,
                  fontFamily: "var(--font-mono)",
                }}>{c.value}</span>
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{c.unit}</span>
              </div>
              <div style={{
                fontSize: 11, color: "var(--text-faint)", lineHeight: 1.25,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── BACK ── */}
        <div
          style={{
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14,
            padding: "14px 14px 12px", boxSizing: "border-box",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          {/* Back header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              fontSize: 11, color: "var(--text-dim)",
              letterSpacing: "0.1em", fontWeight: 700,
            }}>
              {t("rate_triplet_back_title").toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>

          {/* What the rates mean */}
          <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.5, flex: 1 }}>
            {t("rate_triplet_back_body")}
          </div>

          {/* How they're calculated */}
          <div style={{
            fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45,
            padding: "7px 10px",
            background: "var(--surface-soft)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}>
            {t("rate_triplet_back_how")}
          </div>

          {/* Disclaimer — always visible */}
          <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4 }}>
            {t("iob_bg_hint")}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlipCard({ card }: { card: CardData }) {
  const [flipped, setFlipped] = useState(false);
  const t = useTranslations("dashboard");
  return (
    <div onClick={() => setFlipped(f => !f)} className="glev-stat-card" style={{ position:"relative", cursor:"pointer", height:140, perspective:1000 }}>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* Front */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px 18px", boxSizing:"border-box", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
            <div style={{ fontSize:12, color:"var(--text-dim)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase" }}>{card.label}</div>
            <span style={{ fontSize:11, color:"var(--text-ghost)" }}>↺</span>
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:8 }}>
            <div style={{ display:"flex", alignItems:"flex-end", gap:4 }}>
              <span style={{ fontSize:56, fontWeight:800, color:card.color, letterSpacing:"-0.03em", lineHeight:1, fontFamily:"var(--font-mono)" }}>{card.value}</span>
              <span style={{ fontSize:14, color:"var(--text-faint)", paddingBottom:3 }}>{card.unit}</span>
            </div>
            <span style={{ fontSize:13, color:"var(--text-faint)" }}>{card.sub}</span>
          </div>
          <div style={{ height:4, background:"var(--surface-soft)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${Math.min(Math.max(card.bar, 0), 100)}%`, height:"100%", background:card.color, borderRadius:99, transition:"width 0.6s ease" }}/>
          </div>
        </div>
        {/* Back */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg,${card.color}12,${SURFACE} 65%)`, border:`1px solid ${card.color}33`, borderRadius:14, padding:"12px 16px", boxSizing:"border-box", overflow:"hidden", display:"flex", flexDirection:"column", gap:6, justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:12, color:card.color, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{card.label}</div>
            <span style={{ fontSize:11, color:"var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>
          <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:1.45, fontFamily:"var(--font-mono)" }}>{card.formula}</div>
          <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.4 }}>{card.explanation.slice(0,110)}…</div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ meals }: { meals: Meal[] }) {
  const DAYS = 14;
  const [flipped, setFlipped] = useState(false);
  const t = useTranslations("dashboard");
  // Personal TIR band (user_settings.target_min_mgdl /
  // target_max_mgdl, Migration 20260517). Was hardcoded 80–180 here,
  // which mismatched Insights + Today's Summary (both 70–180) so the
  // same user saw three different TIR percentages on three cards. Now
  // every card reads the same user-saved band.
  const [trendRange, setTrendRange] = useState<TargetRange>(() => getTargetRange());
  useEffect(() => { fetchTargetRange().then(setTrendRange).catch(() => {}); }, []);
  // CGM samples for the last 7 days — these are the dense readings the
  // Insights TIR card already uses (288/day vs ~3 meal pre-glucose
  // values/day), so anchoring TIR here on them brings the Dashboard
  // Trend Breakdown into agreement with Insights. Falls back to the
  // sparse meal pre-glucose set when the user has no CGM connected so
  // the tile never reads "—%" for non-CGM users.
  const [cgm7d, setCgm7d] = useState<Array<{ v: number }>>([]);
  useEffect(() => {
    const to = Date.now();
    const from = to - 7 * 86400000;
    fetchCgmSamples(from, to).then(s => setCgm7d(s)).catch(() => {});
  }, []);
  const now = Date.now();
  const buckets: Record<string, number[]> = {};
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(now - (DAYS-1-i) * 86400000);
    buckets[d.toDateString()] = [];
  }
  meals.forEach(m => {
    const d = parseDbDate(m.created_at).toDateString();
    if (d in buckets && m.glucose_before) buckets[d].push(m.glucose_before);
  });
  const points = Object.values(buckets).map(arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null);

  // Front-face hi/lo + 7-day stats are also rendered by the shared
  // GlucoseTrendFront, but we recompute them here for the BACK face's
  // "Trend Breakdown" tiles.
  type Pt = { i: number; v: number };
  const realPts: Pt[] = [];
  points.forEach((v, i) => { if (v != null) realPts.push({ i, v }); });
  const hiPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loPt: Pt | null = realPts.length ? realPts.reduce((a, b) => (b.v < a.v ? b : a)) : null;

  // Back: weekday averages + 7-day trend slope
  const weekdayBuckets: number[][] = Array.from({ length: 7 }, () => []);
  const weekdayLabels = [
    t("weekday_short_sun"), t("weekday_short_mon"), t("weekday_short_tue"),
    t("weekday_short_wed"), t("weekday_short_thu"), t("weekday_short_fri"),
    t("weekday_short_sat"),
  ];
  meals.forEach(m => {
    if (!m.glucose_before) return;
    const ts = parseDbDate(m.created_at);
    if (now - ts.getTime() > 30 * 86400000) return;
    weekdayBuckets[ts.getDay()].push(m.glucose_before);
  });
  const weekdayAvgs = weekdayBuckets.map(arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null));
  const real = points.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  const last7 = real.slice(-7);
  let slope = 0;
  if (last7.length >= 2) {
    const xs = last7.map(p => p.i);
    const ys = last7.map(p => p.v);
    const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let k = 0; k < xs.length; k++) { num += (xs[k] - xm) * (ys[k] - ym); den += (xs[k] - xm) ** 2; }
    slope = den ? num / den : 0;
  }
  const recentAvg = last7.length ? Math.round(last7.reduce((s, p) => s + p.v, 0) / last7.length) : null;
  const overallAvg = real.length ? Math.round(real.reduce((s, p) => s + p.v, 0) / real.length) : null;
  // Prefer dense CGM samples (288/day) for the TIR percentage when
  // the user has a CGM connected — this matches Insights so the two
  // surfaces now agree. Fall back to the **raw** 7-day meal
  // pre-glucose readings (not the daily-averaged `real` series — that
  // would silently smooth out a single in-range day across many spikes
  // and inflate TIR) so non-CGM users still see a meaningful number.
  const rawMealPreGlu7d: number[] = [];
  meals.forEach(m => {
    if (typeof m.glucose_before !== "number") return;
    const ts = parseDbDate(m.created_at).getTime();
    if (now - ts > 7 * 86400000) return;
    rawMealPreGlu7d.push(m.glucose_before);
  });
  const tirSource = cgm7d.length > 0 ? cgm7d.map(s => s.v) : rawMealPreGlu7d;
  const tirDenom  = tirSource.length;
  const tirInRange = tirSource.filter(v => v >= trendRange.low && v <= trendRange.high).length;
  const tirPct = tirDenom > 0 ? Math.round((tirInRange / tirDenom) * 100) : 0;

  // Card height: a bit taller on mobile so the chart stays comfortably
  // readable when stacked under the stat tiles.
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      className="glev-trend-card"
      style={{ position:"relative", perspective:1200, cursor:"pointer" }}
    >
      <style>{`
        .glev-trend-card { height: 240px; }
        @media (max-width: 768px) {
          .glev-trend-card { height: 220px; }
        }
      `}</style>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* FRONT */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <GlucoseTrendFront meals={meals} />
        </div>
        {/* BACK */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg, ${ACCENT}10, ${SURFACE} 65%)`, border:`1px solid ${ACCENT}33`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", gap:14, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:13, color:ACCENT, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{t("trend_breakdown")}</div>
            <span style={{ fontSize:11, color:"var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            {[
              { l:t("trend_overall_avg"), v: overallAvg ? `${overallAvg} mg/dL` : "—", c: overallAvg ? (overallAvg>140?ORANGE:overallAvg<80?PINK:GREEN) : undefined },
              { l:t("trend_7day_avg"), v: recentAvg ? `${recentAvg} mg/dL` : "—", c: recentAvg ? (recentAvg>140?ORANGE:recentAvg<80?PINK:GREEN) : undefined },
              { l:t("trend_tir_label"), v: tirDenom > 0 ? `${tirPct}%` : "—", c: tirPct>=70?GREEN:tirPct>=50?ORANGE:PINK },
              { l:t("trend_highest"), v: hiPt ? `${Math.round(hiPt.v)} mg/dL` : "—", c: ORANGE },
              { l:t("trend_lowest"), v: loPt ? `${Math.round(loPt.v)} mg/dL` : "—", c: PINK },
              { l:t("trend_7day_slope"), v: last7.length>=2 ? `${slope>0?"+":""}${slope.toFixed(1)}${t("trend_slope_per_day")}` : "—", c: Math.abs(slope)<2 ? GREEN : slope>0 ? ORANGE : ACCENT },
            ].map(s => (
              <div key={s.l} style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.07em", fontWeight:600, marginBottom:4, textTransform:"uppercase" }}>{s.l}</div>
                <div style={{ fontSize:14, fontWeight:700, color:s.c || "var(--text-strong)", letterSpacing:"-0.01em" }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ fontSize:12, color:"var(--text-dim)", letterSpacing:"0.07em", fontWeight:600, marginBottom:8, textTransform:"uppercase" }}>{t("trend_by_weekday")}</div>
            <div style={{ display:"flex", gap:6, flex:1, alignItems:"flex-end" }}>
              {weekdayAvgs.map((v, i) => {
                const h = v == null ? 8 : Math.max(8, Math.min(100, ((v - 60) / (240 - 60)) * 100));
                const c = v == null ? "var(--border-strong)" : v > 140 ? ORANGE : v < 80 ? PINK : GREEN;
                return (
                  <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, height:"100%", justifyContent:"flex-end" }}>
                    <div style={{ fontSize:12, fontWeight:700, color: v == null ? "var(--text-ghost)" : c }}>{v ?? "—"}</div>
                    <div style={{ width:"100%", maxWidth:32, height:`${h}%`, background:c, opacity: v == null ? 0.4 : 0.85, borderRadius:6, transition:"height 0.4s ease" }}/>
                    <div style={{ fontSize:11, color:"var(--text-dim)" }}>{weekdayLabels[i]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutcomeChart({ meals }: { meals: Meal[] }) {
  const [flipped, setFlipped] = useState(false);
  const t = useTranslations("dashboard");
  const groups: Array<{ key:string; color:string; label:string; description:string; count:number }> = [
    { key:"GOOD",  color:GREEN,     label:t("outcome_good"),      description:t("outcome_good_desc"),  count:0 },
    { key:"LOW",   color:ORANGE,    label:t("outcome_underdose"), description:t("outcome_under_desc"), count:0 },
    { key:"HIGH",  color:PINK,      label:t("outcome_overdose"),  description:t("outcome_over_desc"),  count:0 },
    { key:"SPIKE", color:"#FF9F0A", label:t("outcome_spike"),     description:t("outcome_spike_desc"), count:0 },
  ];
  const idx = Object.fromEntries(groups.map((g, i) => [g.key, i])) as Record<string, number>;
  meals.forEach(m => {
    const ev = m.evaluation || "";
    if (ev === "OVERDOSE" || ev === "HIGH") groups[idx.HIGH].count++;
    else if (ev === "UNDERDOSE" || ev === "LOW") groups[idx.LOW].count++;
    else if (ev === "SPIKE" || ev === "SPIKE_STRONG") groups[idx.SPIKE].count++;
    else if (ev === "GOOD") groups[idx.GOOD].count++;
  });
  const total = meals.length || 1;
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      className="glev-outcome-card glev-flip-card"
      style={{ position:"relative", perspective:1200, cursor:"pointer" }}
    >
      <style>{`
        .glev-outcome-card { height: 280px; }
        @media (max-width: 768px) {
          .glev-outcome-card { height: 300px; }
        }
      `}</style>
      <div style={{ position:"absolute", inset:0, transformStyle:"preserve-3d", transition:"transform 0.55s cubic-bezier(0.4,0,0.2,1)", transform:flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        {/* FRONT */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* 2026-05-17 round 7: heading now mirrors the BACK side's
              accent-coloured uppercase eyebrow so the flip feels like
              two views of the same card instead of two different cards.
              The "alltime" caption stays underneath as the contextual
              subtitle. */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:13, color:ACCENT, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{t("outcome_dist")}</div>
            <span style={{ fontSize:11, color:"var(--text-ghost)" }}>{t("flip_hint_short")}</span>
          </div>
          <div style={{ fontSize:12, color:"var(--text-faint)", marginTop:4 }}>{t("outcome_alltime")}</div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", gap:14 }}>
            {groups.map(g => {
              const pct = Math.round((g.count/total)*100);
              return (
                <div key={g.label}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:13, color:"var(--text-dim)" }}>{g.label}</span>
                    <span style={{ fontSize:13, fontWeight:600, color:g.color }}>{g.count} <span style={{ color:"var(--text-faint)", fontWeight:400 }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height:6, borderRadius:99, background:"var(--border-soft)", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:g.color, borderRadius:99, transition:"width 0.8s ease" }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* BACK */}
        <div style={{ position:"absolute", inset:0, backfaceVisibility:"hidden", transform:"rotateY(180deg)", background:`linear-gradient(145deg, ${ACCENT}10, ${SURFACE} 65%)`, border:`1px solid ${ACCENT}33`, borderRadius:16, padding:"20px 24px", boxSizing:"border-box", display:"flex", flexDirection:"column", gap:12, overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:13, color:ACCENT, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>{t("outcome_what_means")}</div>
            <span style={{ fontSize:11, color:"var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10, justifyContent:"center" }}>
            {groups.map(g => (
              <div key={g.key} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ width:8, height:8, borderRadius:99, background:g.color, flexShrink:0, marginTop:5 }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:g.color, lineHeight:1.2, marginBottom:2 }}>{g.label}</div>
                  <div style={{ fontSize:12.5, color:"var(--text-muted)", lineHeight:1.4 }}>{g.description}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:11.5, color:"var(--text-faint)", lineHeight:1.4, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
            {t("outcome_basis")}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const dateLocale = localeToBcp47(useLocale());
  const t = useTranslations("dashboard");
  const tQuick = useTranslations("quickAdd");
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulin, setInsulin] = useState<InsulinLog[]>([]);
  const [exercise, setExercise] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-user macro goals powering the "Today's Macros" rings. Loaded once
  // on mount from user_settings; falls back to sensible Type-1 defaults so
  // the rings always render even before the row exists or for signed-out
  // SSR. Edited via Settings → "Daily Macro Targets".
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  const [insulinType, setInsulinType]   = useState<InsulinType>("rapid");
  // Latest CGM reading — used by IOBCard to show expected BG drop.
  // Fetched independently here so DashboardPage owns the value;
  // TrendChart has its own copy for TIR calculation (no prop-drilling).
  const [latestCgmBg, setLatestCgmBg] = useState<number | undefined>(undefined);
  // Bottom-sheet/modal listing all quick-log entry points (mirrors the
  // header "+" QuickAddMenu). Opened by the dashboard hero "+" button.
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
    fetchInsulinType().then(setInsulinType).catch(() => {});
  }, []);

  useEffect(() => {
    const to = Date.now();
    const from = to - 3 * 3600000; // last 3 h is enough for the latest reading
    fetchCgmSamples(from, to).then(s => {
      if (s.length > 0) setLatestCgmBg(s[s.length - 1].v);
    }).catch(() => {});
  }, []);

  // SWR-backed cached fetch of meals + insulin + exercise. The
  // SWRProvider in app/(protected)/layout.tsx persists this cache to
  // localStorage so a re-mount (back navigation, tab switch on native
  // shell) renders the previous data instantly while we revalidate in
  // the background. We hydrate the existing useState mirrors so all
  // downstream optimistic updates (e.g. RecentEntries → onMealUpdated
  // calling setMeals) keep working untouched.
  const { data: dashSWR, isValidating: dashValidating } = useSWR(
    "dashboard:meals+insulin60+exercise60",
    async () => {
      const [m, ins, ex] = await Promise.all([
        fetchMeals(),
        fetchRecentInsulinLogs(60).catch(() => [] as InsulinLog[]),
        fetchRecentExerciseLogs(60).catch(() => [] as ExerciseLog[]),
      ]);
      return { meals: m, insulin: ins, exercise: ex };
    },
  );

  useEffect(() => {
    if (!dashSWR) return;
    setMeals(dashSWR.meals);
    setInsulin(dashSWR.insulin);
    setExercise(dashSWR.exercise);
    setLoading(false);
  }, [dashSWR]);

  useEffect(() => {
    function onUpdated() { swrMutate("dashboard:meals+insulin60+exercise60"); }
    window.addEventListener("glev:meals-updated",    onUpdated);
    window.addEventListener("glev:insulin-updated",  onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    return () => {
      window.removeEventListener("glev:meals-updated",    onUpdated);
      window.removeEventListener("glev:insulin-updated",  onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
    };
  }, []);

  // Build a unified, time-sorted row list across all log types so the
  // 6 most recent entries are *actually* the most recent regardless of
  // kind. Each row carries its discriminator + raw record.
  const recentRows: RecentRow[] = useMemo(() => {
    const rows: RecentRow[] = [
      ...meals.map<RecentRow>(m => ({ kind: "meal", id: m.id, ts: m.meal_time ?? m.created_at, meal: m })),
      ...insulin.map<RecentRow>(i => ({ kind: i.insulin_type, id: i.id, ts: i.created_at, insulin: i })),
      ...exercise.map<RecentRow>(x => ({ kind: "exercise", id: x.id, ts: x.created_at, exercise: x })),
    ];
    rows.sort((a, b) => parseDbTs(b.ts) - parseDbTs(a.ts));
    return rows.slice(0, 10);
  }, [meals, insulin, exercise]);

  const totalEntries = meals.length + insulin.length + exercise.length;

  // Skeleton loading state — mirrors app/(protected)/dashboard/loading.tsx
  // so the visible UI never jumps when data arrives. Feels much faster
  // than the old centered spinner because the user sees the page shape
  // immediately instead of staring at a tiny spinner on a blank screen.
  if (loading) return (
    <div style={{ padding:"16px 16px 0", display:"flex", flexDirection:"column", gap:16 }}>
      <style>{`@keyframes glevPulse{0%,100%{opacity:.55}50%{opacity:.85}}`}</style>
      <SkeletonBlock height={56} />
      <SkeletonBlock height={180} />
      <SkeletonBlock height={140} />
      <SkeletonBlock height={140} />
      <SkeletonBlock height={220} />
    </div>
  );

  const cards = buildCards(meals, t);
  const rateCards = cards.filter(c => c.key !== "control");

  // Four-cluster cockpit layout (see DASHBOARD_CLUSTER_DEFAULT_ORDER
  // above for the rationale). Each cluster is a horizontal swipe pager
  // so the user moves laterally through related cards rather than
  // vertically through a widget wall.
  //
  // 1. Glucose      — Live CGM glucose paired with the multi-day
  //                   Glucose Trend chart so the two glucose-shaped
  //                   readouts live together in the primary instrument
  //                   cluster at the top of the screen.
  // 2. Metabolic    — Today's macros + Outcome distribution: the
  //                   meal-input and meal-response summary side by
  //                   side, separated from the per-outcome rates
  //                   below so this cluster stays focused on the
  //                   "what / how it landed" overview.
  // 3. Control      — Control Score as the lead card followed by the
  //                   Good / Spike / Hypo rate cards. The score is
  //                   the headline number; the rates are the
  //                   breakdown that explains it. Grouping them in
  //                   one cluster makes that relationship explicit.
  // 4. Recents      — Chronological tail.
  //
  // Reordering still works via the grip handle in each cluster header;
  // persisted per user via `useCardOrder("dashboard", …)`.
  const clusters: Array<{ id: string; title: string; cards: ClusterCard[] }> = [
    {
      id: "glucose",
      title: t("cluster_glucose"),
      cards: [
        { id: "today-glucose", node: <CurrentDayGlucoseCard/> },
        { id: "glucose-trend", node: <TrendChart meals={meals}/> },
      ],
    },
    {
      id: "metabolic",
      title: t("cluster_metabolic"),
      cards: [
        { id: "today-macros", node: <DailyMacrosCard meals={meals} targets={macroTargets}/> },
        { id: "outcome-dist", node: <OutcomeChart meals={meals}/> },
      ],
    },
    {
      id: "control",
      title: t("cluster_control"),
      cards: [
        { id: "control-score", node: <ControlScoreCard meals={meals}/> },
        { id: "iob",           node: <IOBCard insulin={insulin} insulinType={insulinType} meals={meals} currentBg={latestCgmBg}/> },
        { id: "iob-history",   node: <IOBHistoryChart insulin={insulin} insulinType={insulinType} meals={meals} /> },
        // rateCards = buildCards(...) minus the "control" entry —
        // shown as a single compact 3-up triplet (Good / Spike / Hypo)
        // so the breakdown is glanceable beneath the headline Control
        // Score without forcing the user to swipe one card at a time.
        { id: "rate-triplet", node: <RateTripletCard cards={rateCards}/> },
      ],
    },
    {
      id: "recents",
      title: t("cluster_recents"),
      cards: [{ id: "recent-entries", node: <RecentEntries rows={recentRows} locale={dateLocale} onViewAll={() => router.push("/entries")} onViewEntry={(id) => router.push(`/entries#${id}`)} onMealUpdated={(m) => setMeals(prev => prev.map(x => x.id === m.id ? m : x))}/> }],
    },
  ];

  return (
    <div style={{ maxWidth:1480, margin:"0 auto", width:"100%", overflowX:"hidden", boxSizing:"border-box" }}>
      <style>{`
        html, body { overflow-x: hidden; }
        .glev-dash-head { display: flex; }
        @media (max-width: 768px) {
          .glev-dash-head { display: none !important; }
        }
        /* Mobile compression — iPhone 13 mini (375×812) and similar.
           Goal: pull the glucose + metabolic + control clusters and
           the quick-add CTA into a single viewport without scrolling.
           We trim only inter-cluster gaps + CTA chrome, never the
           card content itself, so the data stays legible. */
        @media (max-width: 430px) {
          /* Dashboard-only override: pull the cluster cards closer to
             the screen edges so the cards themselves get wider. We
             intentionally don't change the global .glev-main rule in
             Layout.tsx (other pages keep their 16 px breathing room);
             this <style> block is unmounted when the user navigates
             away, so the override is scoped to the dashboard route.
             User request 2026-05-17: "Karten breiter, näher an die
             Ränder, gleichmäßiges Padding rundum". */
          .glev-main           { padding-left: 10px !important; padding-right: 10px !important; }
          /* 2026-05-18 user request: cards looked glued together —
             wanted the inter-card breathing room to match the gap
             between the header's bottom edge and the topmost
             Glucose-Live card (~16-18 px). Was 6 px which felt too
             tight after the cluster-bar was hidden on mobile. */
          .glev-cluster-stack  { gap: 16px !important; }
          .glev-cluster        { gap: 4px !important; }
          /* Hide the per-cluster bottom bar entirely on phones — both
             the pager-indicator line and the drag-handle dots — to free
             up ~28px between every cluster. Users still swipe each
             cluster horizontally to see the alternate card; on mobile
             the dashboard is also not reorder-driven. */
          .glev-cluster-bar    { display: none !important; }
          /* Floating-bubble FAB on phones: lift the quick-add button
             out of the cluster flow, pin it bottom-right above the
             mobile bottom-nav (56px nav + safe-area inset), make it a
             solid-accent circle so it reads as a primary action. The
             control cluster keeps its place; the button just stops
             taking layout space, freeing those ~50px for the score. */
          /* On phones the centre slot of the bottom nav is now the
             raised Glev-bubble (see MobileGlevFab in Layout.tsx) and
             opens the same quick-add sheet — so the inline dashboard
             CTA would be a duplicate. Hide it on mobile only; on
             desktop the wide pill under the control score stays. */
          .glev-quickadd-cta { display: none !important; }
          /* Equal 12 px on all four sides — was asymmetric
             (12/16/14 and 12/16/10) which gave the cards more
             horizontal padding than vertical and a slightly heavier
             bottom edge. User request 2026-05-17: "etwas niedriger,
             gleichmäßiges Padding auf allen 4 Seiten". */
          .glev-control-front  { padding: 12px !important; }
          .glev-control-front .glev-control-header { margin-bottom: 8px !important; }
          .glev-macros-front   { padding: 12px !important; }
        }
        /* Extra squeeze for very small phones (iPhone 13 mini 375×812,
           SE 375×667). At 430px the Adapt Score card is borderline
           visible; at 375px it can fall almost completely off screen.
           We trim cluster gap + glucose card height a bit more so the
           control cluster's top edge lifts into comfortable view. */
        @media (max-width: 375px) {
          .glev-cluster-stack  { gap: 10px !important; }
          .glev-trend-card     { height: 195px !important; }
        }
      `}</style>

      {/* Desktop-only page title. The previous hero "+" button that
          used to sit at the right edge of this row was removed — its
          job is now done by the dedicated quick-add CTA mounted right
          underneath the glucose cluster (see `clusterFooters` below),
          which is reachable on every viewport and sits exactly where
          the user looks first when opening the dashboard. */}
      <div className="glev-dash-head" style={{ marginBottom:28, justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>{t("title")}</h1>
          <p style={{ color:"var(--text-faint)", fontSize:14 }}>
            {t("subtitle_count", { n: totalEntries })}
          </p>
        </div>
      </div>
      <RefreshingBar visible={dashValidating} />
      <DashboardQuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />

      <ReorderableClusters
        clusters={clusters}
        clusterFooters={{
          // Quick-add CTA glued to the bottom of the CONTROL cluster
          // (Control Score is the headline card there). Putting it
          // under the control score makes the whole dashboard —
          // glucose, metabolic, control + add-button — fit on small
          // phones (iPhone 13 mini 375×812) in a single viewport.
          // Keyed by cluster id so it travels with the control
          // cluster if the user reorders the dashboard.
          control: (
            <DashboardQuickAddCTA
              onClick={() => setQuickAddOpen(true)}
              ariaLabel={tQuick("open_aria")}
              expanded={quickAddOpen}
            />
          ),
        }}
      />
    </div>
  );
}

/** Wraps the cluster list in a dnd-kit vertical sortable context. The user
 *  drags from the grip handle in each cluster header to reorder; the new
 *  order is persisted per-user via `useCardOrder("dashboard", …)`. Unknown
 *  saved IDs are dropped and newly-added clusters are appended in their
 *  declared position so future additions show up without breaking layouts. */
function ReorderableClusters({
  clusters,
  clusterFooters,
}: {
  clusters: Array<{ id: string; title: string; cards: ClusterCard[] }>;
  /** Optional footer rendered immediately under a cluster's swipe
   *  pager + indicator, keyed by cluster id. Used by the dashboard
   *  to glue the quick-add CTA to the bottom of the glucose cluster
   *  so the button always sits directly under the live-glucose card,
   *  regardless of where the user reorders that cluster to. */
  clusterFooters?: Record<string, React.ReactNode>;
}) {
  const { order, setOrder } = useCardOrder("dashboard", DASHBOARD_CLUSTER_DEFAULT_ORDER);

  const resolved = useMemo(() => {
    // Legacy-ID migration: existing users have saved cluster orders
    // from the previous 5-cluster layout that referenced
    // "macros", "rates" and "score-trend" — all three IDs no longer
    // exist after the cockpit refactor. We remap each legacy ID to
    // its successor (macros + rates → metabolic, score-trend →
    // control) BEFORE the unknown-ID drop step below, so an existing
    // user who never reordered manually still gets glucose →
    // metabolic → control → recents instead of glucose → recents (with
    // metabolic + control silently appended to the bottom). Without
    // this remap the architect review caught that a stock saved order
    // would resolve to ["glucose","recents","metabolic","control"],
    // which contradicts the spec narrative.
    const LEGACY_REMAP: Record<string, string> = {
      "macros":      "metabolic",
      "rates":       "metabolic",
      "score-trend": "control",
    };
    const migrated = order.map(id => LEGACY_REMAP[id] ?? id);

    const byId = new Map(clusters.map(c => [c.id, c]));
    const seen = new Set<string>();
    const out: typeof clusters = [];
    for (const id of migrated) {
      const c = byId.get(id);
      // `!seen.has(id)` dedupes the case where two legacy IDs
      // (macros + rates) both remap to the same new ID (metabolic);
      // we want the merged cluster to appear once, at the position
      // of the first legacy occurrence.
      if (c && !seen.has(id)) { out.push(c); seen.add(id); }
    }
    for (const c of clusters) if (!seen.has(c.id)) out.push(c);
    return out;
  }, [clusters, order]);

  const sensors = useSensors(
    // 280ms hold before a drag starts so a normal tap or swipe inside the
    // cluster (the horizontal card pager lives below the header) is never
    // hijacked. Matches the iOS feel without being slow.
    useSensor(PointerSensor, { activationConstraint: { delay: 280, tolerance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 280, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const ids = resolved.map(c => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setOrder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={resolved.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <div className="glev-cluster-stack" style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {resolved.map(cl => (
            <SortableCluster
              key={cl.id}
              clusterId={cl.id}
              title={cl.title}
              cards={cl.cards}
              footer={clusterFooters?.[cl.id]}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCluster({
  clusterId,
  title,
  cards,
  footer,
}: {
  clusterId: string;
  title: string;
  cards: ClusterCard[];
  /** Optional footer node — rendered by DashboardCluster directly
   *  underneath the swipe pager + indicator. */
  footer?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: clusterId });
  const t = useTranslations("dashboard");

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  const handle = (
    <button
      type="button"
      aria-label={t("reorder_cluster_aria")}
      {...attributes}
      {...listeners}
      style={{
        width: 28, height: 28, padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none",
        color: "var(--text-ghost)", cursor: "grab",
        touchAction: "none",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="5" cy="3"  r="1.3"/><circle cx="11" cy="3"  r="1.3"/>
        <circle cx="5" cy="8"  r="1.3"/><circle cx="11" cy="8"  r="1.3"/>
        <circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/>
      </svg>
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      <DashboardCluster clusterId={clusterId} title={title} cards={cards} headerHandle={handle} footer={footer} />
    </div>
  );
}

/** Primary quick-add CTA on the dashboard. Lives right under the
 *  glucose cluster (replacing the old desktop-only hero "+" in the
 *  page header and the global header `QuickAddMenu` on this route)
 *  so the entry point is exactly where the eye lands first. Full
 *  width, accent-tinted, with the same plus icon family used
 *  throughout the app. Opens `DashboardQuickAddSheet`. */
function DashboardQuickAddCTA({
  onClick,
  ariaLabel,
  expanded,
}: {
  onClick: () => void;
  ariaLabel: string;
  expanded: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="glev-quickadd-cta"
      style={{
        marginTop: 12,
        width: "100%",
        height: 48,
        borderRadius: 14,
        background: SURFACE,
        border: `1px solid ${ACCENT}55`,
        color: "var(--text)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 0 1px ${ACCENT}22`,
        transition: "background 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Glev brand mark — same component the Engine "Speak" button uses,
          rendered in ACCENT on the dark surface so the bubble reads as a
          Glev action. Drop-shadow glow mirrors the Speak button. */}
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          filter: `drop-shadow(0 0 4px ${ACCENT}55)`,
        }}
      >
        <GlevLogo size={26} color={ACCENT} bg="transparent" />
      </span>
    </button>
  );
}

type ClusterCard = { id: string; node: React.ReactNode };

/** Horizontal snap pager used by every dashboard cluster. Reuses the same
 *  mechanics as the Insights screen's `InsightsSwipePager` — one slide per
 *  card at 100% container width, scroll-snap mandatory, dot indicators
 *  below. Clusters with only one card hide the indicator (per spec).
 *  Active index follows the scroll position via rAF + clientWidth rounding;
 *  changing slide triggers a light selection haptic on mobile.
 *
 *  An optional `footer` slot lets the caller glue a node (e.g. the
 *  dashboard quick-add CTA) directly underneath the pager + indicator,
 *  so that node travels with the cluster when the user reorders it. */
function DashboardCluster({
  clusterId,
  title,
  cards,
  headerHandle,
  footer,
}: {
  clusterId: string;
  title: string;
  cards: ClusterCard[];
  headerHandle?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Debounced scroll-end correction. iOS Safari + Android Chrome
  // occasionally ignore `scroll-snap-stop: always` after a soft flick
  // or trackpad swipe, leaving the scroller resting between two
  // slides (50/50 split). When the user stops scrolling we wait
  // ~140ms, then if scrollLeft isn't a clean multiple of clientWidth
  // we smoothly snap to the nearest slide ourselves. The CSS snap
  // still does most of the work; this is a safety net.
  const settleTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);

  // Per-card natural-height measurements. Mirrors the InsightsSwipePager
  // pattern: each slide is observed by a ResizeObserver and the
  // scroller's height tracks the *active* slide's height instead of
  // letting flex stretch every slide to the tallest sibling. Without
  // this, a short card (e.g. Good Rate ~150px) shares its row with a
  // tall card (e.g. Recents ~400px) and the scroller container ends up
  // 400px tall, leaving a big blank gap between the card and the dots
  // pager below it. Adaptive height makes the dots hug the bottom edge
  // of whichever card is currently in focus.
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});

  const updateActive = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const idx = Math.max(0, Math.min(cards.length - 1, Math.round(el.scrollLeft / w)));
    setActive(prev => {
      if (prev === idx) return prev;
      hapticSelection();
      return idx;
    });
  }, [cards.length]);

  // Shared helper for any programmatic scroll (settle-correction OR
  // PagerIndicator tap). Cancels any pending settle timer, raises
  // the guard, and refreshes the guard release on each subsequent
  // scroll tick so slow devices / long animations don't drop the
  // guard mid-flight (which would let the settle timer fire into
  // an in-progress smooth scroll and start a snap fight).
  const programmaticReleaseTimerRef = useRef<number | null>(null);
  const scheduleProgrammaticRelease = useCallback(() => {
    if (programmaticReleaseTimerRef.current != null) {
      window.clearTimeout(programmaticReleaseTimerRef.current);
    }
    programmaticReleaseTimerRef.current = window.setTimeout(() => {
      programmaticReleaseTimerRef.current = null;
      programmaticScrollRef.current = false;
    }, 220);
  }, []);
  const programmaticScrollTo = useCallback((left: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    programmaticScrollRef.current = true;
    el.scrollTo({ left, behavior: "smooth" });
    scheduleProgrammaticRelease();
  }, [scheduleProgrammaticRelease]);

  const settleSnap = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const target = Math.round(el.scrollLeft / w) * w;
    // 1px tolerance handles sub-pixel rounding without thrashing.
    if (Math.abs(el.scrollLeft - target) > 1) {
      programmaticScrollTo(target);
    }
  }, [programmaticScrollTo]);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateActive();
    });
    // While a programmatic scroll is animating, keep refreshing the
    // release timer so it only fires once the user/browser is truly
    // idle — never mid-animation.
    if (programmaticScrollRef.current) {
      scheduleProgrammaticRelease();
      return;
    }
    // Reset the settle timer on every scroll tick — once scrolling
    // stops for 140ms we run the correction.
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      settleSnap();
    }, 140);
  }, [updateActive, settleSnap, scheduleProgrammaticRelease]);

  // Realign on width change (orientation, container resize, sidebar
  // collapse). Without this, after a width change the scroller would
  // still sit at the old scrollLeft and visually show a partial
  // slide until the user scrolls again. We re-pin scrollLeft to
  // `active * clientWidth` instantly (jump, no animation) so the
  // user never sees the misalignment in the first place.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0 || w === lastW) return;
      lastW = w;
      const target = active * w;
      if (Math.abs(el.scrollLeft - target) > 1) {
        programmaticScrollRef.current = true;
        el.scrollLeft = target;
        scheduleProgrammaticRelease();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, scheduleProgrammaticRelease]);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
      if (programmaticReleaseTimerRef.current != null) window.clearTimeout(programmaticReleaseTimerRef.current);
    };
  }, []);

  // Measure each card's natural height. Re-measures automatically when
  // a card's content changes (e.g. a FlipCard expands its back, which
  // renders a hidden ghost in normal flow to drive parent height) or
  // when underlying data refreshes. Stale entries are kept around so
  // swiping back to an already-measured slide is jank-free.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observers: ResizeObserver[] = [];
    itemRefs.current.slice(0, cards.length).forEach((el, idx) => {
      if (!el) return;
      const ro = new ResizeObserver(entries => {
        for (const e of entries) {
          const h = Math.ceil(e.contentRect.height);
          if (h <= 0) continue;
          setHeights(prev => (prev[idx] === h ? prev : { ...prev, [idx]: h }));
        }
      });
      ro.observe(el);
      observers.push(ro);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [cards.length]);

  // Drop measurements for indices that no longer exist (card count
  // shrinks). Keeps the state map from growing unbounded across
  // renders.
  useEffect(() => {
    setHeights(prev => {
      const next: Record<number, number> = {};
      for (const k of Object.keys(prev)) {
        const i = Number(k);
        if (i < cards.length) next[i] = prev[i];
      }
      return next;
    });
  }, [cards.length]);

  // Scroller height = active card's measured height. Until the first
  // measurement lands the height is `auto` so the very first paint
  // doesn't collapse to zero (which would cause a brief flash of
  // missing content before the observer fires). After measurement we
  // pin the height with a short transition so swiping between cards of
  // different heights feels smooth instead of snapping.
  const activeMeasured = heights[active];
  const scrollerHeight: React.CSSProperties["height"] =
    activeMeasured != null ? activeMeasured : "auto";

  return (
    <section
      aria-label={title}
      className="glev-cluster"
      style={{ display:"flex", flexDirection:"column", gap:10 }}
    >
      {/* Cluster title is intentionally hidden from view (per user
          request: the "Glucose / Metabolic Response / Control"
          headings felt redundant once each cluster is a single visual
          swipe surface). It still ships as a visually-hidden h2 so
          screen readers and the cluster's aria-label stay informative.
          The drag handle, when present, remains tappable on the
          right edge of the cluster. */}
      <h2
        style={{
          position: "absolute",
          width: 1, height: 1,
          padding: 0, margin: -1, overflow: "hidden",
          clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
        }}
      >
        {title}
      </h2>
      {/* Drag handle moved out of its own top row and into the bottom
          control bar (see below) — having a dedicated handle row above
          every cluster was eating ~38px of vertical space (28px button +
          10px section gap) and leaving the handle visually floating in
          the empty space between clusters, which the user flagged as
          excessive blank space on the dashboard. */}
      <div
        ref={scrollerRef}
        onScroll={cards.length > 1 ? onScroll : undefined}
        style={{
          display:"flex",
          // Adaptive height — see the heights/measured logic above for
          // the rationale. `alignItems:"flex-start"` prevents flex from
          // stretching slides taller than the container's pinned
          // height, which would otherwise re-introduce the blank-space
          // problem the measurement is meant to fix.
          alignItems:"flex-start",
          height: scrollerHeight,
          transition: "height 220ms ease",
          overflowX: cards.length > 1 ? "auto" : "hidden",
          overflowY:"hidden",
          scrollSnapType: cards.length > 1 ? "x mandatory" : "none",
          overscrollBehaviorX:"contain",
          WebkitOverflowScrolling:"touch",
          touchAction:"pan-x pan-y",
        }}
      >
        {cards.map((c, i) => (
          <div
            key={c.id}
            id={`${clusterId}-slide-${i}`}
            role="tabpanel"
            aria-label={c.id}
            ref={el => { itemRefs.current[i] = el; }}
            style={{
              // border-box guarantees the slot's outer width is
              // exactly the scroller's clientWidth even if padding is
              // ever introduced, so scroll-snap lands cleanly on
              // multiples of clientWidth instead of stopping between
              // slides. Combined with `scrollSnapAlign:"start"` (more
              // reliable than "center" on touch with mandatory snap)
              // this fixes the "stops halfway" issue the user saw.
              boxSizing:"border-box",
              flex:"0 0 100%",
              width:"100%",
              minWidth:0,
              scrollSnapAlign:"start",
              scrollSnapStop:"always",
              // 2026-05-17 UX: give each swiped card breathing room
              // so adjacent cards don't look glued together as the
              // next one peeks in during a swipe. 14px each side
              // yields ~28px visible gap between adjacent slides
              // while the slot still snaps on multiples of the
              // container width (border-box keeps width = 100% of
              // the scroller). Same value used in the Insights
              // cockpit pager below for visual consistency across
              // the app.
              padding: "0 14px",
            }}
          >
            {c.node}
          </div>
        ))}
      </div>
      {/* Unified bottom control bar:
            ┌──────────────────────────────────────────────────────┐
            │ [spacer]      [pager indicator]      [drag handle]   │
            └──────────────────────────────────────────────────────┘
          The 3-column grid keeps the indicator perfectly centered
          regardless of whether the handle is present. For single-
          card clusters (where PagerIndicator returns null) the bar
          shrinks to just the handle on the right. */}
      <div
        className="glev-cluster-bar"
        style={{
          display: "grid",
          // Fixed 28px side columns mirror the handle button's footprint
          // exactly, so the middle column (and therefore the pager
          // indicator) is geometrically and visually centered relative
          // to the cluster — not pushed off-center by the handle's
          // mass on the right. `justifyItems:"center"` centers the
          // indicator inside its track even when it's narrower than
          // the middle column.
          gridTemplateColumns: "28px 1fr 28px",
          alignItems: "center",
          justifyItems: "center",
        }}
      >
        <div aria-hidden style={{ width: 28, height: 28 }} /> {/* mirror of handle */}
        <PagerIndicator
          total={cards.length}
          active={active}
          onSelect={(i) => {
            const el = scrollerRef.current;
            if (!el) return;
            // Go through the shared programmatic helper so the settle
            // timer can't race with the indicator-driven smooth scroll.
            programmaticScrollTo(i * el.clientWidth);
          }}
          label={title}
          controlsId={(i) => `${clusterId}-slide-${i}`}
        />
        {headerHandle}
      </div>
      {footer}
    </section>
  );
}

/**
 * Recent Entries — single-entry swipe pager.
 * Shows 1 row at a time; swipe left/right (or tap the dot-indicators)
 * to navigate through the last N entries. Tapping the row toggles the
 * same inline light-expansion as before.
 */
function RecentEntries({
  rows,
  locale,
  onViewAll,
  onViewEntry,
  onMealUpdated,
}: {
  rows: RecentRow[];
  locale: string;
  onViewAll: () => void;
  onViewEntry: (id: string) => void;
  onMealUpdated?: (m: Meal) => void;
}) {
  const [idx, setIdx]         = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const t    = useTranslations("dashboard");
  const tIns = useTranslations("insights");

  const clamp = (n: number) => Math.max(0, Math.min(rows.length - 1, n));

  const go = (next: number) => {
    setIdx(clamp(next));
    setExpanded(null);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 30) return;
    go(dx < 0 ? idx + 1 : idx - 1);
  };

  const r = rows[idx];

  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"16px 20px 8px" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--text-dim)" }}>
          {t("recent_label")}
        </div>
        <button
          onClick={onViewAll}
          style={{ fontSize:14, color:ACCENT, background:"transparent", border:"none", cursor:"pointer", padding:0, fontWeight:500 }}
        >
          {t("see_all")}
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding:"24px 0 16px", textAlign:"center", color:"var(--text-ghost)", fontSize:14 }}>
          {t("no_entries_yet")}
        </div>
      ) : (
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Single current row */}
          <UnifiedRecentRow row={r} locale={locale} onClick={() => setExpanded(prev => prev === r.id ? null : r.id)} />

          {r.kind === "meal" && r.meal && (
            <PendingGlucoseStrip
              meal={r.meal}
              onSaved={(patch) => onMealUpdated?.({ ...r.meal!, ...patch })}
            />
          )}

          {expanded === r.id && (
            <div style={{ paddingBottom:8 }}>
              {r.kind === "meal" ? (
                <MealEntryLightExpand
                  meal={r.meal!}
                  locale={locale}
                  onViewFull={() => onViewEntry(r.meal!.id)}
                  onUpdated={onMealUpdated}
                />
              ) : r.kind === "exercise" ? (
                <NonMealLightExpand
                  ts={r.ts}
                  locale={locale}
                  stats={[
                    { label:t("stat_duration"),  value:`${r.exercise!.duration_minutes} min`, color:KIND_ACCENT.exercise.color },
                    { label:t("stat_type"),      value:exerciseTypeLabelI18n(tIns, r.exercise!.exercise_type) },
                    { label:t("stat_intensity"), value:r.exercise!.intensity || "—" },
                    ...(r.exercise!.cgm_glucose_at_log != null ? [{ label:t("stat_cgm_at_log"), value:`${r.exercise!.cgm_glucose_at_log} mg/dL` }] : []),
                  ]}
                  onViewFull={() => onViewEntry(r.id)}
                />
              ) : (
                <NonMealLightExpand
                  ts={r.ts}
                  locale={locale}
                  stats={[
                    { label:t("stat_dose"),    value:`${r.insulin!.units} u`, color:KIND_ACCENT[r.kind].color },
                    { label:t("stat_insulin"), value:r.insulin!.insulin_name || (r.kind === "bolus" ? t("ins_rapid") : t("ins_long")) },
                    { label:t("stat_kind"),    value:r.kind === "bolus" ? t("ins_bolus") : t("ins_basal"), color:KIND_ACCENT[r.kind].color },
                    ...(r.insulin!.cgm_glucose_at_log != null ? [{ label:t("stat_cgm_at_log"), value:`${r.insulin!.cgm_glucose_at_log} mg/dL` }] : []),
                  ]}
                  onViewFull={() => onViewEntry(r.id)}
                />
              )}
            </div>
          )}

          {/* Dot navigation */}
          {rows.length > 1 && (
            <div style={{
              display:"flex", justifyContent:"center", alignItems:"center",
              gap:6, paddingTop:8, paddingBottom:6,
            }}>
              {rows.map((_, i) => (
                <button
                  key={i}
                  onClick={() => go(i)}
                  style={{
                    width: i === idx ? 16 : 6,
                    height: 6,
                    borderRadius: 99,
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    background: i === idx ? ACCENT : `${ACCENT}44`,
                    transition: "width 0.2s ease, background 0.2s ease",
                  }}
                  aria-label={`Eintrag ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pill chip used in the right slot of every recent-entries row. Matches
// the AppMockupPhone <Pill> spec the user signed off on as "the look":
// no border, slightly more saturated translucent fill (color + 22 alpha),
// 0.08em tracking, all-caps, fully rounded. The `mono` variant uses the
// monospaced numeric font for value chips ("4.2u", "32m") so digits
// align nicely; the meal eval chip stays in the system font so labels
// like "ON TARGET" read as plain copy.
/** Compact "Apple Health" pill for dashboard recent-entries rows — same
 *  visual contract as the entries-page badge, just sized to sit next to
 *  the eval chip without crowding the row's right column. */
function AppleHealthMiniChip() {
  const tIns = useTranslations("entriesExpand");
  const label = tIns("source_apple_health");
  const COLOR = "#FF2D55";
  return (
    <span
      title={tIns("source_apple_health_synced")}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "4px 8px", borderRadius: 99,
        fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", whiteSpace: "nowrap",
        background: `${COLOR}1a`, color: COLOR,
        border: `1px solid ${COLOR}40`, lineHeight: 1.1,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 21s-7-4.5-9.5-9C.8 8.5 2.6 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4.4 0 6.2 4.5 4.5 8-2.5 4.5-9.5 9-9.5 9z"/>
      </svg>
      {label}
    </span>
  );
}

function RecentChip({ text, color, mono = false }: { text: string; color: string; mono?: boolean }) {
  return (
    <span style={{
      padding: "6px 12px", borderRadius: 99,
      fontSize: 13, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", whiteSpace: "nowrap",
      background: `${color}22`, color,
      ...(mono ? { fontFamily: "var(--font-mono)" } : {}),
    }}>{text}</span>
  );
}

// Unified collapsed row used by RecentEntries for ALL kinds. Visual spec:
//   flex / gap 12 / padding 12px 0 / borderBottom rgba(255,255,255,0.06).
//   Left:  36px coloured circle with monogram letter (M / B / L / E).
//   Mid:   14px bold title + 12px muted "time · macro/dose info".
//   Right: meal → existing eval chip; non-meal → kind-coloured value chip.
//   All chips share the RecentChip component above so the visual rhythm
//   stays consistent across kinds.
function UnifiedRecentRow({ row, locale, onClick }: { row: RecentRow; locale: string; onClick: () => void }) {
  const t = useTranslations("dashboard");
  const tIns = useTranslations("insights");
  const tChips = useTranslations("chips");
  const chipLabels = chipLabelsFrom(tChips);
  const accent = KIND_ACCENT[row.kind];
  const letter =
    row.kind === "meal"     ? "M"
    : row.kind === "bolus"  ? "B"
    : row.kind === "basal"  ? "L"   // Long-acting — disambiguates from bolus B
    :                         "E";

  const ts = parseDbDate(row.ts);
  const timeStr = ts.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  let title: string;
  let subtitle: string;
  let rightSlot: React.ReactNode;

  if (row.kind === "meal") {
    const m = row.meal!;
    title = (m.meal_type && chipLabels.typeLabel(m.meal_type)) || t("meal_singular");
    const macroBits: string[] = [];
    if (m.carbs_grams   != null) macroBits.push(`${m.carbs_grams}g C`);
    if (m.protein_grams != null) macroBits.push(`${m.protein_grams}g P`);
    if (m.fat_grams     != null) macroBits.push(`${m.fat_grams}g F`);
    subtitle = macroBits.length ? `${timeStr} · ${macroBits.join(" · ")}` : timeStr;
    const evColor = getEvalColor(m.evaluation);
    rightSlot = <RecentChip text={chipLabels.evalLabel(m.evaluation)} color={evColor} />;
  } else if (row.kind === "exercise") {
    const x = row.exercise!;
    title = exerciseTypeLabelI18n(tIns, x.exercise_type);
    subtitle = `${timeStr} · ${x.duration_minutes}m`;
    const evalInfo = evaluateExercise(x);
    // Synced rows surface an additional Apple-Health pill next to the
    // eval chip so the provenance is visible at a glance in the
    // dashboard's compact recent-entries list.
    rightSlot = x.source === "apple_health" ? (
      <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
        <AppleHealthMiniChip/>
        <RecentChip text={evalInfo.label} color={evalInfo.color} />
      </span>
    ) : (
      <RecentChip text={evalInfo.label} color={evalInfo.color} />
    );
  } else {
    const i = row.insulin!;
    title = i.insulin_name || (row.kind === "bolus" ? t("ins_bolus") : t("ins_basal"));
    subtitle = `${timeStr} · ${i.units}u`;
    rightSlot = <RecentChip text={`${i.units}u`} color={accent.color} mono />;
  }

  return (
    <div
      onClick={onClick}
      style={{
        display:"flex", gap:12, padding:"12px 0",
        borderBottom:"1px solid var(--border-soft)",
        alignItems:"center", cursor:"pointer",
      }}
    >
      {/* Left circle */}
      <div style={{
        width:36, height:36, borderRadius:"50%",
        background:`${accent.color}20`, color:accent.color,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontWeight:800, fontSize:14, flexShrink:0,
        border:`1px solid ${accent.color}40`, fontFamily:"var(--font-mono)",
      }}>
        {letter}
      </div>
      {/* Middle: title + subtitle */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--text-strong)", letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {title}
        </div>
        <div style={{ fontSize:13, color:"var(--text-dim)", fontFamily:"var(--font-mono)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {subtitle}
        </div>
      </div>
      {/* Right slot */}
      {rightSlot}
    </div>
  );
}

/**
 * Light expand body for non-meal rows (bolus / basal / exercise) on the
 * dashboard. Mirrors the visual rhythm of MealEntryLightExpand: a small
 * label + value grid plus a "View full entry →" footer that navigates
 * to /entries#id.
 */
function NonMealLightExpand({
  ts,
  locale,
  stats,
  onViewFull,
}: {
  ts: string;
  locale: string;
  stats: Array<{ label: string; value: string; color?: string }>;
  onViewFull: () => void;
}) {
  const t = useTranslations("dashboard");
  const date = parseDbDate(ts);
  const fullTimestamp = date.toLocaleString(locale, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <div style={{ padding:"12px 16px 14px", display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>{t("details")}</div>
        <div style={{ display:"flex", gap:24, flexWrap:"wrap" }}>
          {stats.map(s => (
            <div key={s.label} style={{ display:"flex", flexDirection:"column", minWidth:70, gap:3 }}>
              <span style={{ fontSize:12, color:"var(--text-faint)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>{s.label}</span>
              <span style={{ fontSize:14, fontWeight:700, color: s.color || "var(--text-strong)", fontFamily:"var(--font-mono)" }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
        <span style={{ fontSize:13, color:"var(--text-dim)", fontFamily:"var(--font-mono)" }}>{fullTimestamp}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onViewFull(); }}
          style={{ background:"transparent", border:"none", color:ACCENT, fontSize:13, fontWeight:600, cursor:"pointer", padding:"4px 0", letterSpacing:"-0.01em" }}
        >
          {t("view_full_entry")}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Control Score hero card.
//   The score formula + bucketing live in `lib/controlScore.ts` so they
//   can be unit-tested without dragging this React tree into the test
//   runner (Task #41). Badge thresholds (STRONG ≥ 80 · GOOD ≥ 60 ·
//   POOR < 60) are the user-facing 3-tier mapping spec'd by product.
// -----------------------------------------------------------------------------
function ControlScoreCard({ meals }: { meals: Meal[] }) {
  const [flipped, setFlipped] = useState(false);
  const t = useTranslations("dashboard");

  const { score, count, delta, badge, good, spike, hypo, other } = useMemo(() => {
    const now = Date.now();
    const wkStart   = startOfDaysAgo(6).getTime();
    const prevStart = startOfDaysAgo(13).getTime();
    const cur  = computeControlScore(meals, wkStart, now);
    const prev = computeControlScore(meals, prevStart, wkStart);
    const delta = prev.score !== null && cur.score !== null ? cur.score - prev.score : null;
    const badge =
      cur.score === null   ? { key: "poor",   color: PINK   }
      : cur.score >= 80    ? { key: "strong", color: GREEN  }
      : cur.score >= 60    ? { key: "good",   color: ACCENT }
      :                      { key: "poor",   color: PINK   };
    return { score: cur.score, count: cur.count, delta, badge,
             good: cur.good, spike: cur.spike, hypo: cur.hypo, other: cur.other };
  }, [meals]);

  const badgeText = t(`badge_${badge.key}`);
  const hasEntries = count > 0;
  const hasScore   = score !== null;
  const hasData    = hasEntries;

  const pct = (n: number) => hasData ? Math.round((n / count) * 100) : 0;
  const buckets = [
    { label: t("cs_good"),    val: good,  color: GREEN,              icon: "✓" },
    { label: t("cs_spike"),   val: spike, color: ORANGE,             icon: "↑" },
    { label: t("cs_hypo"),    val: hypo,  color: PINK,               icon: "↓" },
    { label: t("cs_pending"), val: other, color: "var(--text-ghost)", icon: "⧗" },
  ];

  const cardBase: React.CSSProperties = {
    position: "absolute", inset: 0,
    backfaceVisibility: "hidden",
    background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16,
    boxSizing: "border-box",
  };

  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{ position: "relative", perspective: 1200, cursor: "pointer", minHeight: 200 }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformStyle: "preserve-3d",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          minHeight: 200,
        }}
      >
        {/* ── FRONT ── */}
        <div
          className="glev-control-front"
          style={{ ...cardBase, padding: "18px 24px 18px" }}
        >
          {/* Header — title + sublabel stack, badge right, flip hint */}
          <div className="glev-control-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                {t("adapt_score_title")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.06em", marginTop: 2 }}>
                {t("adapt_score_sublabel")}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 2 }}>
              {hasEntries && (
                <div style={{ fontSize: 11, fontWeight: 800, color: badge.color, padding: "4px 10px", borderRadius: 99,
                              border: `1px solid ${badge.color}55`, background: `${badge.color}18`,
                              letterSpacing: "0.1em", flexShrink: 0 }}>
                  {badgeText}
                </div>
              )}
              <span style={{ fontSize: 11, color: "var(--text-ghost)", flexShrink: 0 }}>↺</span>
            </div>
          </div>

          {/* Score row */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 56, fontWeight: 800, color: hasScore ? ACCENT : "var(--text-ghost)", letterSpacing: "-0.03em", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
              {hasScore ? score : "—"}
            </span>
            {hasScore && <span style={{ fontSize: 14, color: "var(--text-dim)", fontWeight: 500 }}>/ 100</span>}
            <span style={{
              marginLeft: "auto", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)",
              color: delta == null ? "var(--text-dim)" : delta > 0 ? GREEN : delta < 0 ? PINK : "var(--text-dim)",
            }}>
              {!hasEntries
                ? t("no_entries_7d")
                : delta == null
                  ? t("entries_7d", { n: count })
                  : `${delta > 0 ? "+" : ""}${delta} ${t("delta_vs_last_week")}`}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, marginTop: 14, background: "var(--border-soft)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${hasScore ? Math.max(0, Math.min(100, score as number)) : 0}%`,
                          background: `linear-gradient(90deg, ${ACCENT}, ${GREEN})`, borderRadius: 99, transition: "width 0.6s ease" }} />
          </div>
        </div>

        {/* ── BACK ── */}
        <div
          style={{
            ...cardBase,
            transform: "rotateY(180deg)",
            padding: "16px 20px 14px",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          {/* Back header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{
              fontSize: 11, color: "var(--text-dim)",
              letterSpacing: "0.1em", fontWeight: 700,
            }}>
              {t("control_score_back_title").toUpperCase()}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-ghost)" }}>{t("flip_back")}</span>
          </div>

          {/* Brief explanation */}
          <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.5 }}>
            {t("control_score_back_body")}
          </div>

          {/* Breakdown buckets */}
          {hasData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {buckets.map(b => (
                <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: b.color, width: 14, flexShrink: 0, textAlign: "center" }}>{b.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", width: 72, flexShrink: 0 }}>{b.label}</span>
                  <div style={{ flex: 1, height: 5, background: "var(--border-soft)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct(b.val)}%`, background: b.color,
                                  borderRadius: 99, transition: "width 0.4s ease", opacity: b.val === 0 ? 0.25 : 1 }} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700,
                                 color: b.color, width: 32, textAlign: "right", flexShrink: 0 }}>
                    {pct(b.val)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Formula + explanation */}
          <div style={{ padding: "8px 12px", background: `${ACCENT}0a`,
                        border: `1px solid ${ACCENT}22`, borderRadius: 8,
                        display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 11, color: "var(--text-body)", lineHeight: 1.5,
                          fontFamily: "var(--font-mono)" }}>
              {t("control_score_formula")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {t("control_score_explain")}
            </div>
          </div>

          {/* Disclaimer — always visible */}
          <div style={{
            marginTop: "auto",
            borderTop: "1px solid var(--border)", paddingTop: 8,
            fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4,
          }}>
            {t("iob_bg_hint")}
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Daily Macros card — sums today's carbs / protein / fat / fiber across all
// logged meals. Calories use the meal's stored value where present, falling
// back to the 4·carbs + 4·protein + 9·fat estimate for older rows.
// -----------------------------------------------------------------------------
function DailyMacrosCard({ meals, targets }: { meals: Meal[]; targets: MacroTargets }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations("dashboard");
  const today = useMemo(() => {
    const todays = meals.filter(m => isToday(m.meal_time ?? m.created_at ?? ""));

    let carbs = 0, protein = 0, fat = 0, fiber = 0, calories = 0;
    for (const m of todays) {
      const c = m.carbs_grams ?? 0;
      const p = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, f) => s + (f.protein || 0), 0) : 0);
      const f = m.fat_grams     ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, x) => s + (x.fat     || 0), 0) : 0);
      const fb = m.fiber_grams  ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s, x) => s + (x.fiber   || 0), 0) : 0);
      carbs   += c;
      protein += p;
      fat     += f;
      fiber   += fb;
      calories += m.calories ?? computeCalories(c, p, f);
    }

    return { count: todays.length, carbs, protein, fat, fiber, calories };
  }, [meals]);

  // Collapsed view: 4 circular progress rings in a single row.
  // Colors match the meal-type chips on Insights → "Meal type · success %"
  // so the ring color tells the same story as the chip badge:
  //   CARBS   = TYPE_COLORS.FAST_CARBS   (orange  — fast-glucose macro)
  //   PROTEIN = TYPE_COLORS.HIGH_PROTEIN (blue    — slows absorption)
  //   FAT     = TYPE_COLORS.HIGH_FAT    (purple  — delays the spike)
  //   FIBER   = TYPE_COLORS.BALANCED    (green   — supports a balanced response)
  // Sourcing from TYPE_COLORS keeps ring + chip palettes in sync forever.
  // Targets come from the per-user user_settings table (edited in
  // Settings → "Daily Macro Targets"); they fall back to sensible Type-1
  // defaults from DEFAULT_MACRO_TARGETS until the user saves their own.
  // `calories` is intentionally not shown here — it surfaces in the
  // expanded view.
  const rings: Array<{ label: string; value: number; target: number; color: string; unit: string }> = [
    { label: t("macro_carbs"),   value: Math.round(today.carbs),   target: targets.carbs,   color: TYPE_COLORS.FAST_CARBS,   unit: "g" },
    { label: t("macro_protein"), value: Math.round(today.protein), target: targets.protein, color: TYPE_COLORS.HIGH_PROTEIN, unit: "g" },
    { label: t("macro_fat"),     value: Math.round(today.fat),     target: targets.fat,     color: TYPE_COLORS.HIGH_FAT,     unit: "g" },
    { label: t("macro_fiber"),   value: Math.round(today.fiber),   target: targets.fiber,   color: TYPE_COLORS.BALANCED,     unit: "g" },
  ];

  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
      {/* Header doubles as the tap-to-expand toggle. Whole row is a button so
          the click target is generous on touch devices; chevron rotates 180°
          when expanded as the visible affordance. */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls="glev-macros-expanded"
        style={{
          all:"unset",
          boxSizing:"border-box",
          width:"100%",
          padding:"18px 24px 14px",
          display:"flex", justifyContent:"space-between", alignItems:"center",
          borderBottom:`1px solid ${BORDER}`,
          cursor:"pointer",
        }}
      >
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--text-muted)" }}>
          {t("daily_macros")}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:13, color:"var(--text-dim)", fontWeight:500, fontFamily:"var(--font-mono)" }}>
            {today.count} {today.count === 1 ? t("meal_singular") : t("meal_plural")}
          </div>
          <svg
            width="11" height="11" viewBox="0 0 12 12"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition:"transform 200ms ease",
              color:"var(--text-dim)",
            }}
            aria-hidden="true"
          >
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
      {/* 4 rings always in a single row; each cell caps the ring at ~96px so it
          doesn't blow up on wide cards but still scales down cleanly on narrow
          phones via `width:100%` on the SVG (viewBox handles the rest).
          CRITICAL: columns use `minmax(0, 1fr)` (NOT `1fr`). A bare `1fr`
          starts from each cell's min-content size, so longer labels like
          "PROTEIN /200g" force their column wider than "FIBER /30g", which
          in turn makes that cell's ring (capped at maxWidth:96 but otherwise
          width:100%) visually larger than its neighbors. `minmax(0, 1fr)`
          collapses the min-content floor to 0 so all 4 columns stay
          mathematically identical and the rings render equal-diameter. */}
      <div style={{ padding:"22px 16px 24px", display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:8 }}>
        {rings.map(r => (
          <div key={r.label} style={{ display:"flex", justifyContent:"center", minWidth:0 }}>
            <MacroRing {...r} />
          </div>
        ))}
      </div>
      {/* Expanded section — three blocks per product spec:
            1. Calories total (prominent kcal)
            2. % of daily target per macro (mini progress bars)
            3. Tip box with contextual copy
          The tip copy is generated from the current day's data; swap to
          product-supplied strings when the editorial spec lands. */}
      {expanded && (() => {
        const pcts = rings.map(r => ({
          label: r.label,
          color: r.color,
          pct: r.target > 0 ? r.value / r.target : 0,
        }));
        let tip: string;
        if (today.count === 0) {
          tip = t("tip_no_meals");
        } else {
          const lowest = pcts.reduce((a, b) => (b.pct < a.pct ? b : a));
          const allOnTrack = pcts.every(p => p.pct >= 0.8);
          tip = allOnTrack
            ? t("tip_all_on_track")
            : t("tip_lowest", { label: lowest.label, pct: Math.round(lowest.pct * 100) });
        }
        return (
          <div
            id="glev-macros-expanded"
            style={{ borderTop:`1px solid ${BORDER}`, padding:"18px 24px 22px", display:"flex", flexDirection:"column", gap:20 }}
          >
            {/* 1. Calories — prominent kcal total. */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <div style={{ fontSize:12, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700, textTransform:"uppercase" }}>
                {t("calories")}
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:ACCENT, letterSpacing:"-0.02em", fontFamily:"var(--font-mono)" }}>
                  {Math.round(today.calories).toLocaleString()}
                </span>
                <span style={{ fontSize:13, color:"var(--text-dim)", fontWeight:500 }}>{t("kcal")}</span>
              </div>
            </div>

            {/* 2. % of daily target — one bar per macro, color-matched to its ring. */}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ fontSize:12, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700, textTransform:"uppercase", marginBottom:2 }}>
                {t("pct_daily_target")}
              </div>
              {pcts.map(p => (
                <div key={p.label} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:"0 0 60px", fontSize:12, color:"var(--text-muted)", letterSpacing:"0.06em", fontWeight:700 }}>
                    {p.label}
                  </div>
                  <div style={{ flex:1, height:5, background:"var(--border-soft)", borderRadius:99, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${(Math.min(1, p.pct) * 100).toFixed(1)}%`, background:p.color, borderRadius:99 }} />
                  </div>
                  <div style={{ flex:"0 0 40px", textAlign:"right", fontSize:12, color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontWeight:600 }}>
                    {Math.round(p.pct * 100)}%
                  </div>
                </div>
              ))}
            </div>

            {/* 3. Tip — accent label + dynamic body copy. */}
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px" }}>
              <div style={{ fontSize:13, lineHeight:1.55, color:"var(--text-body)" }}>
                <span style={{ color:ACCENT, fontWeight:800, letterSpacing:"0.08em", marginRight:8, fontSize:12 }}>{t("tip_label")}</span>
                {tip}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// `MacroRing` is shared with the Engine wizard review-step — see
// `components/MacroRing.tsx`. The dashboard imports it at the top of
// this file so both surfaces stay pixel-identical and the macro palette
// is sourced from a single place.

// -----------------------------------------------------------------------------
// RecentRow union + non-meal row renderer
// -----------------------------------------------------------------------------
type RecentRow =
  | { kind: "meal";     id: string; ts: string; meal: Meal;     insulin?: never;     exercise?: never }
  | { kind: "bolus";    id: string; ts: string; meal?: never;   insulin: InsulinLog; exercise?: never }
  | { kind: "basal";    id: string; ts: string; meal?: never;   insulin: InsulinLog; exercise?: never }
  | { kind: "exercise"; id: string; ts: string; meal?: never;   insulin?: never;     exercise: ExerciseLog };

const KIND_ACCENT: Record<"meal" | "bolus" | "basal" | "exercise", { color: string; label: string }> = {
  meal:     { color: "#f59e0b", label: "MEAL" },      // amber — neutral accent for the meal kind row
  bolus:    { color: "#4A90D9", label: "BOLUS" },     // blue
  basal:    { color: "#8B5CF6", label: "BASAL" },     // purple (no spec'd colour, kept)
  exercise: { color: "#10B981", label: "EXERCISE" },  // teal
};

