/* eslint-disable jsx-a11y/alt-text */
// Glev — patient PDF report.
//
// Built with @react-pdf/renderer because we want a polished, brand-true
// PDF that the user can hand to a doctor. The component below produces
// the entire document; ExportPanel imports it dynamically so the ~400KB
// PDF runtime only loads when the user actually hits "Report".
//
// Data sources:
//   - meals               (food entries with macros + glucose context)
//   - insulin_logs        (bolus / basal)
//   - exercise_logs       (sport sessions)
//   - fingerstick_readings (manual glucose)
//
// We do NOT store CGM history server-side, so TIR is computed only over
// the fingerstick + meal-context glucose values present in the user's
// own database. That keeps the report self-contained and offline-safe.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Svg,
  Rect as SvgRect,
  Line as SvgLine,
  Circle as SvgCircle,
  Polygon as SvgPolygon,
} from "@react-pdf/renderer";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";
import { formatCarbs, formatICR, gToUnit, type CarbUnit } from "@/lib/carbUnits";

/* ──────────────────────────────────────────────────────────────────
   Brand tokens (mirror app brandbook). React-PDF needs hex/rgb only.
   ────────────────────────────────────────────────────────────────── */

const ACCENT       = "#4F6EF7";
const GREEN        = "#22D3A0";
const ORANGE       = "#FF9500";
const PINK         = "#FF2D78";
const PURPLE       = "#A855F7";
const INK          = "#0B0B11";
const MUTED        = "#6B6B7A";
const LINE         = "#E5E5EC";
const BG           = "#FFFFFF";
// Dark header strip — same SURFACE / BORDER values used by the in-app
// header in components/Layout.tsx (#111117 + rgba 0.06 white) so the
// PDF top edge feels like a continuation of the cockpit, not a
// separate doctor-friendly white sheet glued on top.
const BRAND_DARK   = "#111117";
const BRAND_BORDER = "#1F1F26";   // rgba(255,255,255,0.06) on #111117 ≈ this hex
const SYMBOL_BG    = "#0F0F14";   // matches the GlevLogo `bg` default

/* TrendArrow — small SVG arrow icon used in the 14-day trend KPI.
   Helvetica (the only embedded font in this PDF) covers WinAnsi only,
   which does NOT include U+2191/U+2193 arrows or U+0394 Δ — those
   characters fall back to placeholder glyphs (a stray apostrophe /
   quote) in many PDF viewers. Rendering the arrow as real geometry
   sidesteps the font issue entirely and survives any viewer. */
function TrendArrow({
  direction,
  color,
}: {
  direction: "up" | "down" | "flat" | "none";
  color: string;
}) {
  // Em-dash IS in WinAnsi (0x97) so the "no data" placeholder can
  // safely stay as text — keeps the visual consistent with other "—"
  // placeholders elsewhere in the report.
  if (direction === "none") {
    return (
      <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold", color, marginRight: 4 }}>
        —
      </Text>
    );
  }
  const size = 18;
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" style={{ marginRight: 4 }}>
      {direction === "up" && (
        <SvgPolygon points="9,2 16,15 2,15" fill={color} />
      )}
      {direction === "down" && (
        <SvgPolygon points="9,16 2,3 16,3" fill={color} />
      )}
      {direction === "flat" && (
        <SvgLine x1={2} y1={9} x2={16} y2={9} stroke={color} strokeWidth={2.6} strokeLinecap="round" />
      )}
    </Svg>
  );
}

/* Glev brand-mark geometry — kept in sync with components/GlevLogo.tsx
   so the lockup that sits in the PDF brand bar is the exact same node
   graph the user sees in the app header. Hand-mirrored here because
   @react-pdf/renderer cannot render the React `GlevLogo` component
   (which uses raw <svg> instead of @react-pdf/renderer's Svg). */
const LOGO_NODES: ReadonlyArray<{ cx: number; cy: number }> = [
  { cx: 16, cy: 7 },
  { cx: 25, cy: 12 },
  { cx: 25, cy: 20 },
  { cx: 18, cy: 26 },
  { cx: 9,  cy: 22 },
  { cx: 7,  cy: 14 },
  { cx: 16, cy: 16 },
];
const LOGO_EDGES: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
  [0, 6], [1, 6], [2, 6], [3, 6],
];

/* ──────────────────────────────────────────────────────────────────
   Stylesheet
   ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    // paddingTop bumped to 84 (was 36) so the fixed dark BrandHeader
    // strip (height 50 + bottom border) sits above all body content
    // without overlapping. Horizontal/bottom padding unchanged so the
    // existing tables still align with their previous left/right edges.
    paddingTop: 84,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
    backgroundColor: BG,
  },
  // Dark BrandHeader strip — recreates the in-app header (SURFACE bg
  // with subtle bottom border) at the top of every PDF page. Rendered
  // via `<View fixed>` so it appears on the cover, on each detail-
  // table page, and any auto-paginated overflow page identically.
  brandHeader: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 50,
    backgroundColor: BRAND_DARK,
    borderBottomWidth: 1,
    borderBottomColor: BRAND_BORDER,
    paddingHorizontal: 36,
    flexDirection: "row",
    alignItems: "center",
  },
  brandHeaderLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandHeaderWord: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  brandHeaderDot: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: GREEN,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 11,
    color: MUTED,
    marginBottom: 18,
  },
  metaBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: LINE,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 24,
  },
  metaItem: { minWidth: 120 },
  metaLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  metaValue: { fontSize: 11, color: INK },
  // Section heading (per page)
  sectionHeading: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 9,
    color: MUTED,
    marginBottom: 12,
  },
  // KPI cards row
  kpiRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  kpi: {
    flexBasis: "31%",
    flexGrow: 1,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FAFAFC",
  },
  kpiLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.5,
  },
  kpiUnit: { fontSize: 9, color: MUTED, marginLeft: 3 },
  // Tables
  table: {
    borderTopWidth: 1,
    borderColor: LINE,
    marginBottom: 8,
  },
  th: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderColor: LINE,
    backgroundColor: "#F5F5F8",
  },
  thCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tr: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderColor: LINE,
  },
  trAlt: { backgroundColor: "#FBFBFD" },
  td: { fontSize: 9, color: INK },
  tdMuted: { fontSize: 9, color: MUTED },
  pill: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
    color: BG,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Footer (every page)
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: MUTED,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderColor: LINE,
  },
  empty: {
    fontSize: 10,
    color: MUTED,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  // Insight cards: wider than KPI tiles so each metric can carry an
  // explanatory paragraph below the headline number. Used by the new
  // "Insights — Übersicht" section on the cover page.
  insightRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  insightCard: {
    flex: 1,
    padding: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FAFAFC",
    minHeight: 96,
  },
  insightLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  insightValue: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  insightValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
  },
  insightUnit: {
    fontSize: 10,
    color: MUTED,
    marginLeft: 4,
    fontFamily: "Helvetica",
    letterSpacing: 0,
  },
  insightExpl: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.45,
  },
});

/* ──────────────────────────────────────────────────────────────────
   Format helpers
   ────────────────────────────────────────────────────────────────── */

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return `${fmtDate(s)} ${fmtTime(s)}`;
}
function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function colorForGlucose(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MUTED;
  if (v < 70) return PINK;
  if (v > 180) return ORANGE;
  return GREEN;
}
function pillColorForInsulin(t: "bolus" | "basal"): string {
  return t === "bolus" ? ACCENT : PURPLE;
}

/* ──────────────────────────────────────────────────────────────────
   Aggregations
   ────────────────────────────────────────────────────────────────── */

interface Aggregates {
  // Insulin
  totalBolusUnits: number;
  totalBasalUnits: number;
  bolusCount: number;
  basalCount: number;
  // Meals
  mealsCount: number;
  totalCarbs: number;
  avgCarbsPerMeal: number;
  // Glucose context (TIR computed across fingersticks + meal context values)
  glucoseSamples: number;
  inRange: number;
  belowRange: number;
  aboveRange: number;
  tir: number;        // %
  tbr: number;        // %
  tar: number;        // %
  glucoseAvg: number; // mg/dL
  // Activity
  exerciseCount: number;
  exerciseMinutes: number;
}

function computeAggregates(
  meals: Meal[],
  insulin: InsulinLog[],
  exercise: ExerciseLog[],
  fingersticks: FingerstickReading[],
): Aggregates {
  // Bolus is stored in two places:
  //   1. `meals.insulin_units` — bolus given at meal time via the /log
  //      wizard (the common path; ~99% of entries for active users).
  //   2. `insulin` rows with insulin_type='bolus' — standalone bolus
  //      logged via the Engine "Log" tab (correction doses, etc).
  // Basal only ever lands in `insulin`. Sum both sources for bolus so
  // the Klinische-Detail-KPIs reflect actual daily insulin use, not
  // just the rare standalone correction doses.
  const mealBolusUnits = meals.reduce((s, m) => s + (m.insulin_units ?? 0), 0);
  const mealBolusCount = meals.filter(m => (m.insulin_units ?? 0) > 0).length;
  const standaloneBolus = insulin.filter(l => l.insulin_type === "bolus");
  const totalBolusUnits = mealBolusUnits + standaloneBolus.reduce((s, l) => s + (l.units || 0), 0);
  const totalBasalUnits = insulin.filter(l => l.insulin_type === "basal").reduce((s, l) => s + (l.units || 0), 0);
  const bolusCount = mealBolusCount + standaloneBolus.length;
  const basalCount = insulin.filter(l => l.insulin_type === "basal").length;

  const totalCarbs = meals.reduce((s, m) => s + (m.carbs_grams ?? 0), 0);
  const mealsCount = meals.length;
  const avgCarbsPerMeal = mealsCount > 0 ? totalCarbs / mealsCount : 0;

  const allGlucose: number[] = [];
  for (const fs of fingersticks) {
    const v = Number(fs.value_mg_dl);
    if (Number.isFinite(v)) allGlucose.push(v);
  }
  for (const m of meals) {
    for (const v of [m.glucose_before, m.glucose_after, m.bg_1h, m.bg_2h]) {
      if (typeof v === "number" && Number.isFinite(v)) allGlucose.push(v);
    }
  }
  const glucoseSamples = allGlucose.length;
  const inRange  = allGlucose.filter(v => v >= 70 && v <= 180).length;
  const belowRange = allGlucose.filter(v => v < 70).length;
  const aboveRange = allGlucose.filter(v => v > 180).length;
  const tir = glucoseSamples > 0 ? (inRange / glucoseSamples) * 100 : 0;
  const tbr = glucoseSamples > 0 ? (belowRange / glucoseSamples) * 100 : 0;
  const tar = glucoseSamples > 0 ? (aboveRange / glucoseSamples) * 100 : 0;
  const glucoseAvg = glucoseSamples > 0 ? allGlucose.reduce((s, v) => s + v, 0) / glucoseSamples : 0;

  const exerciseCount = exercise.length;
  const exerciseMinutes = exercise.reduce((s, e) => s + (e.duration_minutes || 0), 0);

  return {
    totalBolusUnits, totalBasalUnits, bolusCount, basalCount,
    mealsCount, totalCarbs, avgCarbsPerMeal,
    glucoseSamples, inRange, belowRange, aboveRange,
    tir, tbr, tar, glucoseAvg,
    exerciseCount, exerciseMinutes,
  };
}

function dateRange(...sources: Array<{ when: string | null | undefined }[]>): { from: string; to: string } {
  const all: number[] = [];
  for (const src of sources) {
    for (const r of src) {
      if (!r.when) continue;
      const t = new Date(r.when).getTime();
      if (Number.isFinite(t)) all.push(t);
    }
  }
  if (all.length === 0) return { from: "—", to: "—" };
  const min = Math.min(...all);
  const max = Math.max(...all);
  return { from: fmtDate(new Date(min).toISOString()), to: fmtDate(new Date(max).toISOString()) };
}

/* ──────────────────────────────────────────────────────────────────
   Report
   ────────────────────────────────────────────────────────────────── */

interface ReportProps {
  email: string;
  meals: Meal[];
  insulin: InsulinLog[];
  exercise: ExerciseLog[];
  fingersticks: FingerstickReading[];
  // Carb display unit for all KH columns and KPIs in the report.
  // Defaults to "g" so any caller that hasn't yet been threaded with
  // the user's preference still produces the legacy gram-only output.
  carbUnit?: CarbUnit;
  // The user's current insulin-to-carb ratio, in g/IE (the canonical
  // engine unit). Surfaced on the cover meta block and as a small
  // annotation on the insulin section so a clinician sees the ratio
  // alongside the dosed units (e.g. "5 U @ 2 BE/IE"). Optional —
  // omitted/0/null suppresses the annotation entirely so the report
  // stays clean for users who haven't yet configured their ICR.
  icrGperIE?: number | null;
  // The user's current correction factor — mg/dL drop per 1 IE — as
  // stored in `user_settings.cf_mgdl_per_unit`. Pairs with the ICR
  // line on the cover meta block so a DACH clinic can sanity-check
  // both ratios at a glance (e.g. "ICR 2 BE/IE · CF 50 mg/dL/IE").
  // CF is intentionally NOT carb-unit-converted: it's a glucose-per-
  // insulin ratio, so mg/dL/IE is the canonical and only meaningful
  // unit. Optional — omitted/0/null suppresses the annotation, same
  // safeguard as ICR so an unconfigured user never sees a misleading
  // "0 mg/dL/IE".
  cfMgdlPerIE?: number | null;
  // Explicit user-chosen export window (ISO timestamps). When set,
  // the cover "Zeitraum" line shows this range — i.e. the time-slice
  // the clinician asked for, not the slice that happens to contain
  // any data. Omitting it falls back to deriving the range from the
  // data itself (legacy "earliest entry – latest entry" behaviour),
  // which still applies when the user picks the "all" preset. Either
  // bound may be omitted for an open-ended window; missing bounds
  // render as the localized "Anfang"/"heute" placeholders so the
  // line stays grammatical.
  range?: { from?: string; to?: string };
}

const Footer = ({ email, generatedAt }: { email: string; generatedAt: string }) => (
  <View style={styles.footer} fixed>
    <Text>Glev · Diabetes-Bericht · {email || "—"}</Text>
    <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages} · Erstellt ${generatedAt}`} />
  </View>
);

/* ──────────────────────────────────────────────────────────────────
   Brand header — dark strip at the top of every page that mirrors
   the in-app cockpit header (SURFACE bg + GlevLockup top-left). The
   inner Svg recreates `components/GlevLogo.tsx` node-for-node so the
   mark in the PDF is the exact same brand symbol the user sees in
   the app, not a stylised stand-in.
   ────────────────────────────────────────────────────────────────── */

const BrandHeader = () => (
  <View style={styles.brandHeader} fixed>
    <View style={styles.brandHeaderLockup}>
      <Svg width={22} height={22} viewBox="0 0 32 32">
        <SvgRect x={0} y={0} width={32} height={32} rx={9} ry={9} fill={SYMBOL_BG}/>
        {LOGO_EDGES.map(([a, b], i) => (
          <SvgLine
            key={`e${i}`}
            x1={LOGO_NODES[a].cx} y1={LOGO_NODES[a].cy}
            x2={LOGO_NODES[b].cx} y2={LOGO_NODES[b].cy}
            stroke={ACCENT} strokeWidth={0.9} strokeOpacity={0.55}
          />
        ))}
        {LOGO_NODES.map((n, i) => (
          <SvgCircle
            key={`n${i}`}
            cx={n.cx} cy={n.cy}
            r={i === 6 ? 3.5 : 2}
            fill={i === 6 ? ACCENT : `${ACCENT}40`}
            stroke={ACCENT}
            strokeWidth={i === 6 ? 0 : 0.8}
          />
        ))}
      </Svg>
      {/* Two stacked Text nodes inside one row so the green "." matches
          GlevLockup exactly (white "glev" + green dot). Inline nested
          <Text> would be valid but re-using the row pattern keeps the
          colour swap explicit and immune to font kerning surprises. */}
      <Text style={styles.brandHeaderWord}>glev</Text>
      <Text style={[styles.brandHeaderDot, { marginLeft: -2 }]}>.</Text>
    </View>
  </View>
);

/* ──────────────────────────────────────────────────────────────────
   Insights metric helpers — last-7-days windows + 14-day trend.
   Kept here (not in lib/insights.ts) because the report-side and
   app-side computations historically diverge in subtle ways (e.g.
   the report folds in fingerstick + meal-context glucose values
   that the live insights page treats separately) and we want the
   PDF wholly self-contained.
   ────────────────────────────────────────────────────────────────── */

interface InsightsMetrics {
  meals7dCount: number;
  carbs7dTotal: number;
  insulin7dUnits: number;
  // 14-day glucose trend: average over days 7-13 vs days 0-6 ago.
  // null for either average if that window has zero readings.
  trend14OlderAvg: number | null;
  trend14NewerAvg: number | null;
  trend14Delta: number | null;
}

function computeInsightsMetrics(
  meals: Meal[],
  insulin: InsulinLog[],
  fingersticks: FingerstickReading[],
): InsightsMetrics {
  const DAY = 86_400_000;
  const now = Date.now();
  const cutoff7  = now -  7 * DAY;
  const cutoff14 = now - 14 * DAY;
  const cutoffMid = now -  7 * DAY;   // boundary between older/newer half

  // ── Last 7 days ────────────────────────────────────────────────
  let meals7dCount = 0, carbs7dTotal = 0;
  for (const m of meals) {
    const t = new Date(m.created_at).getTime();
    if (Number.isFinite(t) && t >= cutoff7) {
      meals7dCount += 1;
      carbs7dTotal += Number(m.carbs_grams ?? 0) || 0;
    }
  }
  let insulin7dUnits = 0;
  for (const l of insulin) {
    const t = new Date(l.created_at).getTime();
    if (Number.isFinite(t) && t >= cutoff7) {
      insulin7dUnits += Number(l.units ?? 0) || 0;
    }
  }

  // ── 14-day glucose trend (older half vs newer half average) ────
  const olderVals: number[] = [];
  const newerVals: number[] = [];
  const pushReading = (v: number | null | undefined, t: number) => {
    if (!Number.isFinite(t)) return;
    if (t < cutoff14) return;
    const num = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(num)) return;
    if (t < cutoffMid) olderVals.push(num);
    else newerVals.push(num);
  };
  for (const fs of fingersticks) {
    pushReading(Number(fs.value_mg_dl), new Date(fs.measured_at).getTime());
  }
  for (const m of meals) {
    const t = new Date(m.created_at).getTime();
    pushReading(m.glucose_before, t);
    pushReading(m.glucose_after,  t + 2 * 3600 * 1000);
    pushReading(m.bg_1h,          t + 1 * 3600 * 1000);
    pushReading(m.bg_2h,          t + 2 * 3600 * 1000);
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length;
  const trend14OlderAvg = avg(olderVals);
  const trend14NewerAvg = avg(newerVals);
  const trend14Delta =
    trend14OlderAvg !== null && trend14NewerAvg !== null
      ? trend14NewerAvg - trend14OlderAvg
      : null;

  return {
    meals7dCount, carbs7dTotal, insulin7dUnits,
    trend14OlderAvg, trend14NewerAvg, trend14Delta,
  };
}

export function GlevReport({ email, meals, insulin, exercise, fingersticks, carbUnit = "g", icrGperIE = null, cfMgdlPerIE = null, range: chosenRange }: ReportProps) {
  // Cache the unit's display label once so we can compose KH column
  // headers (e.g. "KH (BE)") without recomputing. Uses the short form
  // ("g" / "BE" / "KE") rather than the verbose CARB_UNITS label
  // ("g KH" / "BE" / "KE") so a column reads "KH (g)" instead of the
  // redundant "KH (g KH)".
  const carbLabel = carbUnit === "g" ? "g" : carbUnit;
  // Bare-number formatter for table cells whose column header already
  // carries the unit (avoids the redundant "5 BE" inside a "KH (BE)"
  // column). Pre-`formatCarbs` because that helper appends the unit
  // suffix unconditionally.
  const fmtCarbsValue = (g: number | null | undefined): string =>
    g === null || g === undefined || !Number.isFinite(g)
      ? "—"
      : String(gToUnit(g, carbUnit));
  // Full "value + unit" formatter for the cover insight cards where
  // the unit is shown alongside the number. Centralised on
  // `formatCarbs()` so display drift between the engine UI and the
  // exported report is impossible.
  const fmtCarbsFull = (g: number | null | undefined): string =>
    g === null || g === undefined || !Number.isFinite(g)
      ? "—"
      : formatCarbs(g, carbUnit);
  // ICR is only shown when the caller passes a finite, positive value —
  // a missing setting (user never opened Settings) would otherwise
  // surface a misleading "0 BE/IE" line, suggesting an unsafe ratio.
  const hasICR =
    typeof icrGperIE === "number" &&
    Number.isFinite(icrGperIE) &&
    icrGperIE > 0;
  const icrLabel = hasICR ? formatICR(icrGperIE as number, carbUnit) : null;
  // CF uses the same finite-positive guard as ICR so a never-configured
  // user (null/0) never sees a misleading "0 mg/dL/IE" line. The unit
  // is fixed at mg/dL/IE — see ReportProps comment for rationale.
  const hasCF =
    typeof cfMgdlPerIE === "number" &&
    Number.isFinite(cfMgdlPerIE) &&
    cfMgdlPerIE > 0;
  // Format with up to 1 decimal so "50" stays "50 mg/dL/IE" but a
  // half-step value like 47.5 doesn't get rounded silently. Mirrors
  // the precision used by formatICR via the carbUnits round helper.
  const cfLabel = hasCF
    ? `${Number((cfMgdlPerIE as number).toFixed(1))} mg/dL/IE`
    : null;
  const agg = computeAggregates(meals, insulin, exercise, fingersticks);
  const ins = computeInsightsMetrics(meals, insulin, fingersticks);
  // Cover "Zeitraum" line: prefer the user-chosen export window when
  // it was passed explicitly (so the printed slice matches the slice
  // the clinician asked for, even if it's wider than the actual
  // data). Falls back to the data-derived earliest/latest pair when
  // the caller didn't pass a window — the "all" preset and any
  // legacy caller still behave exactly as before. Open-ended bounds
  // render as "Anfang" / "heute" placeholders so the line stays
  // grammatical even for a half-bounded window.
  const dataRange = dateRange(
    meals.map(m => ({ when: m.created_at })),
    insulin.map(l => ({ when: l.created_at })),
    exercise.map(e => ({ when: e.created_at })),
    fingersticks.map(f => ({ when: f.measured_at })),
  );
  const range = chosenRange
    ? {
        from: chosenRange.from ? fmtDate(chosenRange.from) : "Anfang",
        to:   chosenRange.to   ? fmtDate(chosenRange.to)   : "heute",
      }
    : dataRange;
  const generatedAt = new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Cap long lists so the PDF stays manageable. Recent first.
  const showMeals       = meals.slice(0, 60);
  const showInsulin     = insulin.slice(0, 80);
  const showExercise    = exercise.slice(0, 40);
  const showFingersticks = fingersticks.slice(0, 80);

  // 14-day trend display: arrow + signed delta + qualitative phrase.
  // Stable thresholds (±5 mg/dL) keep noise from registering as a
  // "trend" — anything inside that band reads as ≈stable.
  const trendDelta = ins.trend14Delta;
  // Direction drives the SVG arrow icon (see TrendArrow). Helvetica
  // (the only embedded PDF font) doesn't ship the U+2191/U+2193
  // arrow glyphs, so a literal "↑"/"↓" Text rendered as a stray
  // apostrophe/quote in some PDF viewers — we render real geometry
  // instead.
  const trendDirection: "up" | "down" | "flat" | "none" =
      trendDelta === null ? "none"
    : trendDelta >  5     ? "up"
    : trendDelta < -5     ? "down"
    :                       "flat";
  const trendColor = trendDelta === null
    ? MUTED
    : trendDelta >  5 ? ORANGE   // higher avg glucose vs prior week → caution
    : trendDelta < -5 ? GREEN    // lower avg glucose → improvement
    : ACCENT;

  return (
    <Document title="Glev Diabetes-Bericht" author="Glev" subject="Diabetes Therapie-Bericht">
      {/* ─────────────── COVER + INSIGHTS ─────────────── */}
      <Page size="A4" style={styles.page}>
        <BrandHeader />
        <Text style={styles.title}>Diabetes-Bericht</Text>
        <Text style={styles.subtitle}>Übersicht aller in Glev erfassten Therapie-Daten.</Text>

        <View style={styles.metaBlock}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Patient</Text>
            <Text style={styles.metaValue}>{email || "—"}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Zeitraum</Text>
            {/* Render as a single concatenated string (template literal)
                so the Text node has exactly one text leaf — keeps the
                cover compact AND lets test assertions inspect the
                metaItem as a tight 2-leaf label/value pair. */}
            <Text style={styles.metaValue}>{`${range.from} – ${range.to}`}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Erstellt am</Text>
            <Text style={styles.metaValue}>{generatedAt}</Text>
          </View>
          {/* Unit confirmation — small note so the receiving clinician
              knows whether KH columns are grams, BE (12g), or KE (10g).
              Sits in the meta block (not as a separate banner) so the
              cover stays compact and the existing layout is preserved. */}
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Kohlenhydrat-Einheit</Text>
            <Text style={styles.metaValue}>{carbLabel}</Text>
          </View>
          {/* ICR snapshot in the user's chosen unit (e.g. "2 BE/IE").
              DACH clinics often want to read the dosed insulin against
              the ratio it was calibrated for. Hidden when the user
              hasn't configured ICR yet (hasICR=false) so the cover
              never shows a misleading "0 BE/IE". */}
          {icrLabel !== null && (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>ICR (aktuell)</Text>
              <Text style={styles.metaValue}>{icrLabel}</Text>
            </View>
          )}
          {/* Korrekturfaktor — pairs with the ICR line so a DACH
              clinic can read both ratios side by side (e.g.
              "Korrekturfaktor: 50 mg/dL/IE"). Same suppression rule
              as ICR: hidden when not configured to avoid surfacing a
              misleading "0 mg/dL/IE". */}
          {cfLabel !== null && (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Korrekturfaktor</Text>
              <Text style={styles.metaValue}>{cfLabel}</Text>
            </View>
          )}
        </View>

        {/* ── Insights — Übersicht ───────────────────────────────────
            The 7 explicitly-requested headline metrics with 1-2 sentences
            of context each. These supersede the previous compact KPI
            grids (Glukose / Insulin / Mahlzeiten & Aktivität) on the
            cover; the same numbers still appear in the per-section
            detail tables on subsequent pages. ───────────────────── */}
        <View style={{ marginTop: 24 }}>
          <Text style={styles.sectionHeading}>Insights — Übersicht</Text>
          <Text style={styles.sectionSub}>
            Die zentralen Therapie-Kennzahlen aus deiner Glev-App, mit kurzer Erläuterung für Arzt oder Diabetes-Team.
          </Text>

          {/* Row 1 — Lifetime totals: Total Meals + Avg Carbs/Meal */}
          <View style={styles.insightRow}>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Total Meals</Text>
              <View style={styles.insightValueRow}>
                <Text style={styles.insightValue}>{agg.mealsCount}</Text>
              </View>
              <Text style={styles.insightExpl}>
                Anzahl aller in Glev erfassten Mahlzeiten. Mehr Datenpunkte verbessern die Genauigkeit der adaptiven ICR-Einschätzung und der Muster-Erkennung.
              </Text>
            </View>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Ø Carbs / Mahlzeit</Text>
              <View style={styles.insightValueRow}>
                {/* `formatCarbs` returns "5 BE" / "60 g KH" — split off
                    the trailing "/Mahlzeit" qualifier into the muted
                    unit slot to preserve the existing two-tone styling
                    while keeping a single source of truth for the
                    number+unit string. */}
                <Text style={styles.insightValue}>{fmtCarbsFull(agg.avgCarbsPerMeal)}</Text>
                <Text style={styles.insightUnit}>/ Mahlzeit</Text>
              </View>
              <Text style={styles.insightExpl}>
                Durchschnittliche Kohlenhydrate pro Mahlzeit über alle Einträge. Kernparameter für die Bolus-Berechnung — Basis jeder ICR-Anpassung.
              </Text>
            </View>
          </View>

          {/* Row 2 — Last 7 days: Meals / Carbs / Insulin */}
          <View style={styles.insightRow}>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Letzte 7 Tage · Mahlzeiten</Text>
              <View style={styles.insightValueRow}>
                <Text style={[styles.insightValue, { color: ORANGE }]}>{ins.meals7dCount}</Text>
              </View>
              <Text style={styles.insightExpl}>
                Mahlzeiten der vergangenen Woche. Spiegelt das aktuelle Ess-Muster und wie aktiv die App im Alltag genutzt wird.
              </Text>
            </View>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Letzte 7 Tage · Carbs</Text>
              <View style={styles.insightValueRow}>
                {/* Single `formatCarbs` token (e.g. "60 g KH" / "5 BE")
                    — the number+unit live together to match how the
                    in-app insights surface this metric. */}
                <Text style={styles.insightValue}>{fmtCarbsFull(ins.carbs7dTotal)}</Text>
              </View>
              <Text style={styles.insightExpl}>
                Summe der Kohlenhydrate aus den letzten 7 Tagen. Hilft, kurzfristige Veränderungen in der Ernährung sichtbar zu machen.
              </Text>
            </View>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Letzte 7 Tage · Insulin</Text>
              <View style={styles.insightValueRow}>
                <Text style={[styles.insightValue, { color: ACCENT }]}>{fmtNum(ins.insulin7dUnits, 1)}</Text>
                <Text style={styles.insightUnit}>U</Text>
              </View>
              <Text style={styles.insightExpl}>
                Bolus + Basal der vergangenen 7 Tage. Vergleichbar mit der Total Daily Dose × 7 — nützlich, um Dosis-Drift zu erkennen.
              </Text>
            </View>
          </View>

          {/* Row 3 — Glucose overview: Avg Glucose + 14-day trend */}
          <View style={styles.insightRow}>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>Ø Glucose</Text>
              <View style={styles.insightValueRow}>
                <Text style={styles.insightValue}>{fmtNum(agg.glucoseAvg, 0)}</Text>
                <Text style={styles.insightUnit}>mg/dL · {agg.glucoseSamples} Messungen</Text>
              </View>
              <Text style={styles.insightExpl}>
                Mittelwert aller verfügbaren Glukose-Werte (Fingerstick + Mahlzeit-Kontext). Korreliert mit dem geschätzten HbA1c (GMI).
              </Text>
            </View>
            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>14-Tage Trend</Text>
              <View style={[styles.insightValueRow, { alignItems: "center" }]}>
                <TrendArrow direction={trendDirection} color={trendColor} />
                <Text style={[styles.insightValue, { color: trendColor, marginBottom: 0 }]}>
                  {trendDelta !== null ? `${trendDelta >= 0 ? "+" : ""}${fmtNum(trendDelta, 0)}` : ""}
                </Text>
                <Text style={styles.insightUnit}>mg/dL</Text>
              </View>
              <Text style={styles.insightExpl}>
                Mittelwert-Differenz der vergangenen 7 Tage gegenüber den 7 Tagen davor. Der Pfeil zeigt die Richtung der Verschiebung; grün = Verbesserung, orange = Anstieg.
              </Text>
            </View>
          </View>
        </View>

        {/* ── Klinische Detail-KPIs (TIR-Verteilung, Insulin-Split) ──
            Bleiben aus dem alten Cover-Layout erhalten, weil sie für
            das ärztliche Gespräch wichtig sind und in den Insight-
            Karten oben bewusst aggregiert dargestellt werden. ──── */}
        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionHeading}>Klinische Detail-KPIs</Text>
          <Text style={styles.sectionSub}>
            Verteilung der Glukose-Messungen und Insulin-Split (Bolus/Basal) über den gesamten Erfassungszeitraum.
          </Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Time in Range</Text>
              <Text style={[styles.kpiValue, { color: GREEN }]}>{fmtNum(agg.tir, 0)}<Text style={styles.kpiUnit}>%</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Time below 70</Text>
              <Text style={[styles.kpiValue, { color: PINK }]}>{fmtNum(agg.tbr, 0)}<Text style={styles.kpiUnit}>%</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Time above 180</Text>
              <Text style={[styles.kpiValue, { color: ORANGE }]}>{fmtNum(agg.tar, 0)}<Text style={styles.kpiUnit}>%</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Bolus gesamt</Text>
              <Text style={[styles.kpiValue, { color: ACCENT }]}>{fmtNum(agg.totalBolusUnits, 1)}<Text style={styles.kpiUnit}>U</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Basal gesamt</Text>
              <Text style={[styles.kpiValue, { color: PURPLE }]}>{fmtNum(agg.totalBasalUnits, 1)}<Text style={styles.kpiUnit}>U</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Sport</Text>
              <Text style={[styles.kpiValue, { color: GREEN }]}>{agg.exerciseCount}<Text style={styles.kpiUnit}>· {agg.exerciseMinutes} min</Text></Text>
            </View>
          </View>
        </View>

        <Footer email={email} generatedAt={generatedAt} />
      </Page>

      {/* ─────────────── MAHLZEITEN ─────────────── */}
      <Page size="A4" style={styles.page}>
        <BrandHeader />
        <Text style={styles.sectionHeading}>Mahlzeiten</Text>
        <Text style={styles.sectionSub}>
          {meals.length} erfasste Einträge — die {showMeals.length} jüngsten werden aufgeführt.
        </Text>

        {showMeals.length === 0 ? (
          <Text style={styles.empty}>Keine Mahlzeiten erfasst.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.th}>
              <Text style={[styles.thCell, { width: "16%" }]}>Datum/Zeit</Text>
              <Text style={[styles.thCell, { width: "10%" }]}>Typ</Text>
              <Text style={[styles.thCell, { width: "30%" }]}>Beschreibung</Text>
              <Text style={[styles.thCell, { width: "9%", textAlign: "right" }]}>KH ({carbLabel})</Text>
              <Text style={[styles.thCell, { width: "9%", textAlign: "right" }]}>Insulin (U)</Text>
              <Text style={[styles.thCell, { width: "13%", textAlign: "right" }]}>Glucose vor</Text>
              <Text style={[styles.thCell, { width: "13%", textAlign: "right" }]}>+2h</Text>
            </View>
            {showMeals.map((m, i) => (
              <View key={m.id} style={[styles.tr, ...(i % 2 === 1 ? [styles.trAlt] : [])]} wrap={false}>
                <Text style={[styles.tdMuted, { width: "16%" }]}>{fmtDateTime(m.meal_time || m.created_at)}</Text>
                <Text style={[styles.td, { width: "10%" }]}>{m.meal_type ?? "—"}</Text>
                <Text style={[styles.td, { width: "30%" }]} hyphenationCallback={(w) => [w]}>
                  {(m.input_text || "").slice(0, 80)}
                </Text>
                <Text style={[styles.td, { width: "9%", textAlign: "right" }]}>{fmtCarbsValue(m.carbs_grams)}</Text>
                <Text style={[styles.td, { width: "9%", textAlign: "right" }]}>{fmtNum(m.insulin_units, 1)}</Text>
                <Text style={[styles.td, { width: "13%", textAlign: "right", color: colorForGlucose(m.glucose_before) }]}>
                  {fmtNum(m.glucose_before, 0)}
                </Text>
                <Text style={[styles.td, { width: "13%", textAlign: "right", color: colorForGlucose(m.bg_2h) }]}>
                  {fmtNum(m.bg_2h, 0)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Footer email={email} generatedAt={generatedAt} />
      </Page>

      {/* ─────────────── INSULIN ─────────────── */}
      <Page size="A4" style={styles.page}>
        <BrandHeader />
        <Text style={styles.sectionHeading}>Insulin-Einträge</Text>
        <Text style={styles.sectionSub}>
          {insulin.length} erfasste Einträge — die {showInsulin.length} jüngsten werden aufgeführt.
          {icrLabel !== null && ` · Aktueller ICR: ${icrLabel}`}
        </Text>

        {showInsulin.length === 0 ? (
          <Text style={styles.empty}>Keine Insulin-Einträge erfasst.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.th}>
              <Text style={[styles.thCell, { width: "20%" }]}>Datum/Zeit</Text>
              <Text style={[styles.thCell, { width: "12%" }]}>Typ</Text>
              <Text style={[styles.thCell, { width: "20%" }]}>Präparat</Text>
              <Text style={[styles.thCell, { width: "10%", textAlign: "right" }]}>Dosis (U)</Text>
              <Text style={[styles.thCell, { width: "12%", textAlign: "right" }]}>BG vorher</Text>
              <Text style={[styles.thCell, { width: "13%", textAlign: "right" }]}>BG +1h</Text>
              <Text style={[styles.thCell, { width: "13%", textAlign: "right" }]}>BG +2h</Text>
            </View>
            {showInsulin.map((l, i) => (
              <View key={l.id} style={[styles.tr, ...(i % 2 === 1 ? [styles.trAlt] : [])]} wrap={false}>
                <Text style={[styles.tdMuted, { width: "20%" }]}>{fmtDateTime(l.created_at)}</Text>
                <View style={{ width: "12%" }}>
                  <Text style={[styles.pill, { backgroundColor: pillColorForInsulin(l.insulin_type), alignSelf: "flex-start" }]}>
                    {l.insulin_type}
                  </Text>
                </View>
                <Text style={[styles.td, { width: "20%" }]}>{l.insulin_name || "—"}</Text>
                <Text style={[styles.td, { width: "10%", textAlign: "right" }]}>{fmtNum(l.units, 1)}</Text>
                <Text style={[styles.td, { width: "12%", textAlign: "right", color: colorForGlucose(l.cgm_glucose_at_log) }]}>
                  {fmtNum(l.cgm_glucose_at_log, 0)}
                </Text>
                <Text style={[styles.td, { width: "13%", textAlign: "right", color: colorForGlucose(l.glucose_after_1h ?? null) }]}>
                  {fmtNum(l.glucose_after_1h ?? null, 0)}
                </Text>
                <Text style={[styles.td, { width: "13%", textAlign: "right", color: colorForGlucose(l.glucose_after_2h ?? null) }]}>
                  {fmtNum(l.glucose_after_2h ?? null, 0)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Footer email={email} generatedAt={generatedAt} />
      </Page>

      {/* ─────────────── FINGERSTICKS ─────────────── */}
      <Page size="A4" style={styles.page}>
        <BrandHeader />
        <Text style={styles.sectionHeading}>Fingerstick-Messungen</Text>
        <Text style={styles.sectionSub}>
          {fingersticks.length} erfasste Werte — die {showFingersticks.length} jüngsten werden aufgeführt.
        </Text>

        {showFingersticks.length === 0 ? (
          <Text style={styles.empty}>Keine Fingerstick-Messungen erfasst.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.th}>
              <Text style={[styles.thCell, { width: "30%" }]}>Datum/Zeit</Text>
              <Text style={[styles.thCell, { width: "20%", textAlign: "right" }]}>Wert (mg/dL)</Text>
              <Text style={[styles.thCell, { width: "50%" }]}>Notiz</Text>
            </View>
            {showFingersticks.map((r, i) => (
              <View key={r.id} style={[styles.tr, ...(i % 2 === 1 ? [styles.trAlt] : [])]} wrap={false}>
                <Text style={[styles.tdMuted, { width: "30%" }]}>{fmtDateTime(r.measured_at)}</Text>
                <Text style={[styles.td, { width: "20%", textAlign: "right", color: colorForGlucose(Number(r.value_mg_dl)), fontFamily: "Helvetica-Bold" }]}>
                  {fmtNum(Number(r.value_mg_dl), 0)}
                </Text>
                <Text style={[styles.td, { width: "50%" }]}>{r.notes || ""}</Text>
              </View>
            ))}
          </View>
        )}

        <Footer email={email} generatedAt={generatedAt} />
      </Page>

      {/* ─────────────── SPORT ─────────────── */}
      <Page size="A4" style={styles.page}>
        <BrandHeader />
        <Text style={styles.sectionHeading}>Sport & Aktivität</Text>
        <Text style={styles.sectionSub}>
          {exercise.length} erfasste Einträge — die {showExercise.length} jüngsten werden aufgeführt.
        </Text>

        {showExercise.length === 0 ? (
          <Text style={styles.empty}>Keine Sport-Einträge erfasst.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.th}>
              <Text style={[styles.thCell, { width: "22%" }]}>Datum/Zeit</Text>
              <Text style={[styles.thCell, { width: "20%" }]}>Typ</Text>
              <Text style={[styles.thCell, { width: "12%", textAlign: "right" }]}>Dauer</Text>
              <Text style={[styles.thCell, { width: "12%" }]}>Intensität</Text>
              <Text style={[styles.thCell, { width: "17%", textAlign: "right" }]}>BG Start</Text>
              <Text style={[styles.thCell, { width: "17%", textAlign: "right" }]}>BG Ende</Text>
            </View>
            {showExercise.map((e, i) => (
              <View key={e.id} style={[styles.tr, ...(i % 2 === 1 ? [styles.trAlt] : [])]} wrap={false}>
                <Text style={[styles.tdMuted, { width: "22%" }]}>{fmtDateTime(e.created_at)}</Text>
                <Text style={[styles.td, { width: "20%" }]}>{e.exercise_type}</Text>
                <Text style={[styles.td, { width: "12%", textAlign: "right" }]}>{e.duration_minutes} min</Text>
                <Text style={[styles.td, { width: "12%" }]}>{e.intensity}</Text>
                <Text style={[styles.td, { width: "17%", textAlign: "right", color: colorForGlucose(e.cgm_glucose_at_log) }]}>
                  {fmtNum(e.cgm_glucose_at_log, 0)}
                </Text>
                <Text style={[styles.td, { width: "17%", textAlign: "right", color: colorForGlucose(e.glucose_at_end ?? null) }]}>
                  {fmtNum(e.glucose_at_end ?? null, 0)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Footer email={email} generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// Re-export so the dynamic import in ExportPanel only needs one symbol.
export { Font };
