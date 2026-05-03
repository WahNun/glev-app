"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47 } from "@/lib/time";
import { fetchMealsForEngine, classifyMeal, computeCalories, saveMeal, deleteMeal, updateMeal, type Meal } from "@/lib/meals";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { logDebug } from "@/lib/debug";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import { detectPattern } from "@/lib/engine/patterns";
import { suggestAdjustment, type AdaptiveSettings } from "@/lib/engine/adjustment";
import { applyAdjustmentToSettings, getInsulinSettings } from "@/lib/userSettings";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import EngineLogTab, { InsulinForm, ExerciseForm } from "@/components/EngineLogTab";
import FingerstickLogCard from "@/components/FingerstickLogCard";
import { CycleForm, SymptomForm } from "@/components/CycleSymptomForms";
import GlevLogo from "@/components/GlevLogo";
import EngineChatPanel, { type SeedMessage } from "@/components/EngineChatPanel";
import { useEngineHeader } from "@/lib/engineHeaderContext";
import { fetchLatestCgm } from "@/components/CgmFetchButton";
import { classifyPreReferenceTrend, type TrendClass, type TrendSample } from "@/lib/engine/trend";
import { fetchLatestFingerstick, FS_OVERRIDE_WINDOW_MS } from "@/lib/fingerstick";
import { parseDbTs, parseDbDate, parseLluTs } from "@/lib/time";

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
): Recommendation {
  const cf = 50, target = 110;
  const carbDose = carbs / icr;
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
  const safetyNotes = safetyNotesFromLogs(insulinLogs, exerciseLogs, t, fmt);

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
      icr,
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
  const bcp47 = localeToBcp47(useLocale());
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
  const [tab, setTab]         = useState<"engine"|"log"|"bolus"|"exercise"|"fingerstick"|"cycle"|"symptoms">("engine");
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
    if (t === "log" || t === "bolus" || t === "exercise" || t === "fingerstick" || t === "engine" || t === "cycle" || t === "symptoms") {
      setTab(t);
    }
  }, [searchParams]);
  const [isMobile, setIsMobile] = useState(false);
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [adaptedICR, setAdaptedICR] = useState(15);
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
  // Tabs-expanded state lives in the global EngineHeaderContext so the
  // chevron control can render in the mobile app header (oben rechts
  // next to Live + user icon) instead of inside this page body. We
  // alias the hook return value to keep the rest of the page readable.
  const engineHdr = useEngineHeader();
  const tabsExpanded    = engineHdr.tabsExpanded;
  const setTabsExpanded = engineHdr.setTabsExpanded;
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
  const [speechAvail, setSpeechAvail] = useState(true);
  const mediaRecRef    = useRef<MediaRecorder | null>(null);
  const recordingStopTsRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  async function startRecording() {
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
        body: JSON.stringify({ text }),
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
      if (Array.isArray(pData.items)) {
        setParsedItems(pData.items.filter((it: unknown) => it && typeof it === "object"));
      } else {
        setParsedItems([]);
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
      // Hand the parsed result to the chat panel so the user sees what the AI
      // captured and can immediately push back ("the banana was bigger") in
      // the same conversation thread.
      const chatLines: string[] = [];
      const descLine = typeof pData.description === "string" && pData.description.trim()
        ? pData.description.trim()
        : text;
      chatLines.push(`Got it: ${descLine}`);
      const macroBits: string[] = [];
      if (t.carbs   != null) macroBits.push(`${t.carbs}g carbs`);
      if (t.protein != null) macroBits.push(`${t.protein}g protein`);
      if (t.fat     != null) macroBits.push(`${t.fat}g fat`);
      if (t.fiber   != null) macroBits.push(`${t.fiber}g fiber`);
      if (macroBits.length) chatLines.push(`Macros: ${macroBits.join(" · ")}.`);
      chatLines.push(`Tell me if anything's off — I'll update the form on the left.`);
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
      // No auto-advance: the user explicitly asked to stay on Step 1 after
      // the parse so they can read the chat, push back on the AI, or tweak
      // the form before committing. Step 1 → Step 2 is now driven by the
      // explicit "Weiter zu Makros prüfen →" button rendered below the chat.
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] FAILED after:", Date.now() - tStop, "ms");
      // FIX B: Map cryptic native messages to actionable German hints so the
      // user knows what to try next. Anything we don't recognise still shows
      // the raw message rather than a useless generic fallback.
      const raw = e instanceof Error ? e.message : "";
      const friendly =
        /empty transcript/i.test(raw)              ? "Keine Sprache erkannt — bitte deutlicher sprechen oder den Chat unten benutzen." :
        /permission denied|not allowed/i.test(raw) ? "Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben." :
        /failed to fetch|networkerror/i.test(raw)  ? "Verbindung fehlgeschlagen — bitte erneut versuchen." :
        raw                                         ? raw :
                                                      "Sprach-Verarbeitung fehlgeschlagen.";
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
  }, []);

  function handleRun() {
    // carbs input lives in the user's chosen unit (g/BE/KE); engine
    // operates in grams, so convert at the boundary.
    const g = parseFloat(glucose)||110, c = carbUnit.toGrams(parseFloat(carbs)||0);
    if (!c) return;
    setRunning(true);
    // Pre-Meal-Trend (Task #195): Frische Samples ziehen und gegen die
    // jeweils aktive `mealTime` klassifizieren — sonst würde ein älterer,
    // beim Mount berechneter Trend stehen bleiben, auch wenn der User
    // die Mahlzeitzeit verschoben oder lange auf der Seite gewartet hat.
    const refMs = mealTime ? Date.parse(mealTime) || Date.now() : Date.now();
    refreshTrendSamples().then(samples => {
      const trend = getPreTrendForRef(refMs, samples);
      setTimeout(() => {
        const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, adaptedICR, tEngineFn, formatNum, trend);
        setResult(rec);
        setRunning(false);
      // Wizard auto-advance: bump from Step 2 ("Makros prüfen") to Step 3
      // ("Ergebnis") so the recommendation appears the moment the calc
      // completes. Functional guard prevents jumping if user navigated
      // away during the 600ms cosmetic delay.
      setStepIndex(prev => prev === 1 ? 2 : prev);
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
    const cls   = aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum);
    const cal   = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
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
      });
      // Schedule CGM auto-fetches at +1h / +2h after meal time. Fire-and-forget;
      // failures (e.g. no CGM connected) are silent.
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      // Refresh meals so the next recommendation immediately benefits.
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.WIZARD_SAVE", { id: saved.id, carbs: cNum, insulin: result.dose, glucose: gNum, mealType: cls });
      // FIX A: Hold on Step 3 with a green confirmation. No auto-reset, no
      // auto-navigate — the user explicitly clicks "Neues Essen" below to
      // clear the form and return to Step 1. This avoids the surprise of
      // the screen jumping away the moment they hit Save.
      setWizardSavedDose(result.dose);
    } catch (e) {
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
    const cls   = aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum);
    const cal   = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
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
      });
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.SAVE_NO_BOLUS", { id: saved.id, carbs: cNum, glucose: gNum, mealType: cls });
      // Same post-save state as handleWizardSave so both paths converge
      // on the identical "✓ Gespeichert — N IE geloggt" confirmation.
      setWizardSavedDose(0);
    } catch (e) {
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
    const cls = aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum);
    const cal = computeCalories(cNum, pNum, fNum);
    const mealIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
    setConfirming(true);
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
      });
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      fetchMealsForEngine().then(setMeals).catch(() => {});
      logDebug("ENGINE.SAVE_DIRECT_BOLUS", { id: saved.id, carbs: cNum, glucose: gNum, mealType: cls, insulinUnits: iNum });
      setWizardSavedDose(iNum);
    } catch (e) {
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
    const cls   = aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum);
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
      // Schedule CGM auto-fetches at +1h / +2h after meal time. Fire-and-forget;
      // failures (e.g. no CGM connected) are silent.
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      // Refresh meals so the next recommendation immediately benefits.
      fetchMealsForEngine().then(setMeals).catch(() => {});
    } catch (e) {
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
    setDesc(""); setInsulin(""); setResult(null); setTranscript("");
    setAiMealType(null);
    setNutritionSource(null);
    setParsedItems([]);
    setMealTime(nowLocalDateTime());
    setConfirmErr("");
    setConfirmedMeal(null);
    setDecisionMode("decision");
    setDecisionRec(null);
    // Clear busy flag so the next decision panel (after the next Confirm Log)
    // starts with enabled buttons. Toast is intentionally NOT cleared — its
    // own setTimeout dismisses it independently.
    setDecisionBusy(false);
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
        const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, adaptedICR, tEngineFn, formatNum, trend);
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
        // On desktop the wrapper sits inside a sticky <aside> with a
        // fixed viewport-derived height — `height: 100%` lets the
        // EngineChatPanel's own `height: 100%` desktop branch fill
        // that available space. On mobile the panel sets its own
        // `100svh - 340px` calc, so we leave the wrapper as auto to
        // avoid collapsing inside the Step 1 flex column.
        height: isMobile ? "auto" : "100%",
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
    <div style={{ maxWidth: 1100, margin:"0 auto" }}>
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
        const tabsCfg = [
          { id:"engine"      as const, label: tEngine("tab_engine") },
          { id:"bolus"       as const, label: tEngine("tab_insulin") },
          { id:"exercise"    as const, label: tEngine("tab_exercise") },
          { id:"fingerstick" as const, label: tEngine("tab_glucose") },
          { id:"cycle"       as const, label: tEngine("tab_cycle") },
          { id:"symptoms"    as const, label: tEngine("tab_symptoms") },
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
                      fontSize:13, fontWeight: on ? 600 : 500,
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

      {tab === "engine" && (
        <div
          style={
            isMobile
              ? { maxWidth: 720, margin: "0 auto" }
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
                }
          }
        >
          <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", minWidth: 0 }}>
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
              <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--text-secondary, #4b5563)" }}>
                {tInsights(
                  currentAdjustment.suggestion.message.key as Parameters<typeof tInsights>[0],
                  currentAdjustment.suggestion.message.params,
                )}
              </div>
              {adjustmentErr && (
                <div role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>{adjustmentErr}</div>
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
                    fontSize: 13,
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
                    fontSize: 13,
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
            @keyframes engVPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
            @keyframes engSpin   { to { transform: rotate(360deg) } }
            /* Wizard step pills — base size for mobile, larger on desktop.
               Sizing lives in CSS (not the inline style object) so we can
               respond to viewport without an isMobile state hook. The 768px
               threshold matches Layout.tsx's sidebar breakpoint (which uses
               max-width:768px for the mobile rail). The "min-width:769px"
               desktop query is the strict complement of Layout's
               "max-width:768px" rule (no gap, no overlap at the 768/769
               boundary). Values (12px / 14px font, 8px-22px horizontal
               padding) are inherited from the previous /log wizard's
               .wizard-pill CSS — /log itself is now a redirect to /engine,
               so this is the canonical home of the pattern going forward. */
            .wizard-pill { font-size: 12px; padding: 8px 12px; }
            @media (min-width: 769px) {
              .wizard-pill { font-size: 14px; padding: 10px 22px; }
            }
          `}</style>

          {/* PILL TABS — display-only step indicator. They surface
              progress through the wizard; navigation happens exclusively
              via the per-step Weiter/Zurück buttons rendered inside each
              step body below. Active pill: filled with ACCENT. Inactive:
              transparent background with a translucent ACCENT55 border and
              ACCENTcc text (alpha-tinted on purpose so the inactive state
              recedes visually from the active fill). Replaces the previous
              numbered-circles + connector + label-row indicator. Pattern
              and styling were lifted from the historical /log wizard
              (commit 5fc7970, before /log became a redirect) so /engine
              now owns the canonical pill-tab vocabulary. Uses role="list"
              / role="listitem" + aria-current="step" rather than
              tab/tablist because the pills are intentionally not keyboard-
              interactive — list semantics are honest about that. */}
          <div role="list" aria-label={tEngine("wizard_steps")} style={{
            display: "flex", gap: 8, padding: "4px 0", marginBottom: 28,
          }}>
            {(["step_label_food", "step_label_macros", "step_label_result"] as const).map((key, i) => {
              const active = i === stepIndex;
              return (
                <div
                  key={key}
                  role="listitem"
                  aria-current={active ? "step" : undefined}
                  className="wizard-pill"
                  style={{
                    flex: "1 1 0",
                    borderRadius: 99,
                    border: `1px solid ${active ? ACCENT : `${ACCENT}55`}`,
                    background: active ? ACCENT : "transparent",
                    color: active ? "#fff" : `${ACCENT}cc`,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textAlign: "center",
                    userSelect: "none",
                  }}
                >
                  <span style={{ opacity: 0.7, marginRight: 6 }}>{i + 1}</span>
                  {tEngine(key)}
                </div>
              );
            })}
          </div>

          {/* Page-level success toast (post-save) and error banner. Rendered
              above the active step so they're visible regardless of current step. */}
          {decisionToast && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: `${GREEN}15`, border: `1px solid ${GREEN}40`, color: GREEN, fontSize: 12 }}>
              {decisionToast}
            </div>
          )}
          {confirmErr && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: `${PINK}15`, border: `1px solid ${PINK}40`, color: PINK, fontSize: 12 }}>
              {confirmErr}
            </div>
          )}

          {/* ───────── STEP 1: Pill-FAB Mikrofon + AI Chat-Panel.
              Voice path: tap mic → record → handleVoice → /api/parse-food
              → fields fill → auto-advance to Step 2.
              Chat path: user types into EngineChatPanel → /api/chat-macros
              → AI replies in the message thread → onPatch fills the form
              → if macros come back populated, auto-advance to Step 2.
              Both inputs are visible without scrolling so the user can
              choose freely between speaking or chatting. ───────── */}
          {stepIndex === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "24px 0 8px" }}>
              {/* Sprechen / Voice-input button. Now styled as a dark
                  pill carrying the brand-mark icon (Glev hexagon) instead
                  of a generic mic glyph, so the primary call-to-action on
                  Step 1 is unmistakably "Glev listening" rather than just
                  "another mic". When the recording flag flips on, an
                  ACCENT halo + pulsing outer glow radiate into the dark
                  page background to give the user unambiguous "yes, we
                  are listening" feedback even from a glance. */}
              <style>{`
                @keyframes engRecHalo {
                  0%,100% { box-shadow: 0 0 0 1px ${ACCENT}66, 0 0 22px ${ACCENT}55, 0 0 48px ${ACCENT}22; }
                  50%     { box-shadow: 0 0 0 1px ${ACCENT}cc, 0 0 36px ${ACCENT}aa, 0 0 80px ${ACCENT}44; }
                }
              `}</style>
              <button
                type="button"
                onClick={() => recording ? stopRecording() : startRecording()}
                disabled={parsing || !speechAvail}
                aria-label={recording ? tEngine("voice_aria_stop") : tEngine("voice_aria_start")}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
                  width: "100%", maxWidth: 280, height: 56, borderRadius: 28,
                  background: recording ? `${ACCENT}1f` : SURFACE,
                  border: `1px solid ${recording ? ACCENT : `${ACCENT}55`}`,
                  color:"var(--text)",
                  fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                  cursor: parsing || !speechAvail ? "not-allowed" : "pointer",
                  animation: recording ? "engRecHalo 1.4s ease-in-out infinite" : undefined,
                  boxShadow: recording ? undefined : `0 0 0 1px ${ACCENT}22`,
                  opacity: parsing || !speechAvail ? 0.55 : 1,
                  transition: "background 0.2s, border-color 0.2s, opacity 0.2s",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {/* Glev brand mark — same component used in the nav,
                    rendered in ACCENT so it reads as "Glev is listening"
                    on the dark pill. Drop-shadow glow strengthens while
                    the recording flag is on for additional feedback
                    beyond the outer halo animation. */}
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    filter: `drop-shadow(0 0 ${recording ? 8 : 4}px ${ACCENT}${recording ? "cc" : "55"})`,
                    transition: "filter 0.25s",
                  }}
                >
                  <GlevLogo size={22} color={ACCENT} bg="transparent"/>
                </span>
                {recording ? tEngine("voice_btn_stop") : parsing ? tEngine("voice_btn_processing") : tEngine("voice_btn_speak")}
              </button>
              {voiceErr && (
                <div style={{ fontSize: 11, color: PINK, textAlign: "center", maxWidth: 360 }}>{voiceErr}</div>
              )}
              {/* FIX B: Explain WHY the Sprechen button is disabled when the
                  browser doesn't expose MediaRecorder + getUserMedia (iOS
                  Safari < 14.5, embedded webviews, http://). Without this
                  hint the button just appears greyed out with no recourse,
                  and users don't realise they can fall back to the chat. */}
              {!speechAvail && !voiceErr && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", maxWidth: 360, lineHeight: 1.4 }}>
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
            <div style={{ ...card, padding: 24 }}>
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
            <div style={{ ...card, padding: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 20, color:"var(--text)" }}>
                {tEngine("step_title_macros")}
              </h2>

              {/* Section header: Makros — 2x2 grid (Carbs+Fiber, Protein+Fat) */}
              <div style={{ marginBottom: 24 }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, marginBottom: 12,
                }}>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
                    {tEngine("macros_section")}
                  </div>
                  {/* Provenance badge: shows whether the macros currently in the
                      form came from the verified Open Food Facts + USDA databases
                      (green), a mix of DB + AI estimates (orange), or pure AI
                      estimation when both DB lookups failed (pink). Hidden when
                      no source has been recorded (manual-entry-only path). */}
                  {nutritionSource && (() => {
                    // Palette severity: green (DB), orange (mixed), pink
                    // (full GPT estimate), and a stronger red+pulse for
                    // 'unknown' — when the pipeline couldn't price even one
                    // ingredient, the user must see a hard warning before
                    // dosing. Red is reserved for this case alone.
                    const palette = nutritionSource === "database"
                      ? { bg: "#22D3A015", border: "#22D3A040", color: "#22D3A0" }
                      : nutritionSource === "mixed"
                        ? { bg: "#FF950015", border: "#FF950040", color: "#FF9500" }
                        : nutritionSource === "estimated"
                          ? { bg: "#FF2D7815", border: "#FF2D7840", color: "#FF2D78" }
                          : { bg: "#FF2D2D22", border: "#FF2D2D80", color: "#FF6B6B" };
                    const label = tEngine(`nutrition_source_${nutritionSource}`);
                    const tip   = tEngine(`nutrition_source_explain_${nutritionSource}`);
                    return (
                      <div
                        title={tip}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 99,
                          background: palette.bg,
                          border: `1px solid ${palette.border}`,
                          color: palette.color,
                          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: palette.color,
                          boxShadow: `0 0 6px ${palette.color}`,
                        }}/>
                        {tEngine("nutrition_source_label")}: {label}
                      </div>
                    );
                  })()}
                </div>
                {/* Macro grid — auto-fit collapses 4 fields to 2 cols on
                    desktop, 1 col on narrow phones. minmax(180px, 1fr) keeps
                    placeholder + opt. labels readable without forcing a fixed
                    2-col that wraps awkwardly on tablets. Mirrors /log's
                    macro-grid pattern. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, rowGap: 14 }}>
                  <div>
                    {/* Label and placeholder swap with the user's chosen
                        unit (g/BE/KE). step=0.1 for BE/KE so users can
                        enter typical 0.5/1/1.5 BE values. */}
                    <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>{tEngine("carbs_label")} ({carbUnit.label})</label>
                    <input style={inp} type="number" inputMode="decimal" step={carbUnit.step} placeholder={carbUnit.placeholder} value={carbs} onChange={(e) => setCarbs(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      {tEngine("fiber_label")} <span style={{ textTransform: "none", color: "var(--text-faint)", fontSize: 10, fontWeight: 500 }}>{tEngine("optional_short")}</span>
                    </label>
                    <input style={inp} type="number" placeholder={tEngine("placeholder_fiber")} value={fiber} onChange={(e) => setFiber(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>{tEngine("protein_label")}</label>
                    <input style={inp} type="number" placeholder={tEngine("placeholder_protein")} value={protein} onChange={(e) => setProtein(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>{tEngine("fat_label")}</label>
                    <input style={inp} type="number" placeholder={tEngine("placeholder_fat")} value={fat} onChange={(e) => setFat(e.target.value)}/>
                  </div>
                </div>
              </div>

              {/* Section header: Glukose & Zeit — glucose + CGM pull pill, meal time */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
                  {tEngine("glucose_time_section")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                      <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span>{tEngine("glucose_before_label")}{lastReading ? ` · ${tEngine("glucose_last_prefix")}: ${lastReading}` : ""}</span>
                        {currentTrend ? <TrendArrow trend={currentTrend} t={tEngine}/> : null}
                      </label>
                      <button onClick={handlePullCgm} disabled={cgmPulling} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 10px", borderRadius: 99, border: `1px solid ${ACCENT}40`,
                        background: `${ACCENT}15`, color: ACCENT, fontSize: 11, fontWeight: 600,
                        cursor: cgmPulling ? "wait" : "pointer", flexShrink: 0,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}/>
                        {cgmPulling ? tEngine("cgm_pulling") : tEngine("cgm_button")}
                      </button>
                    </div>
                    <input style={inp} type="number" placeholder={tEngine("placeholder_glucose")} value={glucose} onChange={(e) => setGlucose(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      {tEngine("meal_time_label")}
                    </label>
                    <input
                      style={{ ...inp, fontFamily: "inherit", textAlign: "center" }}
                      type="datetime-local"
                      value={mealTime}
                      onChange={(e) => setMealTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Three-path action row, visually tiered:
                    1. PRIMARY  — "Speichern (ohne Bolus)" full-width
                       accent button. Commits insulin_units = 0; lands
                       in the green Step-2 success state.
                    2. SECONDARY — "Bolus berechnen →" outline button.
                       Always clickable (only disabled while another
                       action is in flight); never carbs-gated since
                       greying it out makes it feel unavailable. Runs
                       the engine and advances to Step 3.
                    3. TERTIARY — "Bolus direkt eingeben" link-style.
                       For experienced users who know their dose; toggles
                       a tiny inline number input + "Speichern mit X IE"
                       which commits with the typed dose and lands in the
                       same green success state.
                    4. "← Zurück" stays at the bottom for back-nav.
                  All three save paths converge on the identical
                  wizardSavedDose / "✓ Gespeichert — N IE" confirm. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* PRIMARY ────────────────────────────────────────── */}
                <button
                  onClick={handleSaveWithoutBolus}
                  disabled={confirming || running}
                  style={{
                    width: "100%", height: 52, borderRadius: 12, border: "none",
                    background: confirming ? "rgba(79,110,247,0.4)" : ACCENT,
                    color:"var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                    cursor: confirming ? "wait" : "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  {confirming ? tEngine("btn_saving") : tEngine("btn_save_without_bolus")}
                </button>

                {/* SECONDARY ──────────────────────────────────────── */}
                {(() => {
                  // Only blocked by transient busy states; never by
                  // carbs == 0 — the user explicitly asked for this
                  // button to always look clickable.
                  const blocked = running || confirming;
                  return (
                    <button
                      onClick={handleRun}
                      disabled={blocked}
                      style={{
                        width: "100%", height: 48, borderRadius: 10,
                        border: `1px solid ${ACCENT}60`,
                        background: "transparent",
                        color: ACCENT,
                        fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
                        cursor: blocked ? "wait" : "pointer",
                        opacity: blocked ? 0.7 : 1,
                        transition: "all 0.2s",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}
                    >
                      {running && (
                        <span style={{
                          display: "inline-block", width: 14, height: 14,
                          border: `2px solid ${ACCENT}40`, borderTopColor: ACCENT,
                          borderRadius: "50%", animation: "engSpin 0.7s linear infinite",
                        }}/>
                      )}
                      {running ? tEngine("btn_calculating") : tEngine("btn_calculate_bolus")}
                    </button>
                  );
                })()}

                {/* TERTIARY ───────────────────────────────────────── */}
                {!directBolusOpen ? (
                  <button
                    type="button"
                    onClick={() => setDirectBolusOpen(true)}
                    disabled={running || confirming}
                    style={{
                      width: "100%", height: 32, borderRadius: 6,
                      border: "none", background: "transparent",
                      color: "var(--text-muted)",
                      fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em",
                      cursor: running || confirming ? "not-allowed" : "pointer",
                      textDecoration: "underline", textUnderlineOffset: 3,
                      textDecorationColor: "var(--text-ghost)",
                    }}
                  >
                    {tEngine("btn_direct_bolus_open")}
                  </button>
                ) : (
                  <div
                    style={{
                      display: "flex", flexDirection: "column", gap: 8,
                      padding: 12, borderRadius: 10,
                      background: "rgba(79,110,247,0.05)",
                      border: `1px solid ${ACCENT}30`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT, letterSpacing: "-0.01em" }}>
                        {tEngine("direct_bolus_label")}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setDirectBolusOpen(false); setDirectBolusValue(""); setConfirmErr(""); }}
                        disabled={confirming}
                        aria-label={tEngine("cancel_aria")}
                        style={{
                          background: "transparent", border: "none",
                          color: "var(--text-dim)", fontSize: 18,
                          lineHeight: 1, cursor: confirming ? "not-allowed" : "pointer",
                          padding: "0 4px",
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <div style={{ position: "relative", flex: "0 0 110px" }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          value={directBolusValue}
                          onChange={(e) => setDirectBolusValue(e.target.value)}
                          placeholder="0"
                          disabled={confirming}
                          autoFocus
                          style={{
                            width: "100%", height: 44,
                            background: "var(--input-bg)",
                            border: `1px solid ${BORDER}`,
                            borderRadius: 10,
                            padding: "0 36px 0 12px",
                            color:"var(--text)", fontSize: 16, fontWeight: 700,
                            outline: "none", textAlign: "right",
                          }}
                        />
                        <span style={{
                          position: "absolute", right: 12, top: "50%",
                          transform: "translateY(-50%)",
                          color: "var(--text-dim)", fontSize: 12, fontWeight: 600,
                          pointerEvents: "none",
                        }}>
                          {tEngine("units_short")}
                        </span>
                      </div>
                      {(() => {
                        const iNum = parseFloat(directBolusValue);
                        const valid = Number.isFinite(iNum) && iNum >= 0;
                        const blocked = confirming || running || !valid;
                        return (
                          <button
                            type="button"
                            onClick={handleSaveWithDirectBolus}
                            disabled={blocked}
                            style={{
                              flex: 1, height: 44, borderRadius: 10,
                              border: "none",
                              background: confirming
                                ? "rgba(79,110,247,0.4)"
                                : valid ? ACCENT : "rgba(79,110,247,0.25)",
                              color:"var(--text)",
                              fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
                              cursor: blocked ? (confirming ? "wait" : "not-allowed") : "pointer",
                              transition: "background 0.2s",
                            }}
                          >
                            {confirming
                              ? tEngine("btn_saving")
                              : valid
                                ? tEngine("btn_save_with_dose", { dose: iNum, units: tEngine("units_short") })
                                : tEngine("btn_save")}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* BACK ───────────────────────────────────────────── */}
                <button
                  onClick={() => setStepIndex(0)}
                  disabled={running || confirming}
                  style={{
                    width: "100%", height: 36, borderRadius: 8,
                    border: "none", background: "transparent",
                    color: "var(--text-faint)", fontSize: 13, fontWeight: 500,
                    cursor: running || confirming ? "not-allowed" : "pointer",
                  }}
                >
                  {tEngine("btn_back")}
                </button>
              </div>
            </div>
          )}

          {/* ───────── STEP 3: Deine Empfehlung ───────── */}
          {stepIndex === 2 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 16, color:"var(--text)" }}>
                {tEngine("step_title_result")}
              </h2>

              {!result ? (
                // Defensive: should not happen because handleRun gates the
                // transition on a successful calc, but if state was lost
                // (e.g. tab switch + reset) give the user a clean way back.
                <div style={{ ...card, padding: 20, marginBottom: 16 }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                    {tEngine("no_estimate_body")}
                  </div>
                  <button
                    onClick={() => setStepIndex(1)}
                    style={{
                      padding: "10px 18px", borderRadius: 10,
                      border: `1px solid ${BORDER}`, background: "transparent",
                      color:"var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    {tEngine("btn_back")}
                  </button>
                </div>
              ) : (
                <>
                  {/* Result card — dose front-and-center, 32px bold white,
                      confidence chip + ICR ratio underneath. */}
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 16, padding: 20, marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                      {tEngine("recommended_dose_label")}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 14 }}>
                      <span style={{ fontSize: 32, fontWeight: 800, color:"var(--text)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                        {formatNum(result.dose, 1)}
                      </span>
                      <span style={{ fontSize: 14, color: "var(--text-dim)", fontWeight: 600 }}>{tEngine("units_short")}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                      {/* ICR display in the user's chosen unit. displayICR
                          returns the full formatted string with units
                          baked in (e.g. "24 g KH/IE", "2 BE/IE", "2.4
                          KE/IE") so we drop the legacy "1:" prefix —
                          the unit suffix already conveys the ratio. */}
                      <span style={{ color: "var(--text-muted)" }}>{tEngine("icr_label")}: {carbUnit.displayICR(adaptedICR)}</span>
                      <span style={{
                        padding: "2px 10px", borderRadius: 99,
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                        background: `${CONF_COLOR[result.confidence]}22`,
                        color: CONF_COLOR[result.confidence],
                        border: `1px solid ${CONF_COLOR[result.confidence]}40`,
                      }}>
                        {result.confidence}
                      </span>
                      <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
                        {result.source === "historical" ? tEngine("source_historical") : result.source === "blended" ? tEngine("source_blended") : tEngine("source_formula")}
                      </span>
                    </div>
                    {/* ICR source breakdown — tells the user how many of
                        the meals feeding the adaptive ICR took insulin
                        from a paired bolus log vs. the legacy
                        meal.insulin_units column. Only shown once we
                        actually have contributing meals. */}
                    {icrSampleSize > 0 && (
                      <div
                        title={tEngine("icr_source_tooltip")}
                        style={{
                          marginTop: 8, fontSize: 11,
                          color: "var(--text-faint)", lineHeight: 1.4,
                        }}
                      >
                        {tEngine("icr_source", {
                          explicit:    icrPairedExplicitCount,
                          timeWindow:  icrPairedTimeWindowCount,
                          mealColumn:  Math.max(0, icrSampleSize - icrPairedCount),
                          total:       icrSampleSize,
                        })}
                      </div>
                    )}
                  </div>

                  {/* Collapsible GPT reasoning — chevron toggles the body. */}
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 12, marginBottom: 14, overflow: "hidden",
                  }}>
                    <button
                      onClick={() => setReasoningExpanded(v => !v)}
                      aria-expanded={reasoningExpanded}
                      aria-controls="gpt-reasoning-body"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "12px 16px",
                        background: "transparent", border: "none", cursor: "pointer",
                        color: "var(--text-faint)", fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                      }}
                    >
                      <span>{tEngine("gpt_reasoning_title")}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        style={{ transition: "transform 0.2s", transform: reasoningExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    {reasoningExpanded && (
                      <div id="gpt-reasoning-body" style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.6, color: "var(--text-body)" }}>
                        {renderReasoning(result.reasoning, result.safetyNotes, tEngineFn, formatNum)}
                      </div>
                    )}
                  </div>

                  {/* Meal summary line — shows what the user is about to save. */}
                  <div style={{ marginBottom: 18, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, padding: "0 4px" }}>
                    {/* Meal summary line: render carbs in the user's unit
                        with the matching short label (g / BE / KE). */}
                    {(desc.trim() || transcript.trim() || tEngine("meal_fallback"))} · {parseFloat(carbs) ? carbUnit.display(carbUnit.toGrams(parseFloat(carbs))) : `0 ${carbUnit.label}`}
                  </div>

                  {/* FIX A: Pre-save → show Save + Back. Post-save →
                      hide both, show green confirmation + "Neues Essen"
                      reset button. The user must explicitly opt in to
                      starting a new meal — the save no longer surprises
                      them by jumping away from this screen. */}
                  {wizardSavedDose === null ? (
                    <>
                      <button
                        onClick={handleWizardSave}
                        disabled={confirming}
                        style={{
                          width: "100%", height: 52, borderRadius: 12, border: "none",
                          background: confirming ? "rgba(79,110,247,0.4)" : ACCENT,
                          color:"var(--text)", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                          cursor: confirming ? "wait" : "pointer",
                          marginBottom: 8,
                          transition: "background 0.2s",
                        }}
                      >
                        {confirming ? tEngine("btn_saving") : tEngine("btn_confirm_save")}
                      </button>
                      <button
                        onClick={() => setStepIndex(1)}
                        disabled={confirming}
                        style={{
                          width: "100%", height: 36, borderRadius: 8,
                          border: "none", background: "transparent",
                          color: "var(--text-faint)", fontSize: 13, fontWeight: 500,
                          cursor: confirming ? "not-allowed" : "pointer",
                        }}
                      >
                        {tEngine("btn_adjust_again")}
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          width: "100%", padding: "14px 18px",
                          borderRadius: 12,
                          background: `${GREEN}12`,
                          border: `1px solid ${GREEN}40`,
                          color: GREEN,
                          fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
                          textAlign: "center",
                          marginBottom: 10,
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
                    </>
                  )}

                  {/* Important medical disclaimer — same wording as the legacy result panel. */}
                  <div style={{ marginTop: 24, padding: "14px 18px", background: "var(--surface-soft)", borderRadius: 12, border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.6 }}>
                      <strong style={{ color: "var(--text-dim)" }}>{tEngine("disclaimer_label")}</strong> {tEngine("disclaimer_body")}
                    </div>
                  </div>
                </>
              )}
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

              {tab === "log"         && <EngineLogTab />}
      {tab === "bolus"       && <InsulinForm />}
      {tab === "exercise"    && <ExerciseForm />}
      {tab === "fingerstick" && <FingerstickLogCard />}
      {tab === "cycle"       && <CycleForm />}
      {tab === "symptoms"    && <SymptomForm />}
    </div>
  );
}
