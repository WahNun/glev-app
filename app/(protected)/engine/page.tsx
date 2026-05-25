"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47 } from "@/lib/time";
import { fetchMealsForEngine, classifyMeal, computeCalories, saveMeal, deleteMeal, updateMeal, type Meal } from "@/lib/meals";
import { getCurrentTrendArrow } from "@/lib/cgm/trendArrow";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { TYPE_COLORS } from "@/lib/mealTypes";
import { logDebug } from "@/lib/debug";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import { fetchRecentActivityClient, summariseActivityContext, type ActivityContext } from "@/lib/dailyActivity";
import { HIGH_ACTIVITY_RATIO, HIGH_ACTIVITY_MIN_ABS, HIGH_ACTIVITY_MIN_SAMPLE } from "@/lib/engine/evaluation";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { shouldShowBothChips } from "@/lib/engine/doseChipGating";
import { getEffectiveICR } from "@/lib/icrSchedule";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings } from "@/lib/engine/adjustment";
import { applyAdjustmentToSettings, getInsulinSettings, persistEngineIcr, fetchInsulinType } from "@/lib/userSettings";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import { useEngineWizardStep } from "@/lib/engineWizardStepContext";
import EngineLogTab, { InsulinForm, ExerciseForm } from "@/components/EngineLogTab";
import FingerstickLogCard from "@/components/FingerstickLogCard";
import { CycleForm, SymptomForm } from "@/components/CycleSymptomForms";
import { InfluenceForm } from "@/components/InfluenceLogForm";
import GlevLogo from "@/components/GlevLogo";
import EngineChatPanel, { type SeedMessage } from "@/components/EngineChatPanel";
import { useEngineHeader } from "@/lib/engineHeaderContext";
import { useEngineSourceHeader } from "@/lib/engineSourceHeaderContext";
import { useVoiceRecording } from "@/lib/voiceRecordingContext";
import { fetchLatestCgm } from "@/components/CgmFetchButton";
import { classifyPreReferenceTrend, type TrendClass, type TrendSample } from "@/lib/engine/trend";
import { fetchLatestFingerstick, FS_OVERRIDE_WINDOW_MS } from "@/lib/fingerstick";
import { parseDbTs, parseDbDate, parseLluTs } from "@/lib/time";
import { calcTotalIOB, applyIOBCorrection, iobCorrectionRoundedToZero, formatIOBDisplay, type InsulinType } from "@/lib/iob";
import { resolveActiveDose } from "@/lib/engine/activeDose";
import { calcEagerDose } from "@/lib/engine/eagerDose";
import { fetchMeals } from "@/lib/meals";
import { hapticSuccess, hapticError, hapticSelection } from "@/lib/haptics";
import SnapSlider from "@/components/log/SnapSlider";
import ReviewMacrosCards from "@/components/ReviewMacrosCards";

// datetime-local needs "YYYY-MM-DDTHH:mm" in the *local* timezone (the input
// strips the offset). Using toISOString() would silently shift the value to
// UTC; this helper keeps the wall-clock the user expects.
function nowLocalDateTime(): string {
  const d   = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="var(--surface)", BORDER="var(--border)";

/**
 * Structured payload for the recommendation's reasoning line. The
 * engine returns the *shape* of the explanation, not a pre-rendered
 * string, so the render site can translate it under the active locale
 * (with proper ICU plural forms for `count`). This mirrors the same
 * pattern the meal-wizard view uses on /log.
 */
type ReasoningPayload =
  | { kind: "historical"; count: number; avg: number }
  | { kind: "blended"; count: number }
  | { kind: "formula"; carbs: number; icr: number; correction: number };

interface Recommendation {
  dose: number;
  confidence: "HIGH"|"MEDIUM"|"LOW";
  source: string;
  /** Structured reason — translate at render time, not engine-run time. */
  reasoning: ReasoningPayload;
  /** Already-translated safety / context bullets (basal, stacking, exercise). */
  safetyNotes: string[];
  carbDose: number;
  correctionDose: number;
  similarMeals: Meal[];
}

/**
 * Translator handle compatible with `useTranslations("engine")`. Accepts a
 * key plus an optional ICU values dict and returns the formatted string.
 * Kept as a structural type so the helpers below can be unit-tested with
 * a stub without pulling next-intl into the test runner.
 */
type EngineTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * Locale-aware number formatter: returns the decimal-string for `n`
 * trimmed to at most `digits` fraction digits using BCP-47 rules
 * (German uses comma decimals). Centralised so the reasoning text
 * always renders "5,5 IE" in DE and "5.5 u" in EN.
 */
type NumFormatter = (n: number, digits?: number) => string;

/**
 * Append safety / context notes derived from recent insulin & exercise logs.
 * Pure documentation — does not change the dose.
 *  - Basal logged in the last 24h is mentioned for context.
 *  - More than 2 boluses in the last 6h triggers a stacking-risk warning.
 *  - Exercise (cardio or any high-intensity) in the last 4h is flagged.
 *
 * Strings are emitted via the injected translator so the same engine
 * runs render in DE or EN depending on the active locale.
 */
function safetyNotesFromLogs(
  insulinLogs: InsulinLog[],
  exerciseLogs: ExerciseLog[],
  t: EngineTranslator,
  fmt: NumFormatter,
  activity?: ActivityContext | null,
): string[] {
  const now = Date.now();
  const sixHoursAgo  = now - 6  * 3600_000;
  const fourHoursAgo = now - 4  * 3600_000;
  const dayAgo       = now - 24 * 3600_000;
  const notes: string[] = [];
  const unitsShort = t("units_short");

  const recentBolus = insulinLogs.filter(l =>
    l.insulin_type === "bolus" && parseDbTs(l.created_at) >= sixHoursAgo,
  );
  if (recentBolus.length > 2) {
    const total = Math.round(recentBolus.reduce((s, l) => s + (l.units || 0), 0) * 10) / 10;
    notes.push(t("safety_stacking", {
      count: recentBolus.length,
      total: fmt(total, 1),
      units: unitsShort,
    }));
  }

  const recentBasal = insulinLogs.filter(l =>
    l.insulin_type === "basal" && parseDbTs(l.created_at) >= dayAgo,
  );
  if (recentBasal.length > 0) {
    const last = recentBasal[0];
    const hoursAgo = Math.max(0, Math.round((now - parseDbTs(last.created_at)) / 3600_000));
    notes.push(t("safety_basal", {
      amount: fmt(last.units || 0, 1),
      units: unitsShort,
      name: last.insulin_name || t("safety_basal_default_name"),
      hours: hoursAgo,
    }));
  }

  const recentExercise = exerciseLogs.filter(l =>
    parseDbTs(l.created_at) >= fourHoursAgo,
  );
  if (recentExercise.length > 0) {
    const e = recentExercise[0];
    notes.push(t("safety_exercise", {
      minutes: e.duration_minutes,
      type: e.exercise_type,
      intensity: e.intensity,
    }));
  }

  // Task #183: passive-activity safety note. Renders the same
  // compliance-safe wording as the engine recommendation message but
  // formatted through the engine translator alongside the other
  // safety notes. Single source of truth for the threshold cutoffs
  // (`HIGH_ACTIVITY_*` constants live in `lib/engine/evaluation.ts`).
  if (
    activity &&
    activity.todaySteps != null &&
    activity.avgSteps7d != null &&
    activity.sampleSize7d >= HIGH_ACTIVITY_MIN_SAMPLE &&
    activity.todaySteps >= HIGH_ACTIVITY_MIN_ABS &&
    activity.todaySteps >= Math.round(activity.avgSteps7d * HIGH_ACTIVITY_RATIO)
  ) {
    notes.push(t("engine_rec_high_activity", {
      steps: activity.todaySteps,
      avg: activity.avgSteps7d,
    }));
  }

  return notes;
}

function runGlevEngine(
  meals: Meal[],
  currentGlucose: number,
  carbs: number,
  insulinLogs: InsulinLog[],
  exerciseLogs: ExerciseLog[],
  icr: number,
  t: EngineTranslator,
  fmt: NumFormatter,
  preTrend?: TrendClass,
  // Phase B (Matildav window-ICR): meal timestamp the recommendation is
  // for. When the user has the ICR-schedule master toggle on AND a slot
  // covers this minute, the recommender uses the slot's ICR instead of
  // the global one. Falls back to `icr` otherwise (and when called
  // without a time — keeps `recommendDose` parity for older callers).
  mealTime?: Date | null,
  // Task #183: optional Apple-Health daily-step context. Surfaces as a
  // safety note inside the recommendation reasoning when today crosses
  // the shared "high activity day" threshold. Dose math is unchanged.
  activity?: ActivityContext | null,
): Recommendation {
  const { cf, targetBg: target } = getInsulinSettings();
  // Resolve which ICR actually grades this meal. If the schedule toggle
  // is off or no slot matches, `effectiveIcr === icr` and the formula
  // path renders identical reasoning to before. When a slot wins, the
  // dose, the formula reasoning line, and the post-hoc evaluation in
  // `lib/engine/evaluation.ts` all consult the same value, so the user
  // never sees a recommendation that contradicts the later grade.
  const effectiveIcr = mealTime
    ? getEffectiveICR(mealTime, icr).icr
    : icr;
  const carbDose = carbs / effectiveIcr;
  const correctionDose = Math.max(0, (currentGlucose - target) / cf);
  const formulaDose = Math.round((carbDose + correctionDose) * 10) / 10;

  const similar = meals.filter(m =>
    m.carbs_grams !== null && Math.abs((m.carbs_grams||0) - carbs) <= 12 &&
    m.glucose_before !== null && Math.abs((m.glucose_before||0) - currentGlucose) <= 35 &&
    (m.evaluation === "GOOD") && m.insulin_units
  );

  // Safety notes are still emitted as already-translated strings — they
  // pull live timing data from the recent-logs window and don't benefit
  // from being re-rendered on locale flip (the engine re-runs on dose
  // input changes anyway). The reason payload, on the other hand, stays
  // raw so the render site can apply ICU plural forms per locale.
  const safetyNotes = safetyNotesFromLogs(insulinLogs, exerciseLogs, t, fmt, activity);

  // Pre-Meal-Trend-Hinweis (Task #195) — strikt Doku, Dosis bleibt
  // unverändert. Bei `rising_fast` knapp über dem Ziel zusätzlich der
  // Overshoot-Hinweis. Schwellen für "knapp über Ziel" sind dieselben
  // wie in `recommendDose` (≤ 40 mg/dL über Ziel = "knapp").
  if (preTrend) {
    safetyNotes.push(t(`engine_rec_trend_${preTrend}` as never));
    if (preTrend === "rising_fast" && currentGlucose > target && currentGlucose - target <= 40) {
      safetyNotes.push(t("engine_rec_trend_overshoot_warn"));
    }
  }

  if (similar.length >= 3) {
    const avg = Math.round(similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length * 10)/10;
    return {
      dose: avg, confidence:"HIGH", source:"historical",
      reasoning: { kind: "historical", count: similar.length, avg },
      safetyNotes,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar.slice(0,5),
    };
  }

  if (similar.length >= 1) {
    const histAvg = similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length;
    const blended = Math.round(((histAvg + formulaDose)/2)*10)/10;
    return {
      dose: blended, confidence:"MEDIUM", source:"blended",
      reasoning: { kind: "blended", count: similar.length },
      safetyNotes,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar,
    };
  }

  return {
    dose: formulaDose, confidence:"LOW", source:"formula",
    reasoning: {
      kind: "formula",
      carbs,
      // Show the ICR that actually drove the dose so the reasoning
      // line and the math the user can verify in their head match. If
      // no schedule slot matched, this equals the original `icr` arg.
      icr: effectiveIcr,
      correction: Math.round(correctionDose*10)/10,
    },
    safetyNotes,
    carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
    similarMeals:[],
  };
}

/**
 * Turn a structured {@link ReasoningPayload} into the user-facing string
 * for the active locale, then append any safety bullets. Lives next to
 * the engine so the rendering rule for each `kind` stays close to the
 * payload that produced it.
 */
function renderReasoning(
  reasoning: ReasoningPayload,
  safetyNotes: string[],
  t: EngineTranslator,
  fmt: NumFormatter,
): string {
  const unitsShort = t("units_short");
  let main: string;
  switch (reasoning.kind) {
    case "historical":
      main = t("reason_historical", {
        count: reasoning.count,
        avg: fmt(reasoning.avg, 1),
        units: unitsShort,
      });
      break;
    case "blended":
      main = t("reason_blended", { count: reasoning.count });
      break;
    case "formula":
      main = t("reason_formula", {
        carbs: reasoning.carbs,
        icr: reasoning.icr,
        correction: fmt(reasoning.correction, 1),
        units: unitsShort,
      });
      break;
  }
  return safetyNotes.length > 0 ? `${main} ${safetyNotes.join(" ")}` : main;
}

const CONF_COLOR: Record<string, string> = { HIGH:GREEN, MEDIUM:ORANGE, LOW:PINK };

/**
 * Small inline arrow next to the current glucose value (Task #204).
 * Renders the classified pre-meal trend (rising_fast / rising / stable
 * / falling / falling_fast) as a single-character glyph with a
 * trend-appropriate accent color and a `title` tooltip carrying the
 * existing localised explanation (`engine_rec_trend_<class>`). Pure
 * presentational — does not affect the dose calculation.
 *
 * Color rationale: sharp moves (rising_fast / falling_fast) use the
 * warning palette (orange / pink) since they're the ones the user
 * should *react* to; gentle moves stay accent-blue; stable goes to
 * the dimmed text color so it visually recedes.
 */
function TrendArrow({ trend, t }: { trend: TrendClass; t: EngineTranslator }): React.ReactElement {
  const META: Record<TrendClass, { glyph: string; color: string }> = {
    rising_fast:  { glyph: "↑", color: ORANGE },
    rising:       { glyph: "↗", color: ACCENT },
    stable:       { glyph: "→", color: "var(--text-dim)" },
    falling:      { glyph: "↘", color: ACCENT },
    falling_fast: { glyph: "↓", color: PINK },
  };
  const m = META[trend];
  const tooltip = t(`engine_rec_trend_${trend}` as never);
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      data-testid={`engine-trend-arrow-${trend}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 18, height: 18, borderRadius: 4, padding: "0 4px",
        fontSize: 14, lineHeight: 1, fontWeight: 800,
        color: m.color, background: `${m.color === "var(--text-dim)" ? "var(--surface-2, rgba(255,255,255,0.06))" : m.color + "1f"}`,
      }}
    >
      {m.glyph}
    </span>
  );
}

export default function EnginePage() {
  // Aliased to tEngine because a local `t` already shadows the
  // common translation handle inside the searchParams effect below
  // (it holds the parsed ?tab= value). Keeping both lets the page
  // pull engine-specific copy without a rename storm in the rest of
  // the (~1900-line) component.
  const tEngine = useTranslations("engine");
  // Adjustment suggestion messages live under `insights` (engine_msg_*),
  // since they're shared with the Insights tab. Use a dedicated handle
  // so we can render `AdjustmentMessage.key` with its params verbatim.
  const tInsights = useTranslations("insights");
  // Carb-unit selector (g / BE / KE) — DACH users typically rechnen in
  // BE/KE statt Gramm. The hook owns conversion at this UI boundary;
  // everything below the boundary (saveMeal, runGlevEngine, classify*,
  // compute*) keeps operating in grams. See app/(protected)/settings
  // for where the unit is chosen.
  const carbUnit = useCarbUnit();
  // Locale-aware decimal formatter — keeps reasoning bullets natural for
  // the active language ("5,5 IE" in DE, "5.5 u" in EN). Cached against
  // the current locale to avoid rebuilding the Intl.NumberFormat instance
  // on every dose calc / re-render.
  const locale = useLocale();
  const bcp47 = localeToBcp47(locale);
  const formatNum = useMemo<NumFormatter>(() => {
    const cache = new Map<number, Intl.NumberFormat>();
    return (n: number, digits = 1) => {
      if (!Number.isFinite(n)) return String(n);
      let nf = cache.get(digits);
      if (!nf) {
        nf = new Intl.NumberFormat(bcp47, { maximumFractionDigits: digits });
        cache.set(digits, nf);
      }
      return nf.format(n);
    };
  }, [bcp47]);
  // Adapter: useTranslations returns a callable handle that next-intl
  // types narrowly per-namespace. We need a structural type so the
  // helper functions above (declared at module scope) can stay
  // testable. The wrapper just forwards into the namespaced handle.
  const tEngineFn: EngineTranslator = useMemo(
    () => (key, values) => tEngine(key as Parameters<typeof tEngine>[0], values),
    [tEngine],
  );
  const [tab, setTab]         = useState<"engine"|"log"|"bolus"|"exercise"|"fingerstick"|"cycle"|"symptoms"|"influences">("engine");
  // Biological sex — gates the cycle tab from the engine tab strip and
  // protects against deep-linked `?tab=cycle` for male users. Defaults
  // to "show everything" while loading so we don't briefly hide it for
  // a returning female user.
  const [showCycleTab, setShowCycleTab] = useState<boolean>(true);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/userProfile").then(({ fetchUserProfile, cycleSurfacesAvailable }) => {
      fetchUserProfile()
        .then((p) => { if (!cancelled) setShowCycleTab(cycleSurfacesAvailable(p.sex)); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);
  // If the user lands on `?tab=cycle` (or had it selected last) and the
  // profile resolves to male, bump them back to the engine tab so the
  // hidden cycle form can never render under them.
  useEffect(() => {
    if (!showCycleTab && tab === "cycle") setTab("engine");
  }, [showCycleTab, tab]);
  // Sync the active sub-tab from the URL ?tab= query so deep-links
  // from the header QuickAddMenu ("Glukose messen", "Insulin loggen",
  // "Sport loggen") land directly on the right card. We listen to
  // searchParams (not just []) so re-picking an item while already
  // on /engine still switches tabs — Next.js does NOT remount the
  // page when only the query string changes.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!searchParams) return;
    const t = searchParams.get("tab");
    if (t === "log" || t === "bolus" || t === "exercise" || t === "fingerstick" || t === "engine" || t === "cycle" || t === "symptoms" || t === "influences") {
      setTab(t);
    }
  }, [searchParams]);
  // Auto-start the voice recording when the user lands on /engine via
  // the quick-add "Voice" entry (?voice=1). The bottom-nav Glev FAB
  // doubles as the STOP control once recording is live (see
  // voiceRecordingContext + Layout.tsx). We only fire once per landing
  // — a guard ref prevents StrictMode double-invoke and prevents a
  // second take if the user navigates back without a fresh ?voice=1.
  // Per-trigger signature. We do NOT use a plain `hasFired` boolean
  // because the URL gets stripped via window.history.replaceState
  // below — that doesn't notify Next, so a later `router.push(...?voice=1)`
  // from the bottom-nav Glev FAB would update searchParams but a
  // boolean latch would still be true and we'd skip the auto-start.
  // Result before this fix: after the first take, tapping the Glev FAB
  // again did nothing (user report 2026-05-17: "dann ist es aktuell
  // unmöglich die spracheingabe per einfachen klick auf glev button
  // fortzusetzen sobald einmal angehalten hat"). We now stamp a
  // monotonically growing token into the URL (?voice=1&vt=<ts>) on
  // every push and remember the last token we acted on — every fresh
  // FAB tap carries a new token and therefore re-triggers.
  const voiceLastTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get("voice") !== "1") return;
    const token = searchParams.get("vt") ?? "init";
    if (voiceLastTokenRef.current === token) return;
    voiceLastTokenRef.current = token;
    // Strip the ?voice=1 from the URL so a refresh / back-navigation
    // doesn't auto-record a second time. History replace keeps the
    // current scroll position and doesn't add to the back stack.
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.delete("voice");
      u.searchParams.delete("vt");
      // Preserve the existing window.history.state payload (Next App
      // Router stores its own routing state there for back/forward +
      // cache restoration). Passing `null` here would wipe that and
      // corrupt subsequent navigation; reusing the current state is
      // the documented escape hatch when you only want to mutate the
      // URL without triggering a Next navigation.
      window.history.replaceState(window.history.state, "", u.pathname + (u.search ? u.search : "") + u.hash);
    }
    // Defer one tick so the rest of the engine page (mediaRec refs,
    // speechAvail probe) has a chance to settle before we kick off
    // getUserMedia.
    const id = setTimeout(() => { void startRecording(); }, 0);
    return () => clearTimeout(id);
    // startRecording reads stable refs / state setters, so it doesn't
    // need to be in the dep list and re-running on its identity would
    // just create an extra auto-start race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [isMobile, setIsMobile] = useState(false);
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [adaptedICR, setAdaptedICR] = useState(15);
  const [selectedICR, setSelectedICR] = useState<'static' | 'adaptive'>('adaptive');
  const [icrConfidence, setIcrConfidence] = useState<"low" | "medium" | "high">("low");
  const [icrSampleSize, setIcrSampleSize] = useState(0);
  // How many of the contributing meals took their insulin value from a
  // paired bolus log (vs falling back to meal.insulin_units). Surfaced
  // in the recommendation card so the user can see whether the ICR is
  // being driven by separately-logged shots or the meal column.
  const [icrPairedCount, setIcrPairedCount] = useState(0);
  const [icrPairedExplicitCount, setIcrPairedExplicitCount] = useState(0);
  const [icrPairedTimeWindowCount, setIcrPairedTimeWindowCount] = useState(0);
  const [insulinLogs, setInsulinLogs] = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  // Task #183: passive Apple-Health step context. `null` = not loaded
  // / no data on this device — the engine then silently skips the
  // high-activity annotation.
  const [activityCtx, setActivityCtx] = useState<ActivityContext | null>(null);
  // Adaptive engine adjustment banner state. `dismissedSig` is hydrated
  // from localStorage on mount and bumped whenever the user verwirft
  // (or successfully applies) a suggestion, so the banner doesn't keep
  // re-appearing for the same pattern. `historyTick` is bumped after a
  // successful apply so the suggestion re-renders against fresh ICR/CF
  // values (rotating to whatever the engine recommends next).
  const [adjustmentBusy, setAdjustmentBusy] = useState(false);
  const [adjustmentErr, setAdjustmentErr] = useState<string | null>(null);
  const [dismissedSigs, setDismissedSigs] = useState<Record<string, number>>({});
  const [adjustmentTick, setAdjustmentTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [iob, setIob] = useState<number>(0);
  const [iobDisplay, setIobDisplay] = useState<string | null>(null);
  const [insulinType, setInsulinType] = useState<InsulinType>('rapid');
  const [glucose, setGlucose] = useState("");
  // The `carbs` form state holds the user-displayed value in their
  // chosen unit (g / BE / KE) — see useCarbUnit below. All persistence
  // (saveMeal, runGlevEngine, classifyMeal, computeCalories) operates
  // in GRAMS, so every read of this state goes through carbUnit.toGrams()
  // before being handed off. AI-parse results come back in grams and are
  // converted via carbUnit.fromGrams() before being written back here.
  const [carbs, setCarbs]     = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat]         = useState("");
  const [fiber, setFiber]     = useState("");
  const [desc, setDesc]       = useState("");
  const [result, setResult]   = useState<Recommendation|null>(null);
  const [resultICRSource, setResultICRSource] = useState<'adaptive' | 'static' | null>(null);
  const [running, setRunning] = useState(false);
  const [cgmPulling, setCgmPulling] = useState(false);
  const [lastReading, setLastReading] = useState<string>("");
  // Pre-Meal-Trend (Task #195): Wir cachen nur die rohen CGM-Samples
  // aus /api/cgm/history. Die Trend-Klassifikation läuft pro
  // Engine-Aufruf gegen die jeweils aktive Bezugszeit (`mealTime`),
  // sonst würde ein beim Page-Mount berechneter Trend stehen bleiben,
  // selbst wenn der User die Mahlzeitzeit später anpasst oder die
  // Empfehlung erst Minuten später anstößt. Der Slice auf 3–5 Samples
  // vor der Referenz passiert in `lib/engine/trend.classifyPreReferenceTrend`.
  const [trendSamples, setTrendSamples] = useState<TrendSample[]>([]);
  // 3-Step Wizard state — drives which view of the Engine tab is shown.
  // 0 = "Was hast du gegessen?" (voice/text input)
  // 1 = "Makros prüfen" (macros + glucose + meal time)
  // 2 = "Deine Empfehlung" (recommendation + Bestätigen & Speichern)
  // Cross-step state (glucose, carbs, etc.) stays at the page level — only
  // the rendering switches per step. Component is single-mount so going
  // back/forward preserves all field values automatically.
  const [stepIndex, setStepIndex] = useState<0 | 1 | 2>(0);
  // FIX A: After Step 3 save, we hold the committed dose here so the wizard
  // can show "✓ Gespeichert — N IE geloggt" instead of auto-resetting. Null
  // = not yet saved (default), number = saved with that many IE. The user's
  // explicit "Neues Essen" click clears this and resets the form.
  const [wizardSavedDose, setWizardSavedDose] = useState<number | null>(null);
  // Step 2 tertiary path: experienced users can type the bolus dose
  // directly (without running the engine) via a small collapsible
  // input row below the "Bolus berechnen" secondary button.
  // directBolusOpen toggles the inline number-input + save row;
  // directBolusValue is the IE entered. Both reset when the wizard
  // is reset (handleNewMeal) so the next meal starts clean.
  const [directBolusOpen, setDirectBolusOpen] = useState(false);
  const [directBolusValue, setDirectBolusValue] = useState("");
  // manualDose: optional user override for the bolus dose on the Makros tab.
  // When non-empty, it takes priority over both eagerDoses and result.dose.
  const [manualDose, setManualDose] = useState("");
  // BolusExplainerSheet — bottom-sheet that replaces Step 3 as a
  // separate wizard page. Opened by handleRun (after engine calc
  // completes); closed by backdrop tap or the × button.
  const [bolusExplainerOpen, setBolusExplainerOpen] = useState(false);
  // Bolus-toggle in Step 2 (Makros): default OFF = "ohne Bolus speichern".
  // Resets to false on every new meal so the user always starts clean.
  const [bolusEnabled, setBolusEnabled] = useState(false);
  // Tabs-expanded state lives in the global EngineHeaderContext so the
  // chevron control can render in the mobile app header (oben rechts
  // next to Live + user icon) instead of inside this page body. We
  // alias the hook return value to keep the rest of the page readable.
  const engineHdr = useEngineHeader();
  const tabsExpanded    = engineHdr.tabsExpanded;
  const setTabsExpanded = engineHdr.setTabsExpanded;
  // Source/provenance pill now lives in the global mobile app header
  // (oben rechts neben dem Glev-Lockup) instead of stealing a row at
  // the top of the Step-2 macros card — User-Wunsch 2026-05-17 "der
  // source estimated chip kann in den header wandern so sparen wir
  // platz". The page publishes the current `nutritionSource` here and
  // clears it on unmount + on `handleNewMeal` so other routes don't
  // inherit a stale pill.
  const sourceHdr = useEngineSourceHeader();
  // Wizard step indicator now lives in the global mobile app header
  // (centred between the brand lockup and right chips) — same pattern
  // as the source provenance pill. Publish the active stepIndex so
  // the header can render the slim 3-segment track without stealing
  // vertical space from the wizard content area.
  const wizardStepHdr = useEngineWizardStep();
  useEffect(() => {
    wizardStepHdr.setStep(stepIndex);
    return () => { wizardStepHdr.setStep(null); };
  }, [stepIndex, wizardStepHdr.setStep]);

  // Voice assistant: glev:set-macro CustomEvent → update macro form fields live.
  // Fired by useGlevAI when the AI calls the set_macro tool (Phase 2 voice).
  // Carbs respect the user's unit preference via carbUnit.fromGrams(); protein
  // and fat are always grams so they round to 1 decimal directly.
  useEffect(() => {
    function handleSetMacro(e: Event) {
      const { field, value } = (e as CustomEvent<{ field: string; value: number }>).detail;
      if (field === "carbs")   setCarbs(String(Math.round(carbUnit.fromGrams(value) * 10) / 10));
      if (field === "protein") setProtein(String(Math.round(value * 10) / 10));
      if (field === "fat")     setFat(String(Math.round(value * 10) / 10));
      if (field === "fiber")   setFiber(String(Math.round(value * 10) / 10));
    }
    window.addEventListener("glev:set-macro", handleSetMacro);
    return () => window.removeEventListener("glev:set-macro", handleSetMacro);
  // carbUnit is stable (memo inside the hook) so it won't retrigger on every render.
  // setXxx setters from useState are also stable — safe to omit from the dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carbUnit]);

  // FIX C: Tab strip is collapsed by default to give Step 1's voice/text
  // input the full vertical real estate. The chevron control itself now
  // lives in the global mobile app header (see Layout.tsx); this page
  // only renders the expanded tab buttons row when tabsExpanded === true.
  // Step 3 GPT Reasoning section is collapsible to keep the result card
  // scannable; user expands by tapping the chevron.
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  // Voice input state — feeds the macro fields by transcribing → /api/parse-food.
  const [recording, setRecording]   = useState(false);
  const [parsing, setParsing]       = useState(false);
  const [transcript, setTranscript] = useState("");
  const [voiceErr, setVoiceErr]     = useState("");
  // Capture the AI-supplied meal classification from the most recent
  // /api/parse-food round-trip. The GPT classifier and lib/meals.classifyMeal
  // share the same rules now, so the AI value is the canonical answer when
  // available. Cleared on every new recording so a stale AI label can't
  // bleed into a freshly typed meal. Falls back to classifyMeal() when null.
  const [aiMealType, setAiMealType] = useState<string | null>(null);
  // Provenance of the macros currently in the form, surfaced as a badge
  // in Step 2 next to the macros section header. Updated whenever
  // /api/parse-food (voice + initial chat) or /api/chat-macros (chat
  // refinements) returns a `nutritionSource` field, and reset alongside
  // the macro fields on every new-meal flow.
  const [nutritionSource, setNutritionSource] =
    useState<"database" | "mixed" | "estimated" | "unknown" | null>(null);
  // Mirror nutritionSource into the global app-header context so the
  // provenance pill renders next to the brand lockup on mobile (see
  // Layout.tsx). Clearing on unmount prevents the pill from sticking
  // around when the user navigates to another route mid-flow.
  useEffect(() => {
    sourceHdr.setSource(nutritionSource);
    // Depend on the stable setter only — the provider value object is
    // freshly allocated each render, so depending on `sourceHdr` itself
    // would re-run this effect every render with the same value.
  }, [nutritionSource, sourceHdr.setSource]);
  useEffect(() => {
    return () => { sourceHdr.setSource(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Per-item nutrition breakdown from the two-stage pipeline
  // (lib/nutrition/aggregate). Captured from /api/parse-food and
  // /api/chat-macros so the saved meal preserves PER-ITEM provenance
  // in meals.parsed_json (jsonb) — auditable later. Empty when the
  // user typed macros manually with no AI parse, in which case the
  // save sites fall back to the legacy single-item synthesized shape.
  const [parsedItems, setParsedItems] = useState<Array<{
    name: string;
    grams: number;
    carbs: number;
    protein: number;
    fat: number;
    fiber: number;
    source: "open_food_facts" | "usda" | "estimated" | "unknown";
  }>>([]);
  // Phase B: portion suggestions from user_food_history.
  // Keyed by raw item name (as returned by /api/parse-food).
  // Value is { suggestedGrams, displayName } — only populated when
  // the user has a history row for that item.
  const [portionSuggestions, setPortionSuggestions] = useState<Map<string, { suggestedGrams: number; displayName: string }>>(new Map());
  // Set of raw item names the user has dismissed this session.
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [speechAvail, setSpeechAvail] = useState(true);
  const mediaRecRef    = useRef<MediaRecorder | null>(null);
  const recordingStopTsRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Bridge local recording state up to the global chrome so the
  // bottom-nav Glev FAB can act as the stop control and the header
  // can render the "Speak" pill (see lib/voiceRecordingContext).
  const voiceCtx = useVoiceRecording();
  useEffect(() => {
    voiceCtx.setRecording(recording);
  }, [recording, voiceCtx]);
  useEffect(() => {
    voiceCtx.registerStopHandler(() => {
      // Guard: only stop if a recording is actually live; otherwise
      // ignore so a stray FAB tap can't dispatch into the MediaRecorder.
      if (mediaRecRef.current && mediaRecRef.current.state !== "inactive") {
        stopRecording();
      }
    });
    return () => voiceCtx.unregisterStopHandler();
    // stopRecording is a stable in-component function; including it
    // would re-register on every render with no behavioural change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceCtx]);
  // Defensive unmount cleanup: if the user navigates away from /engine
  // while a recording is still live, we must (1) stop the MediaRecorder
  // so its onstop fires and tracks are released, (2) hard-stop any
  // surviving stream tracks so the OS mic indicator goes away, and
  // (3) reset the global recording flag — otherwise the bottom-nav
  // Glev FAB would stay stuck in "stop" mode globally, blocking the
  // quick-add sheet on every other screen.
  useEffect(() => {
    return () => {
      const rec = mediaRecRef.current;
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch { /* noop */ }
        try { rec.stream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      }
      voiceCtx.setRecording(false);
    };
    // We intentionally run this cleanup ONLY on unmount, not on every
    // render. The cleanup reads refs/setters that are stable across
    // renders, so an empty dep list is the correct contract here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load insulin type from user_settings on mount. Falls back to 'rapid'
  // if not set or the DB is unreachable (fetchInsulinType always resolves).
  useEffect(() => {
    fetchInsulinType().then(setInsulinType).catch(() => {});
  }, []);

  // Confirm-Log + integrated chat state. mealTime defaults to "now"; insulin
  // is left blank until a recommendation arrives or the user types one in.
  const [mealTime,    setMealTime]    = useState<string>(() => nowLocalDateTime());
  const [insulin,     setInsulin]     = useState("");
  const [confirming,  setConfirming]  = useState(false);
  const [confirmErr,  setConfirmErr]  = useState("");
  // After a successful Confirm Log, the form does NOT reset — instead we
  // park the saved row here so the post-confirm decision panel can offer
  // 1) link a bolus  2) compute a recommendation  3) cancel/delete the log.
  // confirmedMeal == null  → form mode (Confirm Log button visible)
  // confirmedMeal != null  → decision mode (form fields locked for context)
  const [confirmedMeal, setConfirmedMeal] = useState<Meal | null>(null);
  // Sub-state inside the decision panel.
  //   "decision" = the 3 binary-choice buttons (Bolus / Empfehlung / Abbrechen).
  //   "rec"      = the recommendation result + Übernehmen→/Zurück buttons.
  //   "insulin"  = editable insulin input + Confirm Log + Zurück. Reached from
  //                EITHER "decision" via Bolus loggen (input starts blank)
  //                OR "rec" via Übernehmen→ (input pre-populated with rec.dose,
  //                still editable). Wir patchen die Dosis erst HIER, nie silent.
  const [decisionMode,  setDecisionMode]  = useState<"decision" | "rec" | "insulin">("decision");
  const [decisionRec,   setDecisionRec]   = useState<Recommendation | null>(null);
  const [decisionBusy,  setDecisionBusy]  = useState(false);
  const [decisionToast, setDecisionToast] = useState<string | null>(null);
  // Inline error inside the insulin sub-mode (validation + PATCH failures).
  const [decisionInsulinErr, setDecisionInsulinErr] = useState<string | null>(null);
  const [chatSeed,    setChatSeed]    = useState<SeedMessage | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  // Track whether the user has ever used voice input. Drives the
  // collapsed-state hint on the AI FOOD PARSER chip ("▸ Tippe um
  // Details zu sehen") — once they've spoken once, the hint disappears
  // permanently for that session because the auto-expand on parse
  // already taught them the panel exists.
  const [hasUsedVoice, setHasUsedVoice] = useState(false);
  // Ref on the AI FOOD PARSER mobile wrapper so the post-transcription
  // sequence (fields fill → reasoning expands → scrollIntoView) can
  // bring the panel into view smoothly.
  const chatPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined");
    if (!ok) setSpeechAvail(false);
  }, []);

  // On-mount Junction CGM auto-fill — fetch the latest glucose reading via
  // /api/cgm/glucose (Junction LibreView path; the existing LibreLink-Up
  // direct integration via handlePullCgm is independent and unchanged).
  // Never blocks: the route is built to fail silently and return
  // { connected: false } on any error, and this effect itself swallows
  // network failures so the engine page always renders. We use a ref to
  // ensure we only auto-fill on first mount — if the user has already
  // typed a glucose value or pulled via the CGM button, we don't overwrite.
  const cgmAutoFillTriedRef = useRef(false);
  useEffect(() => {
    if (cgmAutoFillTriedRef.current) return;
    cgmAutoFillTriedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/cgm/glucose", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { connected?: boolean; glucose?: number | null };
        if (cancelled) return;
        if (j.connected && typeof j.glucose === "number" && j.glucose > 0) {
          setGlucose(prev => prev === "" ? String(j.glucose) : prev);
        }
      } catch {
        // Spec: fail silently — CGM unavailability must never block manual entry.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pre-Meal-Trend Sample-Cache (Task #195) — wir lesen die rohen CGM
  // History-Samples auf Mount und (lazy) vor jedem Engine-Aufruf neu,
  // damit eine spät angestoßene Empfehlung gegen frische Samples läuft.
  // Die eigentliche Klassifikation passiert in `getPreTrendForRef()`
  // unten gegen die aktuelle Bezugszeit (`mealTime` bzw. now).
  const refreshTrendSamples = async () => {
    try {
      const r = await fetch("/api/cgm/history", { cache: "no-store" });
      if (!r.ok) return [] as TrendSample[];
      const j = (await r.json()) as { history?: Array<{ value: number | null; timestamp: string | null }> };
      if (!Array.isArray(j.history)) return [] as TrendSample[];
      const fresh: TrendSample[] = j.history.map(s => ({ value: s.value, timestamp: s.timestamp }));
      setTrendSamples(fresh);
      return fresh;
    } catch {
      return [] as TrendSample[];
    }
  };
  const trendFetchedRef = useRef(false);
  useEffect(() => {
    if (trendFetchedRef.current) return;
    trendFetchedRef.current = true;
    refreshTrendSamples();
  // refreshTrendSamples is stable enough for a mount-only call; the
  // per-engine-run path re-invokes it explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Trend-Klassifikation für die aktuell aktive Bezugszeit. Slice +
   * Klassifikation läuft synchron gegen die zuletzt gecachten Samples;
   * Aufrufer können vorher `refreshTrendSamples()` awaiten, um sicher
   * frische Daten zu bekommen.
   */
  const getPreTrendForRef = (refMs: number, samples: TrendSample[] = trendSamples): TrendClass | undefined => {
    const r = classifyPreReferenceTrend(samples, refMs);
    return r?.trend;
  };

  // Live pre-meal trend for the *current* meal time, used by the small
  // arrow next to the glucose label (Task #204). Memoised on the cached
  // CGM samples + the active mealTime so it updates immediately when the
  // user shifts the meal time, taps "CGM Pull" (which writes new
  // samples), or new readings stream in. `mealTime` is a local
  // datetime-local string ("YYYY-MM-DDTHH:mm") — `Date.parse` interprets
  // it in the browser's wall-clock TZ, which is the user's intent.
  const currentTrend = useMemo<TrendClass | undefined>(() => {
    if (trendSamples.length === 0) return undefined;
    const refMs = mealTime ? Date.parse(mealTime) || Date.now() : Date.now();
    const r = classifyPreReferenceTrend(trendSamples, refMs);
    return r?.trend;
  }, [trendSamples, mealTime]);

  // Historical glucose auto-fill: when the user changes mealTime to a past
  // time (more than 5 min ago), look up the closest CGM sample in trendSamples
  // and auto-populate the glucose field — so logging a past meal starts with
  // the actual historical BZ value, not whatever the current CGM shows.
  //
  // Rules:
  //  - Only fills when glucose is currently empty (never overwrites user input).
  //  - Past = mealTime is > 5 min before now (avoids jitter on "now" changes).
  //  - Closest sample within ±15 min of the target time wins.
  //  - Falls back silently if no sample is close enough.
  useEffect(() => {
    if (!mealTime) return;
    const mealMs = Date.parse(mealTime);
    if (!Number.isFinite(mealMs)) return;
    const nowMs = Date.now();
    const PAST_THRESHOLD_MS = 5 * 60_000;       // 5 min
    const MAX_SAMPLE_DELTA_MS = 15 * 60_000;    // ±15 min tolerance

    if (nowMs - mealMs < PAST_THRESHOLD_MS) return; // "now" or future — skip

    if (trendSamples.length === 0) return; // no CGM data yet

    // Find the sample closest to mealMs within ±15 min.
    let best: { value: number; delta: number } | null = null;
    for (const s of trendSamples) {
      const ts = new Date(s.timestamp).getTime();
      const delta = Math.abs(ts - mealMs);
      if (delta <= MAX_SAMPLE_DELTA_MS) {
        if (!best || delta < best.delta) best = { value: s.value, delta };
      }
    }
    if (!best) return; // nothing close enough

    // Only auto-fill when glucose field is currently empty — respect manual input.
    setGlucose((prev) => (prev === "" ? String(best!.value) : prev));
  }, [mealTime, trendSamples]);

  // Hydrate the dismissed-suggestion cooldown map from localStorage. Each
  // entry is `{ [patternSignature]: epochMs of dismissal }` and we cull
  // anything older than the 14-day window on read so the dictionary
  // doesn't grow unbounded over the user's lifetime.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("glev_engine_adj_dismissed");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const cutoff = Date.now() - 14 * 24 * 3600_000;
      const fresh: Record<string, number> = {};
      for (const [sig, ts] of Object.entries(parsed)) {
        if (typeof ts === "number" && ts >= cutoff) fresh[sig] = ts;
      }
      setDismissedSigs(fresh);
      // Persist the culled map so the next read is cheap.
      window.localStorage.setItem("glev_engine_adj_dismissed", JSON.stringify(fresh));
    } catch { /* corrupted storage — ignore, banner will just show */ }
  }, []);

  // Compute the current adjustment suggestion from `meals`. The engine
  // helpers are cheap pure functions; recomputing on every render keeps
  // the banner consistent with whatever ICR/CF are now in localStorage
  // (which we just wrote in the apply path). `adjustmentTick` is the
  // explicit invalidator: bumping it after a successful apply forces
  // `getInsulinSettings()` to be re-read against the freshly persisted
  // values. The dependency on `meals.length` covers new logged meals.
  // staticICR = time-window-adjusted ICR from user Settings (sync localStorage
  // read). Recomputed when mealTime or adjustmentTick changes so that an ICR
  // schedule change that the user just applied is reflected immediately.
  const { staticICR, staticICRWindowLabel } = useMemo(() => {
    const ins = getInsulinSettings();
    const base = ins.icr;
    const at = mealTime ? (new Date(mealTime) as Date) : new Date();
    const { icr, slot } = getEffectiveICR(at, base);
    return { staticICR: icr, staticICRWindowLabel: slot?.label || null };
  }, [mealTime, adjustmentTick]);

  // effectiveICR: the value actually fed into runGlevEngine. When the user
  // picks "Einstellungen" it uses the time-window-adjusted static ICR;
  // otherwise it uses the engine-computed adaptive value.
  const effectiveICR = selectedICR === 'static' ? staticICR : adaptedICR;

  // eagerDoses: carb÷ICR + correction calc for both ICR sources via
  // calcEagerDose (lib/engine/eagerDose.ts). Runs synchronously on every
  // carbs/glucose/ICR change so dose chips appear instantly without waiting
  // for the async engine call. cf = 50, target = 110 (same defaults as engine).
  const eagerDoses = useMemo<{ adaptive: number | null; static: number | null }>(() => {
    const cGrams = carbUnit.toGrams(parseFloat(carbs) || 0);
    const gNum = parseFloat(glucose) || 0;
    return {
      adaptive: calcEagerDose(cGrams, gNum, adaptedICR),
      static:   calcEagerDose(cGrams, gNum, staticICR),
    };
  }, [carbs, glucose, adaptedICR, staticICR, carbUnit]);

  // activeDose: the dose committed by the Speichern button.
  // Priority: 1) manual override, 2) engine result (after handleRun),
  // 3) eager ICR estimate (instant, before engine). This ensures the
  // Speichern button and the Bolus-Berechnung sheet always agree.
  // NOTE: result.dose is only used when the engine was run with the
  // *same* ICR source that is currently selected. If the user switches
  // chips after a run (e.g. Adaptiv → Einstellungen), resultICRSource
  // no longer matches selectedICR and we fall back to eagerDoses for
  // the newly-selected source — so the CTA updates immediately.
  const activeDose = useMemo<number | null>(
    () => resolveActiveDose(result, resultICRSource, selectedICR, eagerDoses, manualDose, iob),
    [manualDose, result, resultICRSource, iob, eagerDoses, selectedICR]
  );

  const currentAdjustment = useMemo(() => {
    if (meals.length === 0) return null;
    const ins = getInsulinSettings();
    const settings: AdaptiveSettings = {
      icr: ins.icr,
      correctionFactor: ins.cf,
      lastUpdated: null,
      adjustmentHistory: [],
    };
    const pattern = detectPattern(meals);
    const suggestion = suggestAdjustment(settings, pattern);
    if (!suggestion.hasSuggestion) return null;
    if (pattern.confidence === "low" || pattern.sampleSize < 5) return null;
    return { pattern, suggestion };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meals, adjustmentTick]);

  // Stable per-pattern signature used as the localStorage cooldown key.
  // We intentionally use `pattern.type` only (not the rotating ICR/CF
  // numbers) so dismissing once silences the same recurring pattern for
  // the full 14 days, regardless of the next +/-5% step the engine
  // would have proposed.
  const adjustmentSignature = currentAdjustment?.pattern.type ?? null;
  const adjustmentDismissedUntil = adjustmentSignature
    ? dismissedSigs[adjustmentSignature]
    : undefined;
  const adjustmentVisible = !!currentAdjustment
    && (!adjustmentDismissedUntil
        || Date.now() - adjustmentDismissedUntil > 14 * 24 * 3600_000);

  /**
   * Persist a dismissal in localStorage AND in component state so the
   * banner disappears immediately without waiting for a re-render
   * round-trip through storage.
   */
  function rememberDismissal(sig: string) {
    const next = { ...dismissedSigs, [sig]: Date.now() };
    setDismissedSigs(next);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem("glev_engine_adj_dismissed", JSON.stringify(next)); }
      catch { /* storage disabled — banner state-only fallback is fine for the session */ }
    }
  }

  async function handleApplyAdjustment() {
    if (!currentAdjustment) return;
    setAdjustmentBusy(true);
    setAdjustmentErr(null);
    try {
      await applyAdjustmentToSettings(currentAdjustment.suggestion);
      // No cooldown on apply — once the user accepts, the engine should
      // immediately rotate to the next recommendation against the
      // freshly persisted ICR/CF (handled by `setAdjustmentTick` below).
      // The cooldown is reserved for explicit Verwerfen.
      setDecisionToast(tEngine("adjustment_applied_toast"));
      setTimeout(() => setDecisionToast(null), 2400);
      // Force re-read of localStorage-mirrored ICR/CF so any next
      // suggestion rotates against the fresh values.
      setAdjustmentTick(t => t + 1);
    } catch (e) {
      setAdjustmentErr(e instanceof Error ? e.message : tEngine("adjustment_apply_failed"));
    } finally {
      setAdjustmentBusy(false);
    }
  }

  function handleDismissAdjustment() {
    if (!adjustmentSignature) return;
    rememberDismissal(adjustmentSignature);
  }

  // Track viewport — mobile gets 3 separate tabs (Engine | Bolus | Exercise),
  // desktop keeps the 2-tab layout (Engine | Log) with both forms side-by-side.
  // Breakpoint 768px matches Layout.tsx's sidebar↔mobile threshold, so the
  // page swaps its tab strip at the same width the chrome swaps the nav.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Normalize tab when crossing the mobile↔desktop breakpoint. Now that
  // desktop also shows bolus + exercise as dedicated tab buttons (so the
  // QuickAddMenu deep-links work the same on both viewports), the only
  // tab that needs downgrading is "log" — it's the combined desktop-only
  // meta-view that doesn't exist on mobile. Mobile equivalent of "log"
  // is just "bolus" (Insulin form), since that's the most common entry.
  useEffect(() => {
    setTab(prev => {
      if (isMobile && prev === "log") return "bolus";
      return prev;
    });
  }, [isMobile]);

  // Register the engine page with the global EngineHeaderContext so the
  // mobile app header can render the chevron tab toggle in the top-right
  // bar (next to Live + user icon). The activeLabel mirrors the current
  // tab so the chip always shows what's selected. visible flips to true
  // on mount and back to false on unmount; Layout also defensively
  // resets it on route change to handle edge cases.
  useEffect(() => {
    const labels: Record<typeof tab, string> = {
      engine:      tEngine("tab_engine"),
      log:         "Log",
      bolus:       tEngine("tab_insulin"),
      exercise:    tEngine("tab_exercise"),
      fingerstick: tEngine("tab_glucose"),
      cycle:       tEngine("tab_cycle"),
      symptoms:    tEngine("tab_symptoms"),
      influences:  tEngine("tab_influences"),
    };
    engineHdr.setActiveLabel(labels[tab] ?? tEngine("tab_engine"));
  }, [tab, engineHdr, tEngine]);

  useEffect(() => {
    engineHdr.setVisible(true);
    return () => {
      engineHdr.setVisible(false);
      engineHdr.setTabsExpanded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cockpit lock (Task #315) ────────────────────────────────────────
  // The Engine screen should behave like a fixed analysis instrument,
  // not a scrollable webpage. While this page is mounted we suppress:
  //  - vertical/horizontal scroll on html + body
  //  - iOS rubber-band / Android overscroll glow (overscroll-behavior)
  //  - the Layout `<main>` wrapper's own scroll/padding fallback so the
  //    engine content can claim the full viewport between the fixed
  //    app header and the fixed bottom nav.
  // Pinch-zoom and double-tap-zoom are already handled globally by
  // <PreventZoom /> (mounted in app/layout.tsx), so we don't redo that
  // here. Everything is restored on unmount so other routes are
  // unaffected.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    const main = document.querySelector(".glev-main") as HTMLElement | null;

    const prev = {
      htmlOverflow:    html.style.overflow,
      htmlOverscroll:  html.style.overscrollBehavior,
      bodyOverflow:    body.style.overflow,
      bodyOverscroll:  body.style.overscrollBehavior,
      bodyTouchAction: body.style.touchAction,
      mainOverflow:    main?.style.overflow ?? "",
      mainHeight:      main?.style.height ?? "",
      mainPaddingTop:  main?.style.paddingTop ?? "",
      mainPaddingBot:  main?.style.paddingBottom ?? "",
    };

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    // touch-action: manipulation keeps taps/inner scroll usable while
    // killing the page-level pinch/double-tap zoom paths that ignore
    // the viewport meta on iOS Safari.
    body.style.touchAction = "manipulation";
    if (main) {
      main.style.overflow = "hidden";
      main.style.height   = "100svh";
      // Layout.tsx normally pads the main wrapper top/bottom to
      // reserve room for the fixed app header + bottom nav. While
      // cockpit-locked, we keep that padding so the engine surface
      // sits in the same safe area; we only force overflow:hidden +
      // a hard viewport height so nothing can grow the document or
      // surface a page-level scrollbar.
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      body.style.touchAction = prev.bodyTouchAction;
      if (main) {
        main.style.overflow = prev.mainOverflow;
        main.style.height   = prev.mainHeight;
        main.style.paddingTop    = prev.mainPaddingTop;
        main.style.paddingBottom = prev.mainPaddingBot;
      }
    };
  }, []);

  async function startRecording() {
    // Idempotency guard: never start a second recorder while one is
    // already live or being torn down. Without this, the StrictMode
    // double-invoke of the auto-start effect (or a real double-tap
    // of the Glev FAB before `recording=true` propagates) could race
    // two getUserMedia calls and leave one MediaRecorder orphaned.
    if (recording) return;
    const live = mediaRecRef.current;
    if (live && live.state !== "inactive") return;
    setVoiceErr(""); setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      // New voice take → drop any prior pipeline state so a stale 'unknown'
      // badge or stale per-item breakdown can't bleed into this take.
      setNutritionSource(null);
      setParsedItems([]);
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"]
        .find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const actualType = rec.mimeType || preferred || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: actualType });
        if (blob.size === 0) return;
        // Flip the global "user has spoken at least once" flag so the
        // bottom-nav Glev FAB switches its short-tap action from
        // "open quick-add menu" to "start a new voice take" (see
        // lib/voiceRecordingContext + Layout.tsx MobileGlevFab).
        voiceCtx.markSpoken();
        const tBlob = Date.now();
        const tStop = recordingStopTsRef.current ?? tBlob;
        // eslint-disable-next-line no-console
        console.log("[PERF voice/engine] stop → blob built:", tBlob - tStop, "ms · blob:", Math.round(blob.size / 1024), "KB ·", actualType);
        const ext = actualType.includes("mp4")  ? "m4a"
                 : actualType.includes("mpeg") ? "mp3"
                 : actualType.includes("ogg")  ? "ogg"
                 : "webm";
        await handleVoice(blob, ext);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);
      // Flip the "has spoken at least once" flag as soon as the mic
      // actually starts capturing — not only after a non-empty blob
      // lands (markSpoken below in onstop). Otherwise a user whose
      // first take produced no speech ("Keine Sprache erkannt") would
      // leave hasSpoken=false, and the bottom-nav Glev FAB would
      // fall back to opening the quick-add sheet instead of starting
      // a fresh take on a simple tap (user report 2026-05-17). The
      // markSpoken in onstop is now redundant but harmless and we
      // keep it as a belt-and-braces guarantee.
      voiceCtx.markSpoken();
    } catch (e) {
      setVoiceErr(e instanceof Error ? e.message : tEngine("voice_mic_failed"));
      setRecording(false);
    }
    // Reset the AI-supplied meal label at the START of every new recording
    // so a stale parse-food result can't be reused for a different meal.
    setAiMealType(null);
  }

  function stopRecording() {
    recordingStopTsRef.current = Date.now();
    mediaRecRef.current?.stop();
    setRecording(false);
  }

  async function handleVoice(blob: Blob, ext = "webm") {
    const tHandlerStart = Date.now();
    const tStop = recordingStopTsRef.current ?? tHandlerStart;
    setParsing(true); setVoiceErr("");
    try {
      const fd = new FormData();
      fd.append("audio", blob, `voice.${ext}`);
      const tTrFetch0 = Date.now();
      const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
      const tData = await tRes.json();
      const tTranscribeDone = Date.now();
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] /api/transcribe round-trip:", tTranscribeDone - tTrFetch0, "ms");
      if (!tRes.ok || !tData.text) throw new Error(tData.error || "Empty transcript");
      const text = tData.text as string;
      setTranscript(text);

      const tPfFetch0 = Date.now();
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] transcribe → parse start gap:", tPfFetch0 - tTranscribeDone, "ms");
      const pRes = await fetch("/api/parse-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // locale: ensures the GPT-emitted `description` comes back in the
        // user's UI language (de/en) instead of always English.
        body: JSON.stringify({ text, locale }),
      });
      const pData = await pRes.json();
      const tParseDone = Date.now();
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] /api/parse-food round-trip:", tParseDone - tPfFetch0, "ms");
      const t = pData.totals || {};
      // SAFETY: when the aggregator marks the meal as 'unknown' (at
      // least one ingredient where both DB lookups AND the GPT estimate
      // failed) we DO NOT auto-fill the macro fields — the totals are
      // unreliable and dosing insulin from them would be unsafe. The
      // form keeps its current values; the chat seed below tells the
      // user to enter macros manually.
      const safeToAutofill = pData.nutritionSource !== "unknown";
      if (safeToAutofill) {
        // /api/parse-food returns macros in GRAMS; the carbs input field
        // displays the user's chosen unit (g/BE/KE), so convert before
        // writing it into form state. Other macros stay in grams.
        if (t.carbs   != null) setCarbs(String(carbUnit.fromGrams(Number(t.carbs))));
        if (t.fiber   != null) setFiber(String(t.fiber));
        if (t.protein != null) setProtein(String(t.protein));
        if (t.fat     != null) setFat(String(t.fat));
      }
      // Capture the per-item breakdown so the saved meal preserves
      // provenance in meals.parsed_json. Falls back to [] when the
      // response shape is malformed (older clients shouldn't break).
      const validItems = Array.isArray(pData.items)
        ? pData.items.filter((it: unknown) => it && typeof it === "object")
        : [];
      setParsedItems(validItems);
      // Phase B: batch-fetch per-user portion suggestions for all
      // parsed items. Fire-and-forget — failures are silent so they
      // cannot interfere with the primary parse flow.
      if (validItems.length > 0) {
        const names = (validItems as Array<{ name: string }>).map((it) => it.name).join(",");
        void fetch(`/api/food-history/suggest?names=${encodeURIComponent(names)}`)
          .then((r) => r.ok ? r.json() : { suggestions: {} })
          .then((d: { suggestions?: Record<string, { suggestedGrams: number; displayName: string }> }) => {
            const m = new Map<string, { suggestedGrams: number; displayName: string }>();
            for (const [k, v] of Object.entries(d.suggestions ?? {})) m.set(k, v);
            setPortionSuggestions(m);
            setDismissedSuggestions(new Set());
          })
          .catch(() => {});
      } else {
        setPortionSuggestions(new Map());
        setDismissedSuggestions(new Set());
      }
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] parse response → form fields filled:", Date.now() - tParseDone, "ms");
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] TOTAL (stop → form filled):", Date.now() - tStop, "ms");
      if (typeof pData.description === "string" && pData.description.trim()) {
        setDesc(pData.description.trim());
      }
      // Capture the AI classification so handleConfirmLog can prefer it
      // over the deterministic classifyMeal fallback. Validate against the
      // four canonical labels so a malformed response can't slip through.
      const aiCls = pData.mealType;
      if (typeof aiCls === "string" && ["FAST_CARBS", "HIGH_FAT", "HIGH_PROTEIN", "BALANCED"].includes(aiCls)) {
        setAiMealType(aiCls);
      } else {
        setAiMealType(null);
      }
      // Capture the macro provenance from the two-stage nutrition pipeline
      // (Open Food Facts + USDA + GPT-fallback). Surfaced as a Step 2 badge.
      const ns = pData.nutritionSource;
      setNutritionSource(
        ns === "database" || ns === "mixed" || ns === "estimated" || ns === "unknown" ? ns : null,
      );
      // Seed the chat panel — Lucas 2026-05-12: drop the chatty "Got it"
      // opener and the "Tell me if anything's off" follow-up. The user
      // wants the macros front-and-centre on first reply, not a
      // conversation starter that asks for confirmation. We now show
      // ONLY the macros line (when the parser found numbers) plus the
      // captured description as a single short line so the user can
      // sanity-check what was heard. If the parser failed to extract
      // macros (unknown source / empty totals) we keep a compact "konnte
      // nicht erkennen — bitte ergänzen" hint so the user isn't left
      // staring at an empty card.
      const chatLines: string[] = [];
      const macroBits: string[] = [];
      if (t.carbs   != null) macroBits.push(`${t.carbs}${tEngine("carbs_short")}`);
      if (t.protein != null) macroBits.push(`${t.protein}${tEngine("protein_short")}`);
      if (t.fat     != null) macroBits.push(`${t.fat}${tEngine("fat_short")}`);
      if (t.fiber   != null) macroBits.push(`${t.fiber}${tEngine("fiber_short")}`);
      if (macroBits.length) {
        chatLines.push(macroBits.join(" · "));
      } else {
        chatLines.push(tEngine("voice_chat_no_macros"));
      }
      const descLine = typeof pData.description === "string" && pData.description.trim()
        ? pData.description.trim()
        : text;
      chatLines.push(descLine);
      setChatSeed({ id: Date.now(), content: chatLines.join("\n\n") });
      logDebug("ENGINE.VOICE", { text, totals: t });
      // Voice submission implies the user is logging a meal *now* — pull
      // the latest CGM reading in parallel so the glucose-before field is
      // populated automatically. Fire-and-forget: failures are logged via
      // handlePullCgm itself and don't surface here.
      void handlePullCgm();
      // Sequential UX flow: macros are now filled → expand the AI FOOD
      // PARSER panel and scroll it into view so the user sees GPT's
      // reasoning right after their words become numbers. 300ms delay
      // lets the macro fields finish their re-render first so the user
      // perceives "fields fill → panel opens" instead of both at once.
      setHasUsedVoice(true);
      setTimeout(() => {
        setChatExpanded(true);
        // block: "center" keeps both the freshly-filled fields and the
        // newly-opened reasoning panel visible without jumping the
        // viewport too aggressively.
        chatPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
      // No auto-advance (Lucas 2026-05-12, second pass): the form
      // fields are autopopulated immediately on parse, but the user
      // explicitly wants to keep the manual "Weiter zu Makros prüfen →"
      // tap so they can review the chat seed (macros line + parsed
      // description) on Step 1 before committing. Earlier auto-advance
      // attempt was reverted same session — do NOT re-introduce.
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] FAILED after:", Date.now() - tStop, "ms");
      // FIX B (locale-aware 2026-05-18): Map cryptic native messages to
      // actionable hints in the user's UI language. We previously hard-coded
      // German strings here which surfaced as "Keine Sprache erkannt …" even
      // when the rest of the UI was English. Anything we don't recognise
      // still shows the raw message rather than a useless generic fallback.
      const raw = e instanceof Error ? e.message : "";
      const friendly =
        /empty transcript/i.test(raw)              ? tEngine("voice_err_no_speech") :
        /permission denied|not allowed/i.test(raw) ? tEngine("voice_err_mic_denied") :
        /failed to fetch|networkerror/i.test(raw)  ? tEngine("voice_err_network") :
        raw                                         ? raw :
                                                      tEngine("voice_err_processing_failed");
      setVoiceErr(friendly);
    } finally {
      setParsing(false);
      recordingStopTsRef.current = null;
    }
  }

  // Pull the latest glucose reading for the engine's glucose-before field.
  //
  // Source priority:
  //   1. Manual fingerstick measured within FS_OVERRIDE_WINDOW_MS — capillary
  //      blood is the gold standard, so a fresh fingerstick outranks CGM.
  //   2. Latest CGM reading via /api/cgm/latest (LibreLinkUp).
  //
  // Triggered both by the "CGM" button and automatically after a successful
  // voice meal-submission (see handleVoice below) so the glucose-before
  // field always reflects the user's level at meal time.
  async function handlePullCgm() {
    if (cgmPulling) return;
    setCgmPulling(true);
    try {
      // Step 1 — try a recent fingerstick. Non-fatal on failure: fall through
      // to CGM rather than blocking the calculation.
      const fs = await fetchLatestFingerstick().catch(() => null);
      if (fs) {
        const measuredMs = new Date(fs.measured_at).getTime();
        if (Number.isFinite(measuredMs) && (Date.now() - measuredMs) <= FS_OVERRIDE_WINDOW_MS) {
          const reading = Math.round(Number(fs.value_mg_dl));
          setGlucose(String(reading));
          const d = new Date(measuredMs);
          setLastReading(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")} · FS`);
          logDebug("ENGINE.FS_USED", { reading, measured_at: fs.measured_at });
          return;
        }
      }

      // Step 2 — fall back to CGM.
      const r = await fetchLatestCgm();
      if (r.ok) {
        const reading = Math.round(r.value);
        setGlucose(String(reading));
        const tsMs = r.timestamp ? parseLluTs(r.timestamp) : null;
        const d = new Date(tsMs ?? Date.now());
        setLastReading(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`);
        logDebug("ENGINE.CGM_PULL", { reading, timestamp: r.timestamp });
      } else {
        logDebug("ENGINE.CGM_PULL_FAIL", { status: r.status, message: r.message });
      }
    } finally {
      setCgmPulling(false);
    }
  }

  // IOB: fetch recent meals (last 5h) and calculate active insulin.
  useEffect(() => {
    fetchMeals({ sinceDays: 1, limit: Infinity }).then(recent => {
      const cutoff = Date.now() - 5 * 60 * 60 * 1000;
      const recentDoses = recent
        .filter(m => m.insulin_units != null && m.insulin_units > 0 && new Date(m.created_at).getTime() > cutoff)
        .map(m => ({ units: m.insulin_units as number, administeredAt: m.created_at }));
      const userDiaMinutes = getInsulinSettings().diaMinutes;
      const totalIOB = calcTotalIOB(recentDoses, insulinType, Date.now(), userDiaMinutes);
      setIob(totalIOB);
      setIobDisplay(formatIOBDisplay(totalIOB));
    }).catch(() => { setIob(0); setIobDisplay(null); });
  }, [insulinType]);

  useEffect(() => {
    // Fetch meals AND the recent bolus logs in parallel so the adaptive
    // ICR computation can pair user-logged boluses to meals (see
    // lib/engine/pairing.ts). Users who log boluses separately from
    // meals (or split a single meal across multiple shots) get their
    // real dosing folded into the ICR average — without pairing they
    // were invisible to the engine. Falls back to meal.insulin_units
    // when fetching boluses fails so the engine still runs.
    Promise.all([
      fetchMealsForEngine(),
      fetchRecentInsulinLogs(90).catch(() => [] as InsulinLog[]),
    ])
      .then(([fetched, bolusesForPairing]) => {
        setMeals(fetched);
        // Adaptive ICR — single source of truth shared with the Insights
        // page (lib/engine/adaptiveICR.ts). Outcome-weighted average of
        // carbs/insulin across all FINALIZED meals (state==="final"):
        // GOOD weight 1.0, SPIKE 0.7, UNDER/OVERDOSE 0.3.
        // Read-only: never written to DB.
        //
        // Why this matters: the previous inline formula
        // `clamp(8, 25, 15 + netBias*4)` had two bugs that caused the
        // Engine recommendation to disagree with Insights:
        //   1. Sign was inverted — LOW outcomes mean the prior dose was
        //      TOO BIG, so ICR should go UP (less insulin per gram of
        //      carbs), not down. The old formula pushed ICR DOWN on LOW.
        //   2. Hard cap at 25 made it impossible to converge on the
        //      empirical 1:37.5 some users actually need.
        const adaptive = computeAdaptiveICR(fetched, bolusesForPairing);
        // Persist the engine-computed ICR back to user_settings — same
        // fire-and-forget pattern as Insights (lib/userSettings.ts
        // `persistEngineIcr`). Without this call, users who only use
        // the Engine tab (without ever opening Insights) never get an
        // engine ICR persisted, so the Two-Value system stays inert
        // for them. The helper is idempotent (no-op when nothing
        // changed), guards `engine_icr_auto_apply=FALSE` so it never
        // touches the user column on its own, and appends an audit
        // entry to `adjustment_history` when the user opted into
        // auto-apply AND sample size ≥10.
        persistEngineIcr(adaptive.global, adaptive.sampleSize).catch(() => {});
        if (adaptive.global !== null && adaptive.sampleSize >= 3) {
          // Round to 1 decimal — matches Insights display precision and
          // keeps `runGlevEngine`'s `carbs / icr` math stable.
          const newICR = Math.round(adaptive.global * 10) / 10;
          setAdaptedICR(newICR);
          setIcrConfidence(adaptive.sampleSize >= 10 ? "high" : adaptive.sampleSize >= 5 ? "medium" : "low");
          setIcrSampleSize(adaptive.sampleSize);
          setIcrPairedCount(adaptive.pairedCount);
          setIcrPairedExplicitCount(adaptive.pairedExplicitCount);
          setIcrPairedTimeWindowCount(adaptive.pairedTimeWindowCount);
          logDebug("ENGINE.ADAPTIVE_ICR", { newICR, sampleSize: adaptive.sampleSize, source: "computeAdaptiveICR.global" });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    // Recent insulin & exercise logs feed the safety-context notes in the
    // Engine recommendation. Failure here is non-fatal — the engine still
    // runs without log context.
    fetchRecentInsulinLogs(7).then(setInsulinLogs).catch(() => setInsulinLogs([]));
    fetchRecentExerciseLogs(7).then(setExerciseLogs).catch(() => setExerciseLogs([]));
    // Task #183: load Apple-Health daily-step context if the user has
    // synced any from the iOS shell. Best-effort — silently noop when
    // the table is empty or the endpoint errors so the Engine still
    // runs on web / Android.
    fetchRecentActivityClient(8)
      .then(res => setActivityCtx(res.context ?? summariseActivityContext(res.rows ?? [])))
      .catch(() => setActivityCtx(null));
  }, []);

  function handleRun(silent = false) {
    // carbs input lives in the user's chosen unit (g/BE/KE); engine
    // operates in grams, so convert at the boundary.
    const g = parseFloat(glucose)||110, c = carbUnit.toGrams(parseFloat(carbs)||0);
    // NOTE: previously bailed silently with `if (!c) return;` — that
    // contradicted the button comment ("Always clickable; never
    // carbs-gated") and caused the user-reported bug where the button
    // looked alive but did nothing when carbs were 0 or empty. The
    // engine handles c=0 correctly (correction-only bolus when BG is
    // high, or "0 IE — keine KH und BG im Zielbereich" otherwise), so
    // we let it run unconditionally and surface the real result.
    setRunning(true);
    // Pre-Meal-Trend (Task #195): Frische Samples ziehen und gegen die
    // jeweils aktive `mealTime` klassifizieren — sonst würde ein älterer,
    // beim Mount berechneter Trend stehen bleiben, auch wenn der User
    // die Mahlzeitzeit verschoben oder lange auf der Seite gewartet hat.
    const refMs = mealTime ? Date.parse(mealTime) || Date.now() : Date.now();
    refreshTrendSamples().then(samples => {
      const trend = getPreTrendForRef(refMs, samples);
      setTimeout(() => {
        const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, effectiveICR, tEngineFn, formatNum, trend, new Date(refMs), activityCtx);
        setResult(rec);
        setResultICRSource(selectedICR);
        setRunning(false);
      // Open the BolusExplainerSheet (replaces the old Step 3 page
      // navigation). Sheet shows dose, confidence, IOB, GPT reasoning,
      // and ICR methodology without leaving the macros card.
      if (!silent) setBolusExplainerOpen(true);
      // PRE-FILL ENTFERNT: Insulin wird jetzt erst NACH Confirm Log + binärer
      // Bolus-Entscheidung im Post-Confirm-Flow eingegeben. Kein silent-set
      // mehr in den `insulin`-State, sonst würde beim Save eine Dosis
      // gespeichert, die der User nie bestätigt hat. Die Empfehlung
      // (`rec.dose`) bleibt im `result`-State und wird im Decision-Panel
      // angezeigt, sobald der Bolus-Pfad gewählt ist.
      logDebug("ENGINE", { input: { glucose: g, carbs: c }, matchedMeals: rec.similarMeals.map(m => ({ id: m.id, carbs: m.carbs_grams, glucose: m.glucose_before, insulin: m.insulin_units })), suggestedDose: rec.dose, confidence: rec.confidence, recentInsulin: insulinLogs.length, recentExercise: exerciseLogs.length, preTrend: trend ?? null });
      }, 600);
    });
  }

  // Auto-run the engine as soon as the bolus toggle is switched on so
  // the chip, Speichern button, and explainer sheet all show the same
  // value from the start — no stale eager-estimate shown first.
  useEffect(() => {
    if (bolusEnabled) handleRun(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolusEnabled]);

  // Wizard Step 3 commit: saves the meal AND the recommended dose in one
  // shot. Mirrors handleConfirmLog's validation/save logic but writes
  // insulin_units = result.dose so the user doesn't need a second
  // confirmation step in the new linear flow. Resets to Step 1 on success
  // so the next meal can be entered. Keeps glucose populated (CGM tap
  // saver) but clears macros / desc / result.
  async function handleWizardSave() {
    if (!result) return;
    setConfirmErr("");
    // The carbs input is in the user's chosen unit (g/BE/KE). Validate
    // on the displayed value (so "0" still passes) then convert to grams
    // for everything downstream — DB storage and engine math are grams.
    const cDisplay = parseFloat(carbs);
    if (!Number.isFinite(cDisplay) || cDisplay < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
    const cNum = carbUnit.toGrams(cDisplay);
    const pNum  = parseFloat(protein) || 0;
    const fNum  = parseFloat(fat)     || 0;
    const fbNum = parseFloat(fiber)   || 0;
    const gParsed = glucose.trim() === "" ? NaN : parseFloat(glucose);
    const gNum = Number.isFinite(gParsed) ? gParsed : null;
    // Same classification + calorie pipeline as handleConfirmLog so the
    // saved row is identical except for the insulin_units field.
    // Immer deterministisch klassifizieren — die GPT-Antwort
    // (aiMealType) wird NICHT mehr blind bevorzugt, weil sie aus dem
    // initialen Voice-Parse stammt und nach User-Korrektur der Macros
    // veraltet wäre (Bug-Fall 2026-05-04: 24g-Whey-Shake, GPT sagte
    // HIGH_FAT, klassifyMeal sagt korrekt HIGH_PROTEIN).
    const cls = classifyMeal(cNum, pNum, fNum, fbNum);
    const cal   = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
    // Capture the live CGM trend arrow at meal-save time (Task #265).
    // Helper swallows all errors and times out fast — the save path is
    // never blocked by a slow or unavailable CGM.
    const preMealTrend = await getCurrentTrendArrow();
    try {
      const saved = await saveMeal({
        inputText: desc.trim() || transcript.trim() || "(manual entry)",
        // PERSIST PROVENANCE: when the two-stage pipeline produced a
        // per-item breakdown (voice/chat parse), save its full shape so
        // meals.parsed_json (jsonb) carries every ingredient's `source`
        // tag. Manual-entry fallback synthesizes a single legacy item;
        // there's nothing to attribute, so source stays undefined.
        parsedJson: parsedItems.length > 0
          ? parsedItems
          : [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
        glucoseBefore: gNum,
        glucoseAfter: null,
        carbsGrams: cNum,
        proteinGrams: pNum,
        fatGrams: fNum,
        fiberGrams: fbNum,
        calories: cal,
        // KEY DIFFERENCE vs handleConfirmLog: the engine's recommended dose
        // is committed alongside the meal in the same write. The wizard's
        // "✓ Bestätigen & Speichern" button represents the user's explicit
        // accept of that dose — no separate decision panel afterwards.
        insulinUnits: result.dose,
        mealType: cls,
        // Evaluation stays null on insert — lifecycleFor (lib/engine/lifecycle.ts)
        // writes it once the row reaches "final" via updateMealReadings.
        evaluation: null,
        createdAt: mealIso,
        mealTime: mealIso,
        preMealTrend,
        // saveMeal mirrors the bolus into insulin_logs automatically;
        // passing the brand name here avoids a second insertInsulinLog call.
        insulinName: getInsulinSettings().insulinBrandBolus?.trim() || null,
      });
      // Schedule CGM auto-fetches at +1h / +2h after meal time. Fire-and-forget;
      // failures (e.g. no CGM connected) are silent.
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      // Refresh meals so the next recommendation immediately benefits.
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.WIZARD_SAVE", { id: saved.id, carbs: cNum, insulin: result.dose, glucose: gNum, mealType: cls });
      hapticSuccess();
      // FIX A: Hold on Step 3 with a green confirmation. No auto-reset, no
      // auto-navigate — the user explicitly clicks "Neues Essen" below to
      // clear the form and return to Step 1. This avoids the surprise of
      // the screen jumping away the moment they hit Save.
      setWizardSavedDose(result.dose);
    } catch (e) {
      hapticError();
      setConfirmErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfirming(false);
    }
  }

  // FIX A v2: Direct-save path from Step 2. Same persistence pipeline as
  // handleWizardSave (classification, calorie calc, saveMeal, schedule
  // CGM follow-up jobs) but commits insulin_units = 0 — the user is just
  // documenting macros without a bolus calculation. No `result` required
  // since the engine never ran. Lands in the same green-confirmation
  // post-save state via setWizardSavedDose(0). The user is never forced
  // through the bolus recommendation just to log a meal.
  async function handleSaveWithoutBolus() {
    setConfirmErr("");
    // Validate displayed value (g/BE/KE), then convert to grams.
    const cDisplay = parseFloat(carbs);
    if (!Number.isFinite(cDisplay) || cDisplay < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
    const cNum = carbUnit.toGrams(cDisplay);
    const pNum  = parseFloat(protein) || 0;
    const fNum  = parseFloat(fat)     || 0;
    const fbNum = parseFloat(fiber)   || 0;
    const gParsed = glucose.trim() === "" ? NaN : parseFloat(glucose);
    const gNum = Number.isFinite(gParsed) ? gParsed : null;
    // Immer deterministisch klassifizieren — die GPT-Antwort
    // (aiMealType) wird NICHT mehr blind bevorzugt, weil sie aus dem
    // initialen Voice-Parse stammt und nach User-Korrektur der Macros
    // veraltet wäre (Bug-Fall 2026-05-04: 24g-Whey-Shake, GPT sagte
    // HIGH_FAT, klassifyMeal sagt korrekt HIGH_PROTEIN).
    const cls = classifyMeal(cNum, pNum, fNum, fbNum);
    const cal   = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
    // Capture live CGM trend arrow snapshot (Task #265).
    const preMealTrendNoBolus = await getCurrentTrendArrow();
    try {
      const saved = await saveMeal({
        inputText: desc.trim() || transcript.trim() || "(manual entry)",
        // PERSIST PROVENANCE: when the two-stage pipeline produced a
        // per-item breakdown (voice/chat parse), save its full shape so
        // meals.parsed_json (jsonb) carries every ingredient's `source`
        // tag. Manual-entry fallback synthesizes a single legacy item;
        // there's nothing to attribute, so source stays undefined.
        parsedJson: parsedItems.length > 0
          ? parsedItems
          : [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
        glucoseBefore: gNum,
        glucoseAfter: null,
        carbsGrams: cNum,
        proteinGrams: pNum,
        fatGrams: fNum,
        fiberGrams: fbNum,
        calories: cal,
        // KEY: zero bolus — user explicitly chose the "no-bolus" path.
        insulinUnits: 0,
        mealType: cls,
        evaluation: null,
        createdAt: mealIso,
        mealTime: mealIso,
        preMealTrend: preMealTrendNoBolus,
      });
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.SAVE_NO_BOLUS", { id: saved.id, carbs: cNum, glucose: gNum, mealType: cls });
      hapticSuccess();
      // Same post-save state as handleWizardSave so both paths converge
      // on the identical "✓ Gespeichert — N IE geloggt" confirmation.
      setWizardSavedDose(0);
    } catch (e) {
      hapticError();
      setConfirmErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfirming(false);
    }
  }

  // Step 2 tertiary path: commit the meal with a user-typed bolus dose
  // (no engine run). Same persistence pipeline as handleSaveWithoutBolus
  // (classification, calorie calc, saveMeal, schedule CGM follow-ups);
  // only the insulin_units value differs. Lands in the same green
  // confirmation via setWizardSavedDose so the three save paths
  // (no-bolus / engine-recommended / direct-entry) all converge on
  // the identical "✓ Gespeichert — N IE geloggt" success state.
  async function handleSaveWithDirectBolus() {
    setConfirmErr("");
    // Validate displayed value (g/BE/KE), then convert to grams.
    const cDisplay = parseFloat(carbs);
    if (!Number.isFinite(cDisplay) || cDisplay < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
    const cNum = carbUnit.toGrams(cDisplay);
    const iNum = parseFloat(directBolusValue);
    if (!Number.isFinite(iNum) || iNum < 0) {
      setConfirmErr("Bitte gültige IE eintragen (≥ 0).");
      return;
    }
    const pNum  = parseFloat(protein) || 0;
    const fNum  = parseFloat(fat)     || 0;
    const fbNum = parseFloat(fiber)   || 0;
    const gParsed = glucose.trim() === "" ? NaN : parseFloat(glucose);
    const gNum = Number.isFinite(gParsed) ? gParsed : null;
    // Immer deterministisch klassifizieren (siehe Kommentar weiter oben).
    const cls = classifyMeal(cNum, pNum, fNum, fbNum);
    const cal = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
    // Capture live CGM trend arrow snapshot (Task #265).
    const preMealTrendDirect = await getCurrentTrendArrow();
    try {
      const saved = await saveMeal({
        inputText: desc.trim() || transcript.trim() || "(manual entry)",
        // PERSIST PROVENANCE: when the two-stage pipeline produced a
        // per-item breakdown (voice/chat parse), save its full shape so
        // meals.parsed_json (jsonb) carries every ingredient's `source`
        // tag. Manual-entry fallback synthesizes a single legacy item;
        // there's nothing to attribute, so source stays undefined.
        parsedJson: parsedItems.length > 0
          ? parsedItems
          : [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
        glucoseBefore: gNum,
        glucoseAfter: null,
        carbsGrams: cNum,
        proteinGrams: pNum,
        fatGrams: fNum,
        fiberGrams: fbNum,
        calories: cal,
        insulinUnits: iNum,
        mealType: cls,
        evaluation: null,
        createdAt: mealIso,
        mealTime: mealIso,
        preMealTrend: preMealTrendDirect,
        insulinName: getInsulinSettings().insulinBrandBolus?.trim() || null,
      });
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.SAVE_DIRECT_BOLUS", { id: saved.id, carbs: cNum, glucose: gNum, mealType: cls, insulinUnits: iNum });
      hapticSuccess();
      setWizardSavedDose(iNum);
    } catch (e) {
      hapticError();
      setConfirmErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfirming(false);
    }
  }

  // Centralized post-save reset — used by both Step 2 (no-bolus) and
  // Step 3 (bolus) "Neues Essen" buttons so the two save paths share
  // identical reset semantics. keepGlucose: true preserves the latest
  // CGM reading so the next meal doesn't need a re-pull.
  function handleNewMeal() {
    resetForm({ keepGlucose: true });
    setStepIndex(0);
    setReasoningExpanded(false);
    setWizardSavedDose(null);
    setConfirmErr("");
    setDirectBolusOpen(false);
    setDirectBolusValue("");
    setManualDose("");
    setBolusExplainerOpen(false);
  }

  // Eager-bolus save path: commits the meal with the inline-computed
  // dose (carbs ÷ ICR + correction, IOB-adjusted by the caller).
  // No engine run required — the dose was derived synchronously from
  // eagerDoses[selectedICR] + applyIOBCorrection in the action row.
  // Mirrors handleSaveWithoutBolus (same pipeline) but sets
  // insulin_units = dose instead of 0.
  async function handleSaveWithEagerBolus(dose: number) {
    setConfirmErr("");
    const cDisplay = parseFloat(carbs);
    if (!Number.isFinite(cDisplay) || cDisplay < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
    const cNum = carbUnit.toGrams(cDisplay);
    const pNum  = parseFloat(protein) || 0;
    const fNum  = parseFloat(fat)     || 0;
    const fbNum = parseFloat(fiber)   || 0;
    const gParsed = glucose.trim() === "" ? NaN : parseFloat(glucose);
    const gNum = Number.isFinite(gParsed) ? gParsed : null;
    const cls = classifyMeal(cNum, pNum, fNum, fbNum);
    const cal = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
    const preMealTrendEager = await getCurrentTrendArrow();
    try {
      const saved = await saveMeal({
        inputText: desc.trim() || transcript.trim() || "(manual entry)",
        parsedJson: parsedItems.length > 0
          ? parsedItems
          : [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
        glucoseBefore: gNum,
        glucoseAfter: null,
        carbsGrams: cNum,
        proteinGrams: pNum,
        fatGrams: fNum,
        fiberGrams: fbNum,
        calories: cal,
        insulinUnits: dose,
        mealType: cls,
        evaluation: null,
        createdAt: mealIso,
        mealTime: mealIso,
        preMealTrend: preMealTrendEager,
        insulinName: getInsulinSettings().insulinBrandBolus?.trim() || null,
      });
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.SAVE_EAGER_BOLUS", { id: saved.id, carbs: cNum, glucose: gNum, mealType: cls, insulinUnits: dose });
      hapticSuccess();
      setWizardSavedDose(dose);
    } catch (e) {
      hapticError();
      setConfirmErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfirming(false);
    }
  }

  // Confirm Log writes the full meal+bolus row to the `meals` table via
  // saveMeal — this is what the engine recommender reads back from. The
  // standalone Log tab (Bolus / Exercise) is unaffected; that one is for
  // quick manual entries that have no associated meal.
  async function handleConfirmLog() {
    setConfirmErr("");
    // Validate displayed value (g/BE/KE), then convert to grams (see
    // the conversion comment 3 handlers above for the full rationale).
    const cDisplay = parseFloat(carbs);
    // Insulin wird im Pre-Confirm-Flow NICHT mehr abgefragt. Falls aus
    // irgendeinem Grund (z.B. alter HMR-State) doch ein Wert im `insulin`
    // State steht, wird er ignoriert — `iNum` ist konsistent null bis der
    // User im Post-Confirm-Decision-Panel auf den Bolus-Pfad geht.
    const iNum: number | null = null;
    const gParsed = glucose.trim() === "" ? NaN : parseFloat(glucose);
    const gNum = Number.isFinite(gParsed) ? gParsed : null;
    // 0g ist eine legitime Eingabe (z.B. reine Protein-/Fett-Mahlzeiten wie
    // Steak, Eier, Käse — können trotzdem über FPU Insulin brauchen). Nur
    // leere Eingabe oder negative Werte ablehnen.
    if (!Number.isFinite(cDisplay) || cDisplay < 0) { setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt)."); return; }
    const cNum = carbUnit.toGrams(cDisplay);
    const pNum  = parseFloat(protein) || 0;
    const fNum  = parseFloat(fat)     || 0;
    const fbNum = parseFloat(fiber)   || 0;
    // AI classification wins when /api/parse-food provided one — both
    // sources share the same FAST_CARBS / HIGH_FAT / HIGH_PROTEIN /
    // BALANCED rules, but the AI sees richer context (sugar fraction,
    // ingredient identity) and resolves edge cases the macro-only
    // fallback can't. Falls back to classifyMeal() for typed entries.
    // Immer deterministisch klassifizieren — die GPT-Antwort
    // (aiMealType) wird NICHT mehr blind bevorzugt, weil sie aus dem
    // initialen Voice-Parse stammt und nach User-Korrektur der Macros
    // veraltet wäre (Bug-Fall 2026-05-04: 24g-Whey-Shake, GPT sagte
    // HIGH_FAT, klassifyMeal sagt korrekt HIGH_PROTEIN).
    const cls = classifyMeal(cNum, pNum, fNum, fbNum);
    const cal   = computeCalories(cNum, pNum, fNum);
    // Evaluation is no longer pre-computed at save time — lifecycleFor
    // (lib/engine/lifecycle.ts) decides when a row reaches "final" and
    // only THEN writes the evaluation column via updateMealReadings or
    // updateMeal. Inserts always start with evaluation = null.
    const evalStr = null;
    // datetime-local has no timezone — interpret it as the user's local wall
    // clock and convert to a real ISO instant for storage.
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
    // Capture live CGM trend arrow snapshot (Task #265).
    const preMealTrendConfirm = await getCurrentTrendArrow();
    try {
      const saved = await saveMeal({
        inputText: desc.trim() || transcript.trim() || "(manual entry)",
        // PERSIST PROVENANCE: when the two-stage pipeline produced a
        // per-item breakdown (voice/chat parse), save its full shape so
        // meals.parsed_json (jsonb) carries every ingredient's `source`
        // tag. Manual-entry fallback synthesizes a single legacy item;
        // there's nothing to attribute, so source stays undefined.
        parsedJson: parsedItems.length > 0
          ? parsedItems
          : [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
        glucoseBefore: gNum,
        glucoseAfter: null,
        carbsGrams: cNum,
        proteinGrams: pNum,
        fatGrams: fNum,
        fiberGrams: fbNum,
        calories: cal,
        insulinUnits: iNum,
        mealType: cls,
        evaluation: evalStr,
        createdAt: mealIso,
        mealTime: mealIso,
        preMealTrend: preMealTrendConfirm,
      });
      // Park the saved row + open the decision panel. Form fields stay
      // populated so the panel has visible context — they only reset once
      // the user finishes the post-confirm flow (Bolus / Empfehlung / Cancel).
      setConfirmedMeal(saved);
      setDecisionMode("decision");
      setDecisionRec(null);
      // FIX A: Visible save feedback. The decision panel that pops up below
      // is contextual UI, not a save confirmation, so without this toast
      // users had no signal that the row actually persisted.
      setDecisionToast(tEngine("toast_meal_saved"));
      setTimeout(() => setDecisionToast(null), 2500);
      logDebug("ENGINE.CONFIRM_LOG", { id: saved.id, carbs: cNum, insulin: iNum, glucose: gNum, mealType: cls });
      hapticSuccess();
      // Schedule CGM auto-fetches at +1h / +2h after meal time. Fire-and-forget;
      // failures (e.g. no CGM connected) are silent.
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      // Refresh meals so the next recommendation immediately benefits.
      fetchMealsForEngine().then(setMeals).catch(() => {});
    } catch (e) {
      hapticError();
      setConfirmErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfirming(false);
    }
  }

  // Reset form + clear all post-confirm state. Used by:
  //  - the form-mode "Cancel" button
  //  - all 3 decision buttons after their work is done
  function resetForm(opts: { keepGlucose?: boolean } = {}) {
    if (!opts.keepGlucose) setGlucose("");
    setCarbs(""); setProtein(""); setFat(""); setFiber("");
    setDesc(""); setInsulin(""); setResult(null); setResultICRSource(null); setTranscript("");
    setAiMealType(null);
    setNutritionSource(null);
    setParsedItems([]);
    setPortionSuggestions(new Map());
    setDismissedSuggestions(new Set());
    setMealTime(nowLocalDateTime());
    setConfirmErr("");
    setConfirmedMeal(null);
    setDecisionMode("decision");
    setDecisionRec(null);
    // Clear busy flag so the next decision panel (after the next Confirm Log)
    // starts with enabled buttons. Toast is intentionally NOT cleared — its
    // own setTimeout dismisses it independently.
    setDecisionBusy(false);
    setBolusEnabled(false);
    setManualDose("");
  }

  function handleCancel() {
    resetForm();
  }

  // ─── Post-confirm decision handlers ──────────────────────────────────────
  // These run only when `confirmedMeal` is set. They fire the user's chosen
  // follow-up (link a bolus, get a recommendation, or delete the log) and
  // then close the decision panel by clearing confirmedMeal.

  function handleDecisionBolus() {
    if (!confirmedMeal) return;
    // Bolus-Pfad: in-place insulin sub-mode öffnen, Feld leer. Kein Routing
    // mehr nach /log — der User dokumentiert die tatsächlich gesetzte Dosis
    // direkt hier an der schon gespeicherten Mahlzeit (PATCH via
    // handleConfirmDecisionInsulin).
    setInsulin("");
    setDecisionInsulinErr(null);
    setDecisionMode("insulin");
  }

  function handleDecisionEmpfehlung() {
    if (!confirmedMeal) return;
    // Run the same engine the Empfehlung-berechnen button uses, but locked
    // to the saved meal's carbs / glucose so the rec is for THIS log.
    const g = confirmedMeal.glucose_before ?? parseFloat(glucose) ?? 110;
    // confirmedMeal.carbs_grams already in grams; the form fallback is
    // in the user's display unit so convert before feeding the engine.
    const c = confirmedMeal.carbs_grams ?? carbUnit.toGrams(parseFloat(carbs) || 0);
    if (!c) { setDecisionToast("Keine Carbs hinterlegt — Einschätzung nicht möglich."); return; }
    setDecisionBusy(true);
    // Pre-Meal-Trend (Task #195): Bezugszeit ist hier der gespeicherte
    // `meal_time` der bestätigten Mahlzeit, nicht "jetzt" — der User
    // klickt "Empfehlung holen" oft minutenlang nach dem Essen, und ein
    // Trend bezogen auf NOW würde Post-Meal-Anstiege als pre-meal
    // missdeuten. Frische Samples ziehen, dann gegen die Mahlzeitzeit
    // klassifizieren.
    const refMs = confirmedMeal.meal_time
      ? Date.parse(confirmedMeal.meal_time) || Date.now()
      : Date.now();
    refreshTrendSamples().then(samples => {
      const trend = getPreTrendForRef(refMs, samples);
      setTimeout(() => {
        const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, effectiveICR, tEngineFn, formatNum, trend, new Date(refMs), activityCtx);
        setDecisionRec(rec);
        setDecisionMode("rec");
        setDecisionBusy(false);
      }, 200);
    });
  }

  function handleDecisionAcceptRec() {
    if (!confirmedMeal || !decisionRec) return;
    // KEIN silent-write mehr. "Übernehmen →" trägt die empfohlene Dosis nur
    // ins editierbare Insulin-Feld ein und schaltet in den insulin-Sub-Mode.
    // Der eigentliche PATCH passiert erst bei Confirm Log dort
    // (handleConfirmDecisionInsulin), damit der User die Dosis vorher
    // bestätigen oder anpassen kann.
    setInsulin(String(decisionRec.dose));
    setDecisionInsulinErr(null);
    setDecisionMode("insulin");
  }

  // Final commit aus dem insulin-Sub-Mode: PATCH der Dosis auf die schon
  // existierende Meal-Row (egal ob die Eingabe leer-gestartet aus dem Bolus-
  // Pfad oder pre-populated aus dem Empfehlungs-Pfad kommt).
  async function handleConfirmDecisionInsulin() {
    if (!confirmedMeal) return;
    setDecisionInsulinErr(null);
    const iNum = parseFloat(insulin);
    if (insulin.trim() === "" || !Number.isFinite(iNum) || iNum < 0) {
      setDecisionInsulinErr("Bitte eine gültige Dosis eintragen (0 ist erlaubt).");
      return;
    }
    setDecisionBusy(true);
    try {
      const updated = await updateMeal(confirmedMeal.id, { insulin_units: iNum });
      // Refresh the in-memory list so the next rec uses the updated dose.
      fetchMealsForEngine().then(setMeals).catch(() => {});
      setDecisionToast(`Dosis ${iNum}u gespeichert.`);
      logDebug("ENGINE.DECISION.INSULIN_CONFIRM", {
        id: confirmedMeal.id,
        newDose: iNum,
        evaluation: updated.evaluation,
        viaRec: decisionRec != null,
      });
      resetForm({ keepGlucose: true });
      setTimeout(() => setDecisionToast(null), 2500);
    } catch (e) {
      setDecisionInsulinErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      setDecisionBusy(false);
    }
  }

  // Zurück aus dem insulin-Sub-Mode. Wenn wir aus dem Empfehlungs-Pfad kamen
  // (`decisionRec` gesetzt), geht es zurück in die rec-View — sonst zurück
  // zur binären 3-Button-Decision-View.
  function handleDecisionInsulinBack() {
    setDecisionInsulinErr(null);
    setInsulin("");
    setDecisionMode(decisionRec ? "rec" : "decision");
  }

  async function handleDecisionDelete() {
    if (!confirmedMeal) return;
    setDecisionBusy(true);
    try {
      await deleteMeal(confirmedMeal.id);
      fetchMealsForEngine().then(setMeals).catch(() => {});
      setDecisionToast("Log gelöscht.");
      logDebug("ENGINE.DECISION.DELETE", { id: confirmedMeal.id });
      resetForm({ keepGlucose: true });
      setTimeout(() => setDecisionToast(null), 2500);
    } catch (e) {
      setDecisionToast(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
      setDecisionBusy(false);
    }
  }

  // "Speichern — kein Bolus": commits insulin_units = 0 to the saved meal row
  // and returns to the empty log screen. For meals where the user consciously
  // skipped insulin (e.g. low-carb snack, hypo treatment, pure protein bite).
  async function handleDecisionNoBolus() {
    if (!confirmedMeal) return;
    setDecisionBusy(true);
    try {
      await updateMeal(confirmedMeal.id, { insulin_units: 0 });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      setDecisionToast("Gespeichert ✓ — 0u Bolus");
      logDebug("ENGINE.DECISION.NO_BOLUS", { id: confirmedMeal.id });
      resetForm({ keepGlucose: true });
      setTimeout(() => setDecisionToast(null), 2500);
    } catch (e) {
      setDecisionToast(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      setDecisionBusy(false);
    }
  }

  const inp: React.CSSProperties = { background:"var(--input-bg)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"11px 14px", color:"var(--text)", fontSize:14, outline:"none", width:"100%" };
  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };

  // Single source of truth for the EngineChatPanel JSX — mounted in
  // exactly one location depending on viewport. On mobile (<=768px) it
  // sits inside Step 1's body, between the Sprechen pill and the
  // "Weiter zu Makros prüfen" button (legacy stacked layout). On
  // desktop (>768px) it lives in the sticky right sidebar next to the
  // wizard so users can keep chatting/refining macros while reviewing
  // Step 2 + Step 3 — mirroring /log's `minmax(0, 1fr) 400px` pattern.
  // The chatPanelRef is attached to the wrapper so the existing
  // scroll-into-view after voice parse still works on mobile; on
  // desktop the panel is always visible so the scroll is a no-op.
  const chatPanelNode = (
    <div
      ref={chatPanelRef}
      style={{
        width: "100%",
        // Desktop: the wrapper sits inside a sticky <aside> with a
        // fixed viewport-derived height — `height: 100%` lets the
        // EngineChatPanel's own `height: 100%` desktop branch fill
        // that available space.
        // Mobile: become a flex item that grabs all remaining height
        // in the Step 1 flex column (see stepIndex===0 wrapper) so
        // the chat card extends flush down to the fixed bottom-nav.
        // `display:flex` propagates the height into the inner
        // EngineChatPanel which uses `flex:1` on its mobile branch.
        ...(isMobile
          ? { flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column" as const }
          : { height: "100%" }),
        marginTop: isMobile ? 4 : 0,
      }}
    >
      <EngineChatPanel
        macros={{
          // EngineChatPanel + /api/chat-macros operate in
          // GRAMS end-to-end, so convert the displayed carbs
          // value (g/BE/KE) back to grams here.
          carbs:   carbUnit.toGrams(Number(carbs) || 0),
          protein: Number(protein) || 0,
          fat:     Number(fat)     || 0,
          fiber:   Number(fiber)   || 0,
        }}
        description={desc}
        onPatch={(patch) => {
          // SAFETY: when the chat re-aggregation came back as
          // 'unknown' (at least one ingredient where both DB
          // lookups AND the GPT estimate failed) the totals
          // can't be trusted for insulin dosing — leave the
          // form fields untouched so the user has to enter
          // them manually. Description still updates so they
          // can see what the AI heard.
          if (patch.nutritionSource !== "unknown") {
            // patch.carbs comes back in GRAMS — convert to the
            // user's display unit before writing back into form.
            setCarbs(String(carbUnit.fromGrams(Number(patch.carbs))));
            setProtein(String(patch.protein));
            setFat(String(patch.fat));
            setFiber(String(patch.fiber));
          }
          if (patch.description) setDesc(patch.description);
          // The chat-macros route runs the chat description through
          // the same DB-backed nutrition pipeline as voice input,
          // so refresh the provenance badge whenever the patch
          // includes a fresh source (null = pure meta question,
          // current source stays).
          if (patch.nutritionSource !== undefined && patch.nutritionSource !== null) {
            setNutritionSource(patch.nutritionSource);
          }
          // Forward per-item breakdown so the next save persists
          // each ingredient's source into meals.parsed_json.
          // Three cases:
          //  - items === null/undefined (meta-question turn) →
          //    KEEP the existing breakdown from the initial parse.
          //  - items === []  (re-aggregation produced nothing) →
          //    EXPLICITLY clear so the save site falls back to
          //    the legacy single-item shape and stale provenance
          //    cannot leak into the saved meal.
          //  - items.length  > 0 (re-aggregation succeeded)   →
          //    overwrite with the fresh per-item breakdown.
          if (Array.isArray(patch.items)) {
            setParsedItems(patch.items);
          }
          const hasMacros =
            patch.carbs > 0 || patch.protein > 0 ||
            patch.fat > 0   || patch.fiber > 0;
          if (hasMacros) void handlePullCgm();
        }}
        seed={chatSeed}
        isMobile={isMobile}
        expanded={true}
        onToggleExpanded={() => { /* always expanded */ }}
        parsing={parsing}
        hasUsedVoice={hasUsedVoice}
      />
    </div>
  );

  return (
    <div
      data-engine-cockpit
      style={{
        // Cockpit frame (Task #315): claim the full inner viewport
        // between the Layout's fixed header + bottom nav and forbid
        // page-level scroll/bounce. Inner scroll, where unavoidable
        // (long forms, chat history), is delegated to the dedicated
        // scroll region below this header strip.
        maxWidth: 1100, margin:"0 auto",
        height: "100%",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        overscrollBehavior: "none",
        touchAction: "manipulation",
      }}
    >
      {/* The previous "Glev Engine" h1 + subtitle block was removed per
          UX request — page identification now comes from the global app
          header (logo top-left) and the tab chip (top-right chevron),
          so the chat panel can sit immediately under the header without
          wasting vertical space. Tabs are toggled via the chevron in
          the global mobile header (see Layout.tsx). On desktop where
          there is no global mobile header, we still render an in-page
          toggle so the tab strip remains reachable. */}
      {(() => {
        // Same 4 sub-tabs on mobile + desktop so QuickAddMenu deep-links
        // (?tab=bolus|exercise|fingerstick) light up the matching strip
        // button on both viewports. Previously desktop only had
        // engine|log|fingerstick which meant arriving via "Exercise loggen"
        // on desktop showed the form below but the strip's active label
        // fell back to "Engine" — confusing the user into thinking the
        // navigation broke. The "log" combined view is dropped; users
        // now click the dedicated tab they want.
        // Cycle tab is gated on biological sex — male users never see
        // it (no bleeding / phase concept applies). Symptoms tab stays
        // visible for everyone; the PMS subcategory inside it is gated
        // separately in the SymptomForm itself.
        const tabsCfg = [
          { id:"engine"      as const, label: tEngine("tab_engine") },
          { id:"bolus"       as const, label: tEngine("tab_insulin") },
          { id:"exercise"    as const, label: tEngine("tab_exercise") },
          { id:"fingerstick" as const, label: tEngine("tab_glucose") },
          ...(showCycleTab
            ? [{ id:"cycle" as const, label: tEngine("tab_cycle") }]
            : []),
          { id:"symptoms"    as const, label: tEngine("tab_symptoms") },
          { id:"influences"  as const, label: tEngine("tab_influences") },
        ];
        // Single source of truth for the tab dropdown: the chevron pill
        // in the global app header (Layout.tsx) — which already shows
        // the active tab label. The duplicate in-page chevron pill that
        // used to sit here was removed 2026-04-29 (user feedback: "es
        // braucht nicht zwei dropdown pills"). The tabs row still
        // renders here, just collapsed by default; opening it from the
        // header pill drops it in below the app header so the user sees
        // the choices without losing context.
        // Visual style mirrors the Verlauf (history) page toggle in
        // app/(protected)/history/page.tsx — pill-shaped container,
        // solid ACCENT fill for the active button, white text on both
        // states, subtle rgba(255,255,255,0.06) container background.
        // Pills are content-sized (`flex: 0 0 auto`) and the row uses
        // `space-around` so each German label stays fully spelled out
        // even on iPhone 13 mini (truncation reported on the matching
        // Settings toggle 2026-04-29 — switched both to the same
        // approach for visual + behavioural consistency).
        return tabsExpanded ? (
          <div style={{ marginBottom: 16 }}>
            <div
              id="engine-tabs-body"
              role="tablist"
              aria-label="Engine"
              style={{
                display:"flex", width:"100%", gap:2,
                padding:4, background:"var(--border-soft)",
                borderRadius:99, boxSizing:"border-box",
                justifyContent:"space-around",
                overflowX:"auto", scrollbarWidth:"none",
              }}
            >
              {tabsCfg.map(t => {
                const on = tab === t.id;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.id)}
                    style={{
                      flex:"0 0 auto",
                      padding:"8px 14px",
                      borderRadius:99, border:"none", cursor:"pointer",
                      background: on ? ACCENT : "transparent",
                      color:"var(--text)",
                      fontSize:14, fontWeight: on ? 600 : 500,
                      textAlign:"center", whiteSpace:"nowrap",
                      transition:"background 0.15s",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null;
      })()}

      {/* Cockpit content area (Task #315): a non-scrolling flex column
          that fills whatever the locked viewport leaves below the tab
          strip. The Engine tab's chat panel does its own internal
          scrolling; the form tabs each mount a bounded scroll
          subregion. The cockpit frame itself never scrolls or
          rubber-bands. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          overscrollBehavior: "contain",
        }}
      >
      {tab === "engine" && (
        <div
          style={
            isMobile
              ? { maxWidth: 720, margin: "0 auto", width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
              : {
                  // Desktop 2-column layout mirrors /log's old
                  // `minmax(0, 1fr) 400px` grid: wizard left, sticky
                  // EngineChatPanel sidebar right. Aligning items at
                  // `start` lets the sidebar's position:sticky anchor
                  // independently of the wizard's intrinsic height,
                  // so the chat stays glued under the app header
                  // while the user scrolls Steps 2 and 3. The
                  // `minmax(0, 1fr)` floor on the wizard column
                  // collapses any min-content overflow so children
                  // with long inline content (chips, badges) don't
                  // stretch the column past its intended share.
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 400px",
                  gap: 24,
                  alignItems: "start",
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  overflow: "hidden",
                }
          }
        >
          <div
            style={{
              maxWidth: 720, margin: "0 auto", width: "100%", minWidth: 0,
              // Bounded scroll subregion (Task #315): the wizard column
              // is the only place inside the engine cockpit that may
              // genuinely overflow on small viewports (long Step 2 form,
              // chips, banners). Scrolling stays inside this column, with
              // overscroll-behavior:contain so it never bubbles up to the
              // locked page frame.
              flex: 1, minHeight: 0,
              overflowY: "auto", overflowX: "hidden",
              overscrollBehavior: "contain",
              // WebkitOverflowScrolling:"touch" was removed — on Android
              // WebView it creates a native scroll handler that ignores
              // touch-action:none on child elements (e.g. SnapSlider drag
              // surface), causing the slider to be unresponsive to drags.
              // Modern iOS 14+ and Android WebView handle momentum scrolling
              // natively without this property, so removing it is safe.
              // Flex column so step cards (Step 2 macros, post-save
              // confirmation) can claim `flex: 1` and stretch all the
              // way from just below the header to flush against the
              // nav top edge on mobile — no dark page-bg band visible
              // around the card (user feedback 2026-05-17).
              display: "flex", flexDirection: "column",
              // Reserve space at the bottom equal to the full nav height
              // so buttons in the action row (e.g. "Erkläre mir die
              // Berechnung") can be scrolled ABOVE the fixed bottom nav
              // and aren't hidden behind it, causing accidental nav taps.
              paddingBottom: isMobile ? "var(--nav-bottom-total)" : 0,
            }}
          >
          {adjustmentVisible && currentAdjustment && (
            <div
              role="region"
              aria-label={tEngine("adjustment_banner_title")}
              style={{
                marginBottom: 16,
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(99, 102, 241, 0.35)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary, #1f2937)" }}>
                {tEngine("adjustment_banner_title")}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--text-secondary, #4b5563)" }}>
                {tInsights(
                  currentAdjustment.suggestion.message.key as Parameters<typeof tInsights>[0],
                  currentAdjustment.suggestion.message.params,
                )}
              </div>
              {adjustmentErr && (
                <div role="alert" style={{ fontSize: 13, color: "#b91c1c" }}>{adjustmentErr}</div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleApplyAdjustment}
                  disabled={adjustmentBusy}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "#4f46e5",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: adjustmentBusy ? "wait" : "pointer",
                    opacity: adjustmentBusy ? 0.7 : 1,
                  }}
                >
                  {adjustmentBusy ? tEngine("adjustment_apply_busy") : tEngine("adjustment_apply")}
                </button>
                <button
                  type="button"
                  onClick={handleDismissAdjustment}
                  disabled={adjustmentBusy}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid rgba(99, 102, 241, 0.45)",
                    background: "transparent",
                    color: "#4f46e5",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                  title={tEngine("adjustment_dismiss_hint")}
                >
                  {tEngine("adjustment_dismiss")}
                </button>
              </div>
            </div>
          )}
          {/* Wizard form is single-column by design — on mobile the chat
              panel sits inside Step 1's body (legacy stacked layout), on
              desktop it lives in the sticky right sidebar declared after
              this column. We still cap the wizard's inner content at 720
              so input rows stay comfortable to scan even when the wider
              outer grid gives the column extra breathing room. */}
          <style>{`
            @keyframes engSpin   { to { transform: rotate(360deg) } }
          `}</style>

          {/* Page-level success toast (post-save) and error banner. Rendered
              above the active step so they're visible regardless of current step. */}
          {decisionToast && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: `${GREEN}15`, border: `1px solid ${GREEN}40`, color: GREEN, fontSize: 13 }}>
              {decisionToast}
            </div>
          )}
          {confirmErr && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: `${PINK}15`, border: `1px solid ${PINK}40`, color: PINK, fontSize: 13 }}>
              {confirmErr}
            </div>
          )}

          {/* ───────── STEP 1: AI Chat-Panel (full screen).
              The page-content Sprechen button was removed (2026-05-17):
              the bottom-nav Glev FAB now owns the start/stop voice
              gesture (start via quick-add "Voice" with ?voice=1
              auto-start, stop by tapping the FAB again), and the
              global header surfaces the "Speak" recording-state pill.
              That frees Step 1 to be a single full-screen AI parser
              field — the EngineChatPanel — so the user can chat or
              dictate without competing controls on the same screen.
              Voice path: quick-add → /engine?voice=1 → auto-record →
              handleVoice → /api/parse-food → fields fill → auto-
              advance to Step 2.
              Chat path: user types into EngineChatPanel → /api/chat-
              macros → AI replies → onPatch fills the form → if
              macros come back populated, auto-advance to Step 2. */}
          {stepIndex === 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "stretch",
              gap: 10,
              // Bottom padding bumped on mobile (8 → 48) so the
              // "Weiter zu Makros" CTA never sits directly under the
              // bottom-nav Glev FAB's protruding upper half. The FAB
              // overlaps the nav top edge by ~26 px (half its 52 px
              // diameter); without extra clearance, the blue CTA bar
              // peeked out from under the FAB and looked like the FAB
              // was being "hidden behind a black bar" (user feedback
              // 2026-05-17).
              padding: isMobile ? "12px 0 48px" : "12px 0 8px",
              // Mobile: stretch the column so the chat panel (flex:1
              // inside) fills the available viewport between the fixed
              // app header (~64 + safe-area-top) and the fixed bottom-
              // nav. ~180px reservation (was 140) accounts for the new
              // 48 px bottom padding above plus the step indicator
              // pills and safe-area-bottom. Desktop keeps natural
              // height since the chat lives in a sticky right sidebar
              // instead.
              // Position relative so the Step 1 chat panel isn't a
              // back-button anchor (Step 1 has no back action), but
              // Steps 2 & 3 reuse the same outer column class so the
              // anchor doesn't hurt them either.
              position: "relative",
              minHeight: isMobile
                ? "calc(100svh - 180px - var(--nav-top-safe))"
                : undefined,
            }}>
              {/* Desktop fallback start/stop control. Mobile users always
                  reach the engine via the bottom-nav Glev FAB → quick-add
                  → Voice path (which deep-links with ?voice=1 and auto-
                  records), and use the same FAB to stop. Desktop has no
                  bottom nav, so without this inline pill a user landing
                  on /engine via sidebar/deep-link would have no
                  discoverable way to record. Hidden on mobile so the
                  AI chat panel can own the full screen there. */}
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => recording ? stopRecording() : startRecording()}
                  disabled={parsing || !speechAvail}
                  aria-label={recording ? tEngine("voice_aria_stop") : tEngine("voice_aria_start")}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
                    width: "100%", maxWidth: 280, height: 52, borderRadius: 26,
                    alignSelf: "center",
                    background: recording ? `${ACCENT}1f` : SURFACE,
                    border: `1px solid ${recording ? ACCENT : `${ACCENT}55`}`,
                    color: "var(--text)",
                    fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                    cursor: parsing || !speechAvail ? "not-allowed" : "pointer",
                    boxShadow: recording ? `0 0 0 1px ${ACCENT}66, 0 0 22px ${ACCENT}33` : `0 0 0 1px ${ACCENT}22`,
                    opacity: parsing || !speechAvail ? 0.55 : 1,
                    transition: "background 0.2s, border-color 0.2s, opacity 0.2s, box-shadow 0.2s",
                  }}
                >
                  <span aria-hidden="true" style={{
                    display: "inline-flex",
                    filter: `drop-shadow(0 0 ${recording ? 8 : 4}px ${ACCENT}${recording ? "cc" : "55"})`,
                    transition: "filter 0.25s",
                  }}>
                    <GlevLogo size={22} color={ACCENT} bg="transparent"/>
                  </span>
                  {recording ? tEngine("voice_btn_stop") : parsing ? tEngine("voice_btn_processing") : tEngine("voice_btn_speak")}
                </button>
              )}
              {voiceErr && (
                <div style={{ fontSize: 13, color: PINK, textAlign: "center", maxWidth: 360, alignSelf: "center" }}>{voiceErr}</div>
              )}
              {/* FIX B: Explain WHY the Sprechen button is disabled when the
                  browser doesn't expose MediaRecorder + getUserMedia (iOS
                  Safari < 14.5, embedded webviews, http://). Without this
                  hint the button just appears greyed out with no recourse,
                  and users don't realise they can fall back to the chat. */}
              {!speechAvail && !voiceErr && (
                <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", maxWidth: 360, lineHeight: 1.4 }}>
                  {tEngine("voice_unavailable_hint")}
                </div>
              )}
              {/* Mobile-only mount of the chat panel. On desktop the same
                  chatPanelNode lives in the sticky right sidebar (rendered
                  next to this wizard column) so the chat stays visible
                  while the user moves through Steps 2 and 3 — see the
                  outer 2-column grid below. */}
              {isMobile && chatPanelNode}
              {(() => {
                const anyMacro =
                  (Number(carbs)   || 0) > 0 ||
                  (Number(protein) || 0) > 0 ||
                  (Number(fat)     || 0) > 0 ||
                  (Number(fiber)   || 0) > 0;
                const ready = hasUsedVoice || anyMacro;
                if (!ready) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setStepIndex(1)}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", maxWidth: 360, height: 48, borderRadius: 14,
                      background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                      border: "none", color:"var(--text)",
                      fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
                      cursor: "pointer",
                      boxShadow: `0 4px 20px ${ACCENT}40`,
                      WebkitTapHighlightColor: "transparent",
                      marginTop: 6,
                    }}
                    aria-label={tEngine("btn_advance_to_macros_aria")}
                  >
                    {tEngine("btn_advance_to_macros")}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </button>
                );
              })()}
            </div>
          )}

          {/* ───────── STEP 2: Makros prüfen (or post-save confirmation) ───────── */}
          {stepIndex === 1 && wizardSavedDose !== null && (
            <div style={{
              ...card, padding: 24,
              // Natural height (NOT flex:1) per 2026-05-17 user
              // report "wenn ich in diesem screen hier bin gehen die
              // anderen footer nav elemente irgendwie nicht mehr".
              // The previous flex:1+minHeight:0 stretch made this
              // confirmation card claim the entire wizard column —
              // its bottom edge butted right up against the nav and,
              // on iOS Capacitor WebView, the resulting overlap layer
              // intercepted taps that were aimed at the surrounding
              // Dashboard/Entries/Insights/Settings tabs. Shrinking
              // the card to fit its content (status banner + New
              // meal CTA) leaves a clean page-bg gap above the nav so
              // the tabs are unambiguously the topmost paint there.
            }}>
              {/* Subtle hint that this is a transient confirmation —
                  the New meal CTA is the only action; the bottom-nav
                  is reachable below the card. */}
              <div
                style={{
                  width: "100%", padding: "14px 18px",
                  borderRadius: 12,
                  background: `${GREEN}12`,
                  border: `1px solid ${GREEN}40`,
                  color: GREEN,
                  fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
                  textAlign: "center",
                  marginBottom: 14,
                }}
                role="status"
                aria-live="polite"
              >
                {tEngine("saved_confirmation", { units: formatNum(wizardSavedDose ?? 0, 1) })}
              </div>
              <button
                onClick={handleNewMeal}
                style={{
                  width: "100%", height: 52, borderRadius: 12, border: "none",
                  background: ACCENT,
                  color:"var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                {tEngine("btn_new_meal")}
              </button>
            </div>
          )}
          {stepIndex === 1 && wizardSavedDose === null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...card, padding: 18, position: "relative" }}>
              {/* Back chevron — top-left of the card per user request
                  2026-05-17 ("der back button sollte oben links in der
                  karte sein"). Replaces the bottom "Zurück" row that
                  used to live below the action stack. Absolute so it
                  sits flush in the corner without pushing the card
                  layout around. */}
              <button
                type="button"
                onClick={() => setStepIndex(0)}
                disabled={confirming || running}
                aria-label={tEngine("btn_back")}
                title={tEngine("btn_back")}
                style={{
                  position: "absolute", top: 10, left: 10, zIndex: 2,
                  width: 36, height: 36, borderRadius: 18,
                  border: "none", background: "transparent",
                  color: "var(--text-dim)",
                  cursor: confirming || running ? "not-allowed" : "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              {/* Step-2 page title removed — the wizard step pill at the
                  top ("2 Makros") already names the screen. Dropping it
                  reclaims ~50px and keeps everything (Macros + Glucose
                  + Time + 3 action buttons) on one mobile screen.
                  The back chevron above takes only ~36 px in the upper-
                  left corner — it overlays the empty space left of the
                  first macro card, so the layout flow is unchanged. */}

              {/* Macros block — eyebrow "MAKROS" label removed; the
                  source badge has moved to the global mobile app
                  header (Layout.tsx → EngineSourceHeaderProvider)
                  to reclaim ~30 px at the top of the card. The four
                  ring cards self-explain the section. */}
              <div style={{ marginBottom: 14 }}>
                {/* Macros as tap-able ring cards mirroring the dashboard's
                    "TODAY'S MACROS" section. Tap a card → its 0.5 g slider
                    folds out underneath (0.5 step in every unit, g / BE / KE).
                    State (`carbs`, `protein`, `fat`, `fiber`) is kept here
                    and threaded through unchanged, so all downstream
                    validation / save / bolus math keeps working. */}
                <ReviewMacrosCards
                  carbs={carbs}
                  protein={protein}
                  fat={fat}
                  fiber={fiber}
                  setCarbs={setCarbs}
                  setProtein={setProtein}
                  setFat={setFat}
                  setFiber={setFiber}
                  carbUnit={{
                    unit: carbUnit.unit,
                    label: carbUnit.label,
                    step: carbUnit.step,
                    toGrams: carbUnit.toGrams,
                    fromGrams: carbUnit.fromGrams,
                  }}
                  labels={{
                    carbs:   tEngine("carbs_label"),
                    protein: tEngine("protein_label"),
                    fat:     tEngine("fat_label"),
                    fiber:   tEngine("fiber_label"),
                  }}
                />
              </div>

              {/* Phase B: portion suggestion chips — shown for each parsed
                  item that has a user_food_history hit. Tapping
                  "Übernehmen" recalculates the affected macros using
                  the history-backed typical_grams. The chip is
                  dismissible per item. Chips are only shown when there
                  is at least one non-dismissed suggestion available. */}
              {(() => {
                const activeSuggestions = parsedItems
                  .filter((it) => {
                    const hit = portionSuggestions.get(it.name);
                    if (!hit) return false;
                    if (dismissedSuggestions.has(it.name)) return false;
                    // Skip suggestion if the current grams already match
                    return Math.abs(it.grams - hit.suggestedGrams) > 1;
                  });
                if (activeSuggestions.length === 0) return null;
                return (
                  <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    {activeSuggestions.map((it) => {
                      const hit = portionSuggestions.get(it.name)!;
                      const scaleFactor = hit.suggestedGrams / (it.grams || 1);
                      return (
                        <div
                          key={it.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 10px",
                            borderRadius: 10,
                            background: "rgba(79,110,247,0.07)",
                            border: "1px solid rgba(79,110,247,0.22)",
                            fontSize: 13,
                          }}
                        >
                          <span style={{ flex: 1, color: "var(--text-muted)", minWidth: 0 }}>
                            <span style={{ fontWeight: 600, color: "var(--text)" }}>{hit.displayName}</span>
                            {" "}Zuletzt: {Math.round(hit.suggestedGrams)} g
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              hapticSelection();
                              // Scale this item's macro contribution in the totals.
                              const carbsG   = carbUnit.toGrams(parseFloat(carbs)   || 0);
                              const proteinG = parseFloat(protein) || 0;
                              const fatG     = parseFloat(fat)     || 0;
                              const fiberG   = parseFloat(fiber)   || 0;
                              const newCarbsG   = carbsG   - it.carbs   + it.carbs   * scaleFactor;
                              const newProteinG = proteinG - it.protein + it.protein * scaleFactor;
                              const newFatG     = fatG     - it.fat     + it.fat     * scaleFactor;
                              const newFiberG   = fiberG   - it.fiber   + it.fiber   * scaleFactor;
                              setCarbs(String(Math.round(carbUnit.fromGrams(Math.max(0, newCarbsG)) * 10) / 10));
                              setProtein(String(Math.round(Math.max(0, newProteinG) * 10) / 10));
                              setFat(String(Math.round(Math.max(0, newFatG) * 10) / 10));
                              setFiber(String(Math.round(Math.max(0, newFiberG) * 10) / 10));
                              // Update the parsedItem's grams for future suggestion comparisons
                              setParsedItems((prev) =>
                                prev.map((p) =>
                                  p.name === it.name
                                    ? { ...p, grams: hit.suggestedGrams, carbs: p.carbs * scaleFactor, protein: p.protein * scaleFactor, fat: p.fat * scaleFactor, fiber: p.fiber * scaleFactor }
                                    : p
                                )
                              );
                              setDismissedSuggestions((prev) => new Set([...prev, it.name]));
                            }}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 7,
                              background: ACCENT,
                              color: "#fff",
                              border: "none",
                              fontWeight: 600,
                              fontSize: 12,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Übernehmen
                          </button>
                          <button
                            type="button"
                            aria-label="Vorschlag verwerfen"
                            onClick={() => setDismissedSuggestions((prev) => new Set([...prev, it.name]))}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--text-faint)",
                              cursor: "pointer",
                              fontSize: 16,
                              lineHeight: 1,
                              padding: "0 2px",
                            }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Glucose + Meal-Time block — uppercase section eyebrows
                  ("GLUKOSE & ZEIT", "GLUKOSE VORHER", "MAHLZEIT-ZEIT")
                  removed per user request: the field placeholders + value
                  formats are self-explanatory and the labels were eating
                  ~80px of vertical space, pushing the action buttons off
                  the first screen. The two compact rows below replace
                  three label+input pairs while keeping every interaction
                  (CGM pull pill, trend arrow, native datetime picker) in
                  place. */}
              {/* 2026-05-18 simplified glucose + meal-time block per user:
                  "es soll einfach unter dem cgm wert stehen, dieser soll
                  vom style auch so werden ohne chip drum herum simpel
                  gehalten". Big mono number for the glucose value, mono
                  date underneath — matches the MacroRing value typography
                  so the whole step reads as one visual family. CGM-pull
                  becomes a small text link to the right of the value
                  (still tappable, no longer dominates the row). */}
              {/* 2-row info block:
                    Left  col: date (accent) / time (green) — tapping opens native picker
                    Right col: glucose value + CGM badge / mg/dL label
                  Saves ~16px vertical vs the old stacked layout. */}
              {(() => {
                // Parse the datetime-local string ("YYYY-MM-DDTHH:mm") for
                // custom coloured display. Falls back to "—" on bad input.
                // (parseLocalDt lives in EngineLogTab, so we inline here.)
                function parseDtLocal(v: string): Date | null {
                  if (!v) return null;
                  const d = new Date(v);
                  return isNaN(d.getTime()) ? null : d;
                }
                function nowDtLocal(): string {
                  const off = new Date().getTimezoneOffset() * 60_000;
                  return new Date(Date.now() - off).toISOString().slice(0, 16);
                }
                function oneYearAgoDtLocal(): string {
                  const off = new Date().getTimezoneOffset() * 60_000;
                  return new Date(Date.now() - 365 * 86400_000 - off).toISOString().slice(0, 16);
                }
                const mealDate = (() => {
                  const d = parseDtLocal(mealTime);
                  if (!d) return "—";
                  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
                })();
                const mealTimeFmt = (() => {
                  const d = parseDtLocal(mealTime);
                  if (!d) return "—";
                  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
                })();
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, alignItems: "center", marginBottom: 14 }}>
                    {/* LEFT — date + time (coloured), tap → native picker */}
                    <div style={{ position: "relative", paddingLeft: 4 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: ACCENT, lineHeight: 1.5 }}>
                        {mealDate}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: GREEN, lineHeight: 1.5 }}>
                        {mealTimeFmt}
                      </div>
                      {/* Transparent datetime-local input overlaid so tapping the
                          coloured text opens the native iOS / Android picker. */}
                      <input
                        type="datetime-local"
                        value={mealTime}
                        min={oneYearAgoDtLocal()}
                        max={nowDtLocal()}
                        onChange={(e) => setMealTime(e.target.value)}
                        aria-label={tEngine("meal_time_label")}
                        style={{
                          position: "absolute", inset: 0,
                          opacity: 0, width: "100%", height: "100%",
                          cursor: "pointer",
                        }}
                      />
                    </div>

                    {/* RIGHT — glucose value (row 1) + mg/dL (row 2) */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      {/* Row 1: trend arrow + glucose input + CGM badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {currentTrend && (
                          <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
                            <TrendArrow trend={currentTrend} t={tEngine}/>
                          </div>
                        )}
                        <input
                          type="number"
                          placeholder="—"
                          value={glucose}
                          onChange={(e) => setGlucose(e.target.value)}
                          aria-label={tEngine("glucose_before_label")}
                          style={{
                            background: "transparent", border: "none", outline: "none",
                            width: glucose ? `${Math.max(2, glucose.length)}ch` : "4ch",
                            textAlign: "right",
                            fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 28,
                            color: "var(--text)", padding: 0,
                            MozAppearance: "textfield",
                          }}
                        />
                        <button
                          onClick={handlePullCgm}
                          disabled={cgmPulling}
                          title={lastReading ? `${tEngine("glucose_last_prefix")}: ${lastReading}` : undefined}
                          aria-label={tEngine("cgm_button")}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "3px 6px", borderRadius: 6,
                            border: "none", background: "transparent",
                            color: ACCENT, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                            cursor: cgmPulling ? "wait" : "pointer",
                            textTransform: "uppercase",
                          }}
                        >
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, boxShadow: `0 0 4px ${GREEN}` }}/>
                          {cgmPulling ? tEngine("cgm_pulling") : tEngine("cgm_button")}
                        </button>
                      </div>
                      {/* Row 2: unit */}
                      <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
                        mg/dL
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Bolus-berechnen Toggle ─────────────────────────── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: bolusEnabled ? 12 : 0, padding: "2px 0" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)", letterSpacing: "-0.01em" }}>
                  {tEngine("bolus_toggle_label")}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bolusEnabled}
                  onClick={() => setBolusEnabled(v => !v)}
                  style={{
                    width: 44, height: 26, borderRadius: 13, border: "none",
                    background: bolusEnabled ? ACCENT : "var(--border)",
                    position: "relative", cursor: "pointer", flexShrink: 0,
                    transition: "background 200ms ease",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 3, borderRadius: "50%",
                    width: 20, height: 20, background: "var(--text)",
                    left: bolusEnabled ? 21 : 3,
                    transition: "left 200ms ease",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  }} />
                </button>
              </div>

              {/* ── Combined ICR+dose chips ──────────────────────────
                  Each chip shows label + ratio + dose in one block,
                  replacing the previous 4-element layout (2 ICR cards
                  + 2 separate dose chips). Manual override row below. */}
              {bolusEnabled && (() => {
                const showBoth = shouldShowBothChips({
                  icrSampleSize,
                  adaptedICR,
                  staticICR,
                  adaptiveDose: eagerDoses.adaptive,
                  staticDose:   eagerDoses.static,
                });
                type ChipDef = { key: 'adaptive' | 'static'; label: string; icr: number; dose: number | null; sub?: string };
                const chips: ChipDef[] = [];
                // For the SELECTED chip: show activeDose (uses result.dose
                // once the engine has run, eagerDose before). This keeps
                // the chip, the Speichern button, and the explainer sheet
                // in sync — all three show the same number.
                // For the non-selected chip: prefer the real engine result
                // when the engine was already run with that chip's ICR source
                // (resultICRSource matches), so both chips show consistent
                // numbers. Fall back to eagerDose only before any engine run.
                const eagerAdaptive = eagerDoses.adaptive !== null ? applyIOBCorrection(eagerDoses.adaptive, iob) : null;
                const eagerStatic   = eagerDoses.static   !== null ? applyIOBCorrection(eagerDoses.static,   iob) : null;
                const inactiveAdaptive = (result && resultICRSource === 'adaptive')
                  ? applyIOBCorrection(result.dose, iob)
                  : eagerAdaptive;
                const inactiveStatic = (result && resultICRSource === 'static')
                  ? applyIOBCorrection(result.dose, iob)
                  : eagerStatic;
                if (showBoth) {
                  if (adaptedICR > 0) chips.push({ key: 'adaptive', label: tEngine("icr_adaptive_label"), icr: adaptedICR, dose: selectedICR === 'adaptive' ? activeDose : inactiveAdaptive, sub: tEngine("icr_calculated") });
                  if (staticICR > 0) chips.push({ key: 'static', label: tEngine("icr_static_label"), icr: staticICR, dose: selectedICR === 'static' ? activeDose : inactiveStatic, sub: staticICRWindowLabel ?? undefined });
                } else {
                  const icr = effectiveICR;
                  if (icr > 0) chips.push({ key: selectedICR, label: selectedICR === 'adaptive' ? tEngine("icr_adaptive_label") : tEngine("icr_static_label"), icr, dose: activeDose });
                }
                if (chips.length === 0) return null;
                return (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      {chips.map(chip => {
                        const isSel = selectedICR === chip.key;
                        return (
                          <button
                            key={chip.key}
                            type="button"
                            onClick={() => setSelectedICR(chip.key)}
                            style={{
                              flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 12,
                              border: `2px solid ${isSel ? ACCENT : 'var(--border)'}`,
                              background: isSel ? `${ACCENT}14` : "var(--surface-soft)",
                              textAlign: "left", cursor: "pointer",
                              transition: "border-color 150ms ease, background 150ms ease",
                              display: "flex", flexDirection: "column", gap: 2,
                              overflow: "hidden", WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isSel ? ACCENT : "var(--text-faint)", whiteSpace: "nowrap" }}>
                              {chip.label}
                            </span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 800, color: isSel ? ACCENT : "var(--text-strong)", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              1 : {Math.round(chip.icr * 10) / 10}
                            </span>
                            {chip.dose !== null && (
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: isSel ? ACCENT : "var(--text-dim)", whiteSpace: "nowrap" }}>
                                {formatNum(chip.dose, 1)} {tEngine("units_short")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {/* Manual dose override */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>
                        Manuell
                      </span>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "var(--surface-soft)",
                        border: `1px solid ${manualDose.trim() !== "" ? ACCENT : "var(--border)"}`,
                        borderRadius: 8, padding: "4px 8px", flex: 1, maxWidth: 148,
                      }}>
                        <button
                          type="button"
                          onClick={() => {
                            const v = Math.max(0, Math.round(((parseFloat(manualDose) || 0) * 10 - 1)) / 10);
                            setManualDose(v === 0 ? "" : String(v));
                          }}
                          style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1, WebkitTapHighlightColor: "transparent" }}
                        >−</button>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={manualDose}
                          onChange={e => setManualDose(e.target.value)}
                          placeholder="—"
                          step="0.1"
                          min="0"
                          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text)", textAlign: "center", width: 0, minWidth: 0, MozAppearance: "textfield" } as React.CSSProperties}
                        />
                        <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{tEngine("units_short")}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const v = Math.round(((parseFloat(manualDose) || 0) * 10 + 1)) / 10;
                            setManualDose(String(v));
                          }}
                          style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1, WebkitTapHighlightColor: "transparent" }}
                        >+</button>
                      </div>
                      {manualDose.trim() !== "" && (
                        <button
                          type="button"
                          onClick={() => setManualDose("")}
                          style={{ background: "transparent", border: "none", color: "var(--text-faint)", fontSize: 13, cursor: "pointer", padding: "0 2px", WebkitTapHighlightColor: "transparent" }}
                        >✕</button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Action row ─────────────────────────────────────────
                  bolusEnabled=false → single "ohne Bolus" button.
                  bolusEnabled=true  → "Speichern — X IE" + Explainer link. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bolusEnabled ? (
                  <>
                    <button
                      onClick={() => activeDose !== null ? handleSaveWithEagerBolus(activeDose) : handleSaveWithoutBolus()}
                      disabled={confirming || running}
                      style={{
                        width: "100%", height: 52, borderRadius: 12, border: "none",
                        background: confirming ? "rgba(79,110,247,0.4)" : ACCENT,
                        color: "var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                        cursor: confirming ? "wait" : "pointer",
                        transition: "background 0.2s",
                      }}
                    >
                      {confirming
                        ? tEngine("btn_saving")
                        : activeDose !== null
                          ? tEngine("btn_save_with_bolus", { dose: formatNum(activeDose, 1), units: tEngine("units_short") })
                          : tEngine("btn_save_without_bolus")}
                    </button>
                    {(() => {
                      const blocked = running || confirming;
                      return (
                        <button
                          type="button"
                          onClick={() => handleRun()}
                          disabled={blocked}
                          style={{
                            width: "100%", height: 36, borderRadius: 6,
                            border: "none", background: "transparent",
                            color: blocked ? "var(--text-ghost)" : ACCENT,
                            fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                            cursor: blocked ? "wait" : "pointer",
                            textDecoration: "underline", textUnderlineOffset: 3,
                            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          {running && (
                            <span style={{
                              display: "inline-block", width: 12, height: 12,
                              border: `2px solid ${ACCENT}40`, borderTopColor: ACCENT,
                              borderRadius: "50%", animation: "engSpin 0.7s linear infinite",
                            }}/>
                          )}
                          {running ? tEngine("btn_calculating") : tEngine("bolus_explainer_link")}
                        </button>
                      );
                    })()}
                  </>
                ) : (
                  <button
                    onClick={handleSaveWithoutBolus}
                    disabled={confirming}
                    style={{
                      width: "100%", height: 52, borderRadius: 12, border: "none",
                      background: confirming ? "rgba(79,110,247,0.4)" : ACCENT,
                      color: "var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                      cursor: confirming ? "wait" : "pointer",
                      transition: "background 0.2s",
                    }}
                  >
                    {confirming ? tEngine("btn_saving") : tEngine("btn_save_without_bolus")}
                  </button>
                )}
              </div>
          </div>
          )}

          {/* BolusExplainerSheet — fixed bottom-sheet replacing Step 3.
              Position:fixed so it overlays the entire page regardless of
              scroll position. Opens when handleRun completes. */}
          {bolusExplainerOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={tEngine("bolus_sheet_title")}
              style={{
                position: "fixed", inset: 0, zIndex: 60,
                display: "flex", flexDirection: "column", justifyContent: "flex-end",
              }}
            >
              {/* Backdrop */}
              <div
                onClick={() => setBolusExplainerOpen(false)}
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.52)" }}
                aria-hidden="true"
              />
              {/* Sheet panel */}
              <div
                style={{
                  position: "relative",
                  background: "var(--surface)",
                  borderRadius: "18px 18px 0 0",
                  padding: "20px 20px calc(env(safe-area-inset-bottom, 0px) + 28px)",
                  maxHeight: "88svh",
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {/* Sheet header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text)" }}>
                    {tEngine("bolus_sheet_title")}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBolusExplainerOpen(false)}
                    aria-label={tEngine("bolus_sheet_close")}
                    style={{
                      background: "transparent", border: "none",
                      color: "var(--text-dim)", fontSize: 22, lineHeight: 1,
                      cursor: "pointer", padding: "0 4px",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    ×
                  </button>
                </div>

                {!result ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
                    {tEngine("no_estimate_body")}
                  </div>
                ) : (
                  <>
                    {/* Dose + confidence card */}
                    <div style={{
                      background: "var(--surface-soft)", border: "1px solid var(--border)",
                      borderRadius: 16, padding: 18, marginBottom: 14,
                    }}>
                      <div style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                        {tEngine("recommended_dose_label")}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 32, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                          {formatNum(applyIOBCorrection(result.dose, iob), 1)}
                        </span>
                        <span style={{ fontSize: 14, color: "var(--text-dim)", fontWeight: 600 }}>{tEngine("units_short")}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 10 }}>
                        {tEngine("dose_disclaimer")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, flexWrap: "wrap" }}>
                        <span style={{ color: "var(--text-muted)" }}>{tEngine("icr_label")}: {carbUnit.displayICR(adaptedICR)}</span>
                        <span
                          title={tEngine(`conf_explain_${result.confidence}` as never)}
                          style={{
                            padding: "2px 10px", borderRadius: 99,
                            fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
                            background: `${CONF_COLOR[result.confidence]}22`,
                            color: CONF_COLOR[result.confidence],
                            border: `1px solid ${CONF_COLOR[result.confidence]}40`,
                          }}
                        >
                          {tEngine(`conf_label_${result.confidence}` as never)}
                        </span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4, color: "var(--text-muted)" }}>
                        {tEngine(`conf_explain_${result.confidence}` as never)}
                      </div>
                      {icrSampleSize > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.4 }}>
                          {tEngine("icr_source", {
                            explicit:   icrPairedExplicitCount,
                            timeWindow: icrPairedTimeWindowCount,
                            mealColumn: Math.max(0, icrSampleSize - icrPairedCount),
                            total:      icrSampleSize,
                          })}
                        </div>
                      )}
                    </div>

                    {/* IOB badges */}
                    {iobDisplay && (
                      <div style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(255,165,0,0.1)", border: "1px solid rgba(255,165,0,0.3)", borderRadius: 10, textAlign: "center" }}>
                        <span style={{ fontSize: 12, color: "rgba(255,200,80,0.85)" }}>
                          {tEngine("iob_active", { iobDisplay })}
                        </span>
                      </div>
                    )}
                    {iob > 0 && result.dose <= iob && (
                      <div style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(0,200,100,0.1)", border: "1px solid rgba(0,200,100,0.3)", borderRadius: 10, textAlign: "center" }}>
                        <span style={{ fontSize: 12, color: "rgba(80,220,140,0.9)" }}>
                          {tEngine("iob_covers_dose")}
                        </span>
                      </div>
                    )}
                    {iobCorrectionRoundedToZero(result.dose, iob) && (
                      <div style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(100,180,255,0.1)", border: "1px solid rgba(100,180,255,0.3)", borderRadius: 10, textAlign: "center" }}>
                        <span style={{ fontSize: 12, color: "rgba(140,200,255,0.9)" }}>
                          ℹ {tEngine("dose_rounded_to_zero")}
                        </span>
                      </div>
                    )}

                    {/* GPT reasoning collapsible */}
                    <div style={{ background: "var(--surface-soft)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
                      <button
                        onClick={() => setReasoningExpanded(v => !v)}
                        aria-expanded={reasoningExpanded}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          width: "100%", padding: "12px 16px",
                          background: "transparent", border: "none", cursor: "pointer",
                          color: "var(--text-faint)", fontSize: 12, fontWeight: 700,
                          letterSpacing: "0.08em", textTransform: "uppercase",
                        }}
                      >
                        <span>{tEngine("gpt_reasoning_title")}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                          style={{ transition: "transform 0.2s", transform: reasoningExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                      {reasoningExpanded && (
                        <div style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.6, color: "var(--text-body)" }}>
                          {renderReasoning(result.reasoning, result.safetyNotes, tEngineFn, formatNum)}
                        </div>
                      )}
                    </div>

                    {/* ICR methodology explanation block */}
                    <div style={{ background: "var(--surface-soft)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 10 }}>
                        {tEngine("bolus_sheet_how_title")}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {adaptedICR > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT, marginBottom: 3 }}>
                              {tEngine("bolus_sheet_adaptive_why")}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                              {tEngine("bolus_sheet_adaptive_detail", { samples: icrSampleSize })}
                            </div>
                          </div>
                        )}
                        {staticICR > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginBottom: 3 }}>
                              {tEngine("bolus_sheet_static_why")}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                              {tEngine("bolus_sheet_static_detail", {
                                slot: staticICRWindowLabel
                                  ? tEngine("bolus_sheet_static_slot", { label: staticICRWindowLabel })
                                  : "",
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Save button or post-save confirmation */}
                    {wizardSavedDose === null ? (
                      <button
                        onClick={handleWizardSave}
                        disabled={confirming}
                        style={{
                          width: "100%", height: 52, borderRadius: 12, border: "none",
                          background: confirming ? "rgba(79,110,247,0.4)" : ACCENT,
                          color: "var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                          cursor: confirming ? "wait" : "pointer",
                          marginBottom: 12, transition: "background 0.2s",
                        }}
                      >
                        {confirming ? tEngine("btn_saving") : tEngine("btn_confirm_save")}
                      </button>
                    ) : (
                      <div
                        style={{
                          width: "100%", padding: "14px 18px", borderRadius: 12,
                          background: `${GREEN}12`, border: `1px solid ${GREEN}40`,
                          color: GREEN, fontSize: 14, fontWeight: 700,
                          textAlign: "center", marginBottom: 12,
                        }}
                        role="status"
                        aria-live="polite"
                      >
                        {tEngine("saved_confirmation", { units: formatNum(wizardSavedDose ?? 0, 1) })}
                      </div>
                    )}

                    {/* Disclaimer */}
                    <div style={{ padding: "12px 16px", background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 12, color: "var(--text-ghost)", lineHeight: 1.6 }}>
                        <strong style={{ color: "var(--text-dim)" }}>{tEngine("disclaimer_label")}</strong> {tEngine("disclaimer_body")}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          </div>

          {/* Desktop-only sticky chat sidebar. Mounts the SAME chatPanelNode
              that mobile renders inside Step 1, so all wizard steps share
              one chat session — no remount, no message reset when the user
              advances Step 1 → 2 → 3. position:sticky pins the panel below
              the global app header (~64px) plus a small breathing gap; the
              capped height keeps the panel within the viewport so its
              internal message scroller works as expected and the input row
              never disappears below the fold. minHeight 480 protects the
              experience on shorter viewports (e.g. landscape laptops). */}
          {!isMobile && (
            <aside
              style={{
                position: "sticky",
                top: 16,
                height: "calc(100vh - 32px)",
                minHeight: 480,
                alignSelf: "start",
                display: "flex",
              }}
            >
              {chatPanelNode}
            </aside>
          )}
        </div>
        )}

              {/* Non-engine tabs each render inside a bounded scroll subregion
          (Task #315). The cockpit frame itself stays fixed; if a given
          form is taller than the available cockpit height, only the
          form card scrolls — not the page. overscroll-behavior:contain
          prevents iOS rubber-band from leaking back to the document. */}
      {tab !== "engine" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            // WebkitOverflowScrolling:"touch" removed — on iOS WKWebView
            // (Capacitor / TestFlight) it creates a native momentum scroll
            // handler that intercepts touch events before pointer events
            // fire, making SnapSlider drags completely unresponsive.
          }}
        >
          {tab === "log"         && <EngineLogTab />}
          {tab === "bolus"       && <InsulinForm />}
          {tab === "exercise"    && <ExerciseForm />}
          {tab === "fingerstick" && <FingerstickLogCard />}
          {tab === "cycle" && showCycleTab && <CycleForm />}
          {tab === "symptoms"    && <SymptomForm />}
          {tab === "influences"  && <InfluenceForm />}
        </div>
      )}
      </div>
    </div>
  );
}
