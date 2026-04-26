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
} from "@react-pdf/renderer";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";

/* ──────────────────────────────────────────────────────────────────
   Brand tokens (mirror app brandbook). React-PDF needs hex/rgb only.
   ────────────────────────────────────────────────────────────────── */

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const PURPLE  = "#A855F7";
const INK     = "#0B0B11";
const MUTED   = "#6B6B7A";
const LINE    = "#E5E5EC";
const BG      = "#FFFFFF";

/* ──────────────────────────────────────────────────────────────────
   Stylesheet
   ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
    backgroundColor: BG,
  },
  // Cover
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  brandDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  brandWord: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: INK,
    letterSpacing: -0.4,
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
  const totalBolusUnits = insulin.filter(l => l.insulin_type === "bolus").reduce((s, l) => s + (l.units || 0), 0);
  const totalBasalUnits = insulin.filter(l => l.insulin_type === "basal").reduce((s, l) => s + (l.units || 0), 0);
  const bolusCount = insulin.filter(l => l.insulin_type === "bolus").length;
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
}

const Footer = ({ email, generatedAt }: { email: string; generatedAt: string }) => (
  <View style={styles.footer} fixed>
    <Text>Glev · Diabetes-Bericht · {email || "—"}</Text>
    <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages} · Erstellt ${generatedAt}`} />
  </View>
);

export function GlevReport({ email, meals, insulin, exercise, fingersticks }: ReportProps) {
  const agg = computeAggregates(meals, insulin, exercise, fingersticks);
  const range = dateRange(
    meals.map(m => ({ when: m.created_at })),
    insulin.map(l => ({ when: l.created_at })),
    exercise.map(e => ({ when: e.created_at })),
    fingersticks.map(f => ({ when: f.measured_at })),
  );
  const generatedAt = new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // Cap long lists so the PDF stays manageable. Recent first.
  const showMeals       = meals.slice(0, 60);
  const showInsulin     = insulin.slice(0, 80);
  const showExercise    = exercise.slice(0, 40);
  const showFingersticks = fingersticks.slice(0, 80);

  return (
    <Document title="Glev Diabetes-Bericht" author="Glev" subject="Diabetes Therapie-Bericht">
      {/* ─────────────── COVER + SUMMARY ─────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot}/>
          <Text style={styles.brandWord}>glev.</Text>
        </View>
        <Text style={styles.title}>Diabetes-Bericht</Text>
        <Text style={styles.subtitle}>Übersicht aller in Glev erfassten Therapie-Daten.</Text>

        <View style={styles.metaBlock}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Patient</Text>
            <Text style={styles.metaValue}>{email || "—"}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Zeitraum</Text>
            <Text style={styles.metaValue}>{range.from} – {range.to}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Erstellt am</Text>
            <Text style={styles.metaValue}>{generatedAt}</Text>
          </View>
        </View>

        {/* Glucose overview */}
        <View style={{ marginTop: 26 }}>
          <Text style={styles.sectionHeading}>Glukose</Text>
          <Text style={styles.sectionSub}>
            Berechnet aus Fingerstick-Werten und Mahlzeit-Kontextwerten ({agg.glucoseSamples} Messungen).
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
              <Text style={styles.kpiLabel}>Mittelwert</Text>
              <Text style={styles.kpiValue}>{fmtNum(agg.glucoseAvg, 0)}<Text style={styles.kpiUnit}>mg/dL</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Fingersticks</Text>
              <Text style={styles.kpiValue}>{fingersticks.length}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Im Bereich</Text>
              <Text style={styles.kpiValue}>{agg.inRange}<Text style={styles.kpiUnit}>von {agg.glucoseSamples}</Text></Text>
            </View>
          </View>
        </View>

        {/* Insulin overview */}
        <View>
          <Text style={styles.sectionHeading}>Insulin</Text>
          <Text style={styles.sectionSub}>Gesamt-Dosen über den gesamten Erfassungszeitraum.</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Bolus gesamt</Text>
              <Text style={[styles.kpiValue, { color: ACCENT }]}>{fmtNum(agg.totalBolusUnits, 1)}<Text style={styles.kpiUnit}>U</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Basal gesamt</Text>
              <Text style={[styles.kpiValue, { color: PURPLE }]}>{fmtNum(agg.totalBasalUnits, 1)}<Text style={styles.kpiUnit}>U</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Bolus-Einträge</Text>
              <Text style={styles.kpiValue}>{agg.bolusCount}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Basal-Einträge</Text>
              <Text style={styles.kpiValue}>{agg.basalCount}</Text>
            </View>
          </View>
        </View>

        {/* Meals + Activity overview */}
        <View>
          <Text style={styles.sectionHeading}>Mahlzeiten & Aktivität</Text>
          <Text style={styles.sectionSub}>Erfasste Mahlzeiten und Sport-Sessions.</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Mahlzeiten</Text>
              <Text style={[styles.kpiValue, { color: ORANGE }]}>{agg.mealsCount}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Kohlenhydrate ges.</Text>
              <Text style={styles.kpiValue}>{fmtNum(agg.totalCarbs, 0)}<Text style={styles.kpiUnit}>g</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Ø Kohlenhydrate</Text>
              <Text style={styles.kpiValue}>{fmtNum(agg.avgCarbsPerMeal, 0)}<Text style={styles.kpiUnit}>g/Mahlzeit</Text></Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Sport-Sessions</Text>
              <Text style={[styles.kpiValue, { color: GREEN }]}>{agg.exerciseCount}</Text>
            </View>
            <View style={styles.kpi}>
              <Text style={styles.kpiLabel}>Sport-Minuten</Text>
              <Text style={styles.kpiValue}>{agg.exerciseMinutes}<Text style={styles.kpiUnit}>min</Text></Text>
            </View>
          </View>
        </View>

        <Footer email={email} generatedAt={generatedAt} />
      </Page>

      {/* ─────────────── MAHLZEITEN ─────────────── */}
      <Page size="A4" style={styles.page}>
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
              <Text style={[styles.thCell, { width: "9%", textAlign: "right" }]}>KH (g)</Text>
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
                <Text style={[styles.td, { width: "9%", textAlign: "right" }]}>{fmtNum(m.carbs_grams, 0)}</Text>
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
        <Text style={styles.sectionHeading}>Insulin-Einträge</Text>
        <Text style={styles.sectionSub}>
          {insulin.length} erfasste Einträge — die {showInsulin.length} jüngsten werden aufgeführt.
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
