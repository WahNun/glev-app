"use client";

import { useState, useEffect, useRef } from "react";
import { fetchMeals, classifyMeal, computeCalories, saveMeal, deleteMeal, updateMeal, type Meal } from "@/lib/meals";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { logDebug } from "@/lib/debug";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import { computeAdaptiveICR } from "@/lib/engine/adaptiveICR";
import EngineLogTab, { InsulinForm, ExerciseForm } from "@/components/EngineLogTab";
import FingerstickLogCard from "@/components/FingerstickLogCard";
import GlevLogo from "@/components/GlevLogo";
import EngineChatPanel, { type SeedMessage } from "@/components/EngineChatPanel";
import { useEngineHeader } from "@/lib/engineHeaderContext";
import { fetchLatestCgm } from "@/components/CgmFetchButton";
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
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

interface Recommendation {
  dose: number;
  confidence: "HIGH"|"MEDIUM"|"LOW";
  source: string;
  reasoning: string;
  carbDose: number;
  correctionDose: number;
  similarMeals: Meal[];
}

/**
 * Append safety / context notes derived from recent insulin & exercise logs.
 * Pure documentation — does not change the dose.
 *  - Basal logged in the last 24h is mentioned for context.
 *  - More than 2 boluses in the last 6h triggers a stacking-risk warning.
 *  - Exercise (cardio or any high-intensity) in the last 4h is flagged.
 */
function safetyNotesFromLogs(
  insulinLogs: InsulinLog[],
  exerciseLogs: ExerciseLog[],
): string[] {
  const now = Date.now();
  const sixHoursAgo  = now - 6  * 3600_000;
  const fourHoursAgo = now - 4  * 3600_000;
  const dayAgo       = now - 24 * 3600_000;
  const notes: string[] = [];

  const recentBolus = insulinLogs.filter(l =>
    l.insulin_type === "bolus" && parseDbTs(l.created_at) >= sixHoursAgo,
  );
  if (recentBolus.length > 2) {
    const total = Math.round(recentBolus.reduce((s, l) => s + (l.units || 0), 0) * 10) / 10;
    notes.push(`⚠ Stacking-Risiko: ${recentBolus.length} Bolus-Gaben in den letzten 6h (Σ ${total}u). Aktives Insulin könnte sich überlagern — vorsichtig dosieren.`);
  }

  const recentBasal = insulinLogs.filter(l =>
    l.insulin_type === "basal" && parseDbTs(l.created_at) >= dayAgo,
  );
  if (recentBasal.length > 0) {
    const last = recentBasal[0];
    const hoursAgo = Math.max(0, Math.round((now - parseDbTs(last.created_at)) / 3600_000));
    notes.push(`Basal-Kontext: zuletzt ${last.units}u ${last.insulin_name || "Basal"} vor ${hoursAgo}h.`);
  }

  const recentExercise = exerciseLogs.filter(l =>
    parseDbTs(l.created_at) >= fourHoursAgo,
  );
  if (recentExercise.length > 0) {
    const e = recentExercise[0];
    notes.push(`Bewegung: ${e.duration_minutes} min ${e.exercise_type} (${e.intensity}) in den letzten 4h — erhöhte Insulin-Empfindlichkeit möglich.`);
  }

  return notes;
}

function runGlevEngine(
  meals: Meal[],
  currentGlucose: number,
  carbs: number,
  insulinLogs: InsulinLog[] = [],
  exerciseLogs: ExerciseLog[] = [],
  icr: number = 15,
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

  const safetyNotes = safetyNotesFromLogs(insulinLogs, exerciseLogs);
  const safetySuffix = safetyNotes.length > 0 ? " " + safetyNotes.join(" ") : "";

  if (similar.length >= 3) {
    const avg = Math.round(similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length * 10)/10;
    return {
      dose: avg, confidence:"HIGH", source:"historical",
      reasoning: `Based on ${similar.length} similar past meals with GOOD outcomes (±12g carbs, ±35 mg/dL glucose). Historical average insulin: ${avg}u.${safetySuffix}`,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar.slice(0,5),
    };
  }

  if (similar.length >= 1) {
    const histAvg = similar.reduce((s,m)=>s+(m.insulin_units||0),0)/similar.length;
    const blended = Math.round(((histAvg + formulaDose)/2)*10)/10;
    return {
      dose: blended, confidence:"MEDIUM", source:"blended",
      reasoning: `Blended from ${similar.length} similar meal(s) + ICR formula. Limited historical data — log more meals for higher confidence.${safetySuffix}`,
      carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
      similarMeals: similar,
    };
  }

  return {
    dose: formulaDose, confidence:"LOW", source:"formula",
    reasoning: `No similar historical meals found. Using standard ICR formula: ${carbs}g ÷ ${icr} + ${Math.round(correctionDose*10)/10}u correction.${safetySuffix}`,
    carbDose:Math.round(carbDose*10)/10, correctionDose:Math.round(correctionDose*10)/10,
    similarMeals:[],
  };
}

const CONF_COLOR: Record<string, string> = { HIGH:GREEN, MEDIUM:ORANGE, LOW:PINK };

export default function EnginePage() {
  const [tab, setTab]         = useState<"engine"|"log"|"bolus"|"exercise"|"fingerstick">("engine");
  const [isMobile, setIsMobile] = useState(false);
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [adaptedICR, setAdaptedICR] = useState(15);
  const [icrConfidence, setIcrConfidence] = useState<"low" | "medium" | "high">("low");
  const [icrSampleSize, setIcrSampleSize] = useState(0);
  const [insulinLogs, setInsulinLogs] = useState<InsulinLog[]>([]);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [glucose, setGlucose] = useState("");
  const [carbs, setCarbs]     = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat]         = useState("");
  const [fiber, setFiber]     = useState("");
  const [desc, setDesc]       = useState("");
  const [result, setResult]   = useState<Recommendation|null>(null);
  const [running, setRunning] = useState(false);
  const [cgmPulling, setCgmPulling] = useState(false);
  const [lastReading, setLastReading] = useState<string>("");
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

  // Track viewport — mobile gets 3 separate tabs (Engine | Bolus | Exercise),
  // desktop keeps the 2-tab layout (Engine | Log) with both forms side-by-side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Normalize tab when crossing the mobile↔desktop breakpoint so we never
  // end up rendering nothing (e.g. tab="log" on mobile or tab="bolus" on desktop).
  useEffect(() => {
    setTab(prev => {
      if (isMobile  && prev === "log")     return "bolus";
      if (!isMobile && (prev === "bolus" || prev === "exercise")) return "log";
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
      engine:      "Engine",
      log:         "Log",
      bolus:       "Insulin",
      exercise:    "Übung",
      fingerstick: "Glukose",
    };
    engineHdr.setActiveLabel(labels[tab] ?? "Engine");
  }, [tab, engineHdr]);

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
      setVoiceErr(e instanceof Error ? e.message : "Mikrofon-Zugriff fehlgeschlagen.");
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
      if (t.carbs   != null) setCarbs(String(t.carbs));
      if (t.fiber   != null) setFiber(String(t.fiber));
      if (t.protein != null) setProtein(String(t.protein));
      if (t.fat     != null) setFat(String(t.fat));
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
      // Wizard auto-advance: if the user is still on Step 1 ("Was hast du
      // gegessen?"), bump to Step 2 ("Makros prüfen") 800 ms after the
      // macros land so they perceive "fields fill → screen swaps". The
      // functional update guards against back-jumping if the user manually
      // navigated forward during the wait, or if voice was triggered while
      // already in the macro/result step (e.g. correcting a meal).
      setTimeout(() => {
        setStepIndex(prev => prev === 0 ? 1 : prev);
      }, 800);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("[PERF voice/engine] FAILED after:", Date.now() - tStop, "ms");
      setVoiceErr(e instanceof Error ? e.message : "Sprach-Verarbeitung fehlgeschlagen.");
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
    fetchMeals()
      .then(fetched => {
        setMeals(fetched);
        // Adaptive ICR — single source of truth shared with the Insights
        // page (lib/engine/adaptiveICR.ts). Outcome-weighted average of
        // carbs/insulin across all FINALIZED meals (state==="final"):
        // GOOD weight 1.0, SPIKE 0.7, UNDER/OVERDOSE 0.3, CHECK_CONTEXT 0.5.
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
        const adaptive = computeAdaptiveICR(fetched);
        if (adaptive.global !== null && adaptive.sampleSize >= 3) {
          // Round to 1 decimal — matches Insights display precision and
          // keeps `runGlevEngine`'s `carbs / icr` math stable.
          const newICR = Math.round(adaptive.global * 10) / 10;
          setAdaptedICR(newICR);
          setIcrConfidence(adaptive.sampleSize >= 10 ? "high" : adaptive.sampleSize >= 5 ? "medium" : "low");
          setIcrSampleSize(adaptive.sampleSize);
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
    const g = parseFloat(glucose)||110, c = parseFloat(carbs)||0;
    if (!c) return;
    setRunning(true);
    setTimeout(() => {
      const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, adaptedICR);
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
      logDebug("ENGINE", { input: { glucose: g, carbs: c }, matchedMeals: rec.similarMeals.map(m => ({ id: m.id, carbs: m.carbs_grams, glucose: m.glucose_before, insulin: m.insulin_units })), suggestedDose: rec.dose, confidence: rec.confidence, recentInsulin: insulinLogs.length, recentExercise: exerciseLogs.length });
    }, 600);
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
    const cNum = parseFloat(carbs);
    if (!Number.isFinite(cNum) || cNum < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
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
        parsedJson: [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
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
      fetchMeals().then(setMeals).catch(() => {});
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
    const cNum = parseFloat(carbs);
    if (!Number.isFinite(cNum) || cNum < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
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
        parsedJson: [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
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
      fetchMeals().then(setMeals).catch(() => {});
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
    const cNum = parseFloat(carbs);
    if (!Number.isFinite(cNum) || cNum < 0) {
      setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt).");
      return;
    }
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
        parsedJson: [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
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
      fetchMeals().then(setMeals).catch(() => {});
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
    const cNum = parseFloat(carbs);
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
    if (!Number.isFinite(cNum) || cNum < 0) { setConfirmErr("Bitte Kohlenhydrate eintragen (0 ist erlaubt)."); return; }
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
        parsedJson: [{ name: desc.trim() || "meal", grams: 0, carbs: cNum, protein: pNum, fat: fNum, fiber: fbNum }],
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
      setDecisionToast(null);
      logDebug("ENGINE.CONFIRM_LOG", { id: saved.id, carbs: cNum, insulin: iNum, glucose: gNum, mealType: cls });
      // Schedule CGM auto-fetches at +1h / +2h after meal time. Fire-and-forget;
      // failures (e.g. no CGM connected) are silent.
      void scheduleJobsForLog({ logId: saved.id, logType: "meal", refTimeIso: mealIso });
      // Refresh meals so the next recommendation immediately benefits.
      fetchMeals().then(setMeals).catch(() => {});
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
    const c = confirmedMeal.carbs_grams ?? parseFloat(carbs) ?? 0;
    if (!c) { setDecisionToast("Keine Carbs hinterlegt — Empfehlung nicht möglich."); return; }
    setDecisionBusy(true);
    setTimeout(() => {
      const rec = runGlevEngine(meals, g, c, insulinLogs, exerciseLogs, adaptedICR);
      setDecisionRec(rec);
      setDecisionMode("rec");
      setDecisionBusy(false);
    }, 200);
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
      fetchMeals().then(setMeals).catch(() => {});
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
      fetchMeals().then(setMeals).catch(() => {});
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
      fetchMeals().then(setMeals).catch(() => {});
      setDecisionToast("Gespeichert ✓ — 0u Bolus");
      logDebug("ENGINE.DECISION.NO_BOLUS", { id: confirmedMeal.id });
      resetForm({ keepGlucose: true });
      setTimeout(() => setDecisionToast(null), 2500);
    } catch (e) {
      setDecisionToast(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      setDecisionBusy(false);
    }
  }

  const inp: React.CSSProperties = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"11px 14px", color:"#fff", fontSize:14, outline:"none", width:"100%" };
  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };

  return (
    <div style={{ maxWidth: isMobile || tab !== "engine" ? 800 : 1200, margin:"0 auto" }}>
      {/* The previous "Glev Engine" h1 + subtitle block was removed per
          UX request — page identification now comes from the global app
          header (logo top-left) and the tab chip (top-right chevron),
          so the chat panel can sit immediately under the header without
          wasting vertical space. Tabs are toggled via the chevron in
          the global mobile header (see Layout.tsx). On desktop where
          there is no global mobile header, we still render an in-page
          toggle so the tab strip remains reachable. */}
      {(() => {
        const tabsCfg = isMobile
          ? [
              { id:"engine"      as const, label:"Engine" },
              { id:"bolus"       as const, label:"Insulin" },
              { id:"exercise"    as const, label:"Übung" },
              { id:"fingerstick" as const, label:"Glukose" },
            ]
          : [
              { id:"engine"      as const, label:"Engine" },
              { id:"log"         as const, label:"Log" },
              { id:"fingerstick" as const, label:"Glukose" },
            ];
        const activeLabel = tabsCfg.find(t => t.id === tab)?.label ?? "Engine";
        // Mobile: the chevron lives in the global header — render only
        // the expanded tab buttons row when tabsExpanded is true, with
        // zero top margin so it sits flush below the app header.
        // Desktop: keep the in-page toggle since the desktop sidebar
        // doesn't host the chevron.
        return (
          <div style={{ marginBottom: tabsExpanded || !isMobile ? 16 : 0 }}>
            {!isMobile && (
              <button
                type="button"
                onClick={() => setTabsExpanded(!tabsExpanded)}
                aria-expanded={tabsExpanded}
                aria-controls="engine-tabs-body"
                style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  width:"100%", padding:"10px 14px",
                  background:"#0D0D12", border:`1px solid ${BORDER}`,
                  borderRadius:12, cursor:"pointer",
                  color: ACCENT, fontSize: 13, fontWeight: 700, letterSpacing:"-0.01em",
                  transition:"background 0.15s",
                }}
              >
                <span>{activeLabel}</span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ transition:"transform 0.2s", transform: tabsExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}
            {tabsExpanded && (
              <div
                id="engine-tabs-body"
                style={{
                  display:"flex", width:"100%", gap:4,
                  marginTop: isMobile ? 0 : 6,
                  background:"#0D0D12", border:`1px solid ${BORDER}`,
                  borderRadius:12, padding:4, boxSizing:"border-box",
                }}
              >
                {tabsCfg.map(t => {
                  const on = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTab(t.id); setTabsExpanded(false); }}
                      style={{
                        flex:"1 1 0", minWidth:0,
                        padding: isMobile ? "8px 6px" : "8px 18px",
                        borderRadius:8, border:"none",
                        background: on ? `${ACCENT}22` : "transparent",
                        color:    on ? ACCENT : "rgba(255,255,255,0.55)",
                        fontSize: isMobile ? 12 : 13,
                        fontWeight:700, letterSpacing:"-0.01em",
                        cursor:"pointer", transition:"all 0.15s",
                        textAlign:"center", whiteSpace:"nowrap",
                        overflow:"hidden", textOverflow:"ellipsis",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {tab === "engine" && (
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <style>{`
            @keyframes engVPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
            @keyframes engSpin   { to { transform: rotate(360deg) } }
          `}</style>

          {/* STEP INDICATOR — three dots + connectors at top, labels below.
              Active dot = ACCENT (#4F6EF7), past dots filled too, future dots
              #2A2A36 muted. Connector line between dots fills as user advances.
              Arrow buttons LEFT and RIGHT of the dots row let the user move
              between steps manually — appear from Step 2 onwards (i.e. once
              the AI macro auto-advance has fired) so Step 1 stays a clean
              "speak / chat" surface with no extra controls. Both arrows are
              always rendered (visibility:hidden when not applicable) so the
              dots never shift horizontally when the buttons appear / hide. */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              {(() => {
                const showNav = stepIndex >= 1;
                const canBack = stepIndex > 0;
                const canFwd = stepIndex < 2;
                const navBtn = (dir: "back" | "fwd") => {
                  const active =
                    showNav && (dir === "back" ? canBack : canFwd);
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        setStepIndex((prev) => {
                          if (dir === "back" && prev > 0)
                            return (prev - 1) as 0 | 1 | 2;
                          if (dir === "fwd" && prev < 2)
                            return (prev + 1) as 0 | 1 | 2;
                          return prev;
                        })
                      }
                      disabled={!active}
                      aria-label={
                        dir === "back" ? "Vorheriger Schritt" : "Nächster Schritt"
                      }
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: "transparent",
                        border: `1px solid ${
                          active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"
                        }`,
                        color: active
                          ? "rgba(255,255,255,0.75)"
                          : "rgba(255,255,255,0.18)",
                        cursor: active ? "pointer" : "default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        visibility: showNav ? "visible" : "hidden",
                        transition:
                          "color 0.15s, border-color 0.15s, background 0.15s",
                        WebkitTapHighlightColor: "transparent",
                        flexShrink: 0,
                        padding: 0,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {dir === "back" ? (
                          <polyline points="15 18 9 12 15 6" />
                        ) : (
                          <polyline points="9 18 15 12 9 6" />
                        )}
                      </svg>
                    </button>
                  );
                };
                return (
                  <>
                    {navBtn("back")}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                      role="list"
                      aria-label="Wizard-Schritte"
                    >
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{ display: "flex", alignItems: "center", gap: 10 }}
                          role="listitem"
                        >
                          <div
                            aria-current={i === stepIndex ? "step" : undefined}
                            aria-label={`Schritt ${i + 1} von 3`}
                            style={{
                              width: 32, height: 32, borderRadius: 16,
                              background: i <= stepIndex ? ACCENT : "#2A2A36",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 13, fontWeight: 700,
                              color: i <= stepIndex ? "#fff" : "rgba(255,255,255,0.4)",
                              transition: "background 0.2s, color 0.2s",
                            }}
                          >
                            {i + 1}
                          </div>
                          {i < 2 && (
                            <div style={{
                              width: 56, height: 2,
                              background: i < stepIndex ? ACCENT : "#2A2A36",
                              transition: "background 0.2s",
                            }}/>
                          )}
                        </div>
                      ))}
                    </div>
                    {navBtn("fwd")}
                  </>
                );
              })()}
            </div>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              marginTop: 10, fontSize: 12, fontWeight: 600,
              textAlign: "center", letterSpacing: "-0.01em",
            }}>
              <span style={{ color: stepIndex === 0 ? ACCENT : "rgba(255,255,255,0.45)" }}>Essen</span>
              <span style={{ color: stepIndex === 1 ? ACCENT : "rgba(255,255,255,0.45)" }}>Makros</span>
              <span style={{ color: stepIndex === 2 ? ACCENT : "rgba(255,255,255,0.45)" }}>Ergebnis</span>
            </div>
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
              <button
                type="button"
                onClick={() => recording ? stopRecording() : startRecording()}
                disabled={parsing || !speechAvail}
                aria-label={recording ? "Aufnahme stoppen" : "Sprach-Eingabe starten"}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
                  width: "100%", maxWidth: 280, height: 56, borderRadius: 28,
                  background: ACCENT, border: "none", color: "#fff",
                  fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                  cursor: parsing || !speechAvail ? "not-allowed" : "pointer",
                  animation: recording ? "engVPulse 0.8s ease-in-out infinite" : undefined,
                  opacity: parsing || !speechAvail ? 0.55 : 1,
                  transition: "background 0.2s, opacity 0.2s",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" stroke="none"/>
                  <path d="M5 10a7 7 0 0 0 14 0"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="9" y1="22" x2="15" y2="22"/>
                </svg>
                {recording ? "Stopp" : parsing ? "Verarbeite…" : "Sprechen"}
              </button>
              {voiceErr && (
                <div style={{ fontSize: 11, color: PINK, textAlign: "center", maxWidth: 360 }}>{voiceErr}</div>
              )}
              <div ref={chatPanelRef} style={{ width: "100%", marginTop: 4 }}>
                <EngineChatPanel
                  macros={{
                    carbs:   Number(carbs)   || 0,
                    protein: Number(protein) || 0,
                    fat:     Number(fat)     || 0,
                    fiber:   Number(fiber)   || 0,
                  }}
                  description={desc}
                  onPatch={(patch) => {
                    // AI returned macros — fill the form and (if any
                    // macro came back populated) auto-advance to Step 2,
                    // mirroring the voice path. Pure questions where
                    // the AI returns zero macros leave the user on
                    // Step 1 to keep chatting.
                    setCarbs(String(patch.carbs));
                    setProtein(String(patch.protein));
                    setFat(String(patch.fat));
                    setFiber(String(patch.fiber));
                    if (patch.description) setDesc(patch.description);
                    const hasMacros =
                      patch.carbs > 0 || patch.protein > 0 ||
                      patch.fat > 0   || patch.fiber > 0;
                    if (hasMacros) {
                      void handlePullCgm();
                      // Only auto-advance if the user is still on Step 1.
                      // Without this guard, a follow-up AI message arriving
                      // while the user already navigated back/forward would
                      // jerk them back to Step 2 — which felt buggy. Mirrors
                      // the voice-path guard at line ~465.
                      setStepIndex(prev => prev === 0 ? 1 : prev);
                    }
                  }}
                  seed={chatSeed}
                  isMobile={isMobile}
                  expanded={true}
                  onToggleExpanded={() => { /* always expanded in Step 1 */ }}
                  parsing={parsing}
                  hasUsedVoice={hasUsedVoice}
                />
              </div>
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
                ✓ Gespeichert — {wizardSavedDose} IE geloggt
              </div>
              <button
                onClick={handleNewMeal}
                style={{
                  width: "100%", height: 52, borderRadius: 12, border: "none",
                  background: ACCENT,
                  color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                Neues Essen
              </button>
            </div>
          )}
          {stepIndex === 1 && wizardSavedDose === null && (
            <div style={{ ...card, padding: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 20, color: "#fff" }}>
                Makros prüfen
              </h2>

              {/* Section header: Makros — 2x2 grid (Carbs+Fiber, Protein+Fat) */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#666680", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
                  Makros
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, rowGap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>Carbs (g)</label>
                    <input style={inp} type="number" placeholder="e.g. 60" value={carbs} onChange={(e) => setCarbs(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      Fiber (g) <span style={{ textTransform: "none", color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 500 }}>opt.</span>
                    </label>
                    <input style={inp} type="number" placeholder="e.g. 8" value={fiber} onChange={(e) => setFiber(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>Protein (g)</label>
                    <input style={inp} type="number" placeholder="e.g. 30" value={protein} onChange={(e) => setProtein(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>Fat (g)</label>
                    <input style={inp} type="number" placeholder="e.g. 15" value={fat} onChange={(e) => setFat(e.target.value)}/>
                  </div>
                </div>
              </div>

              {/* Section header: Glukose & Zeit — glucose + CGM pull pill, meal time */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#666680", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
                  Glukose & Zeit
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
                        Glucose Before (mg/dL){lastReading ? ` · Last: ${lastReading}` : ""}
                      </label>
                      <button onClick={handlePullCgm} disabled={cgmPulling} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "4px 10px", borderRadius: 99, border: `1px solid ${ACCENT}40`,
                        background: `${ACCENT}15`, color: ACCENT, fontSize: 11, fontWeight: 600,
                        cursor: cgmPulling ? "wait" : "pointer", flexShrink: 0,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}/>
                        {cgmPulling ? "Pulling…" : "CGM"}
                      </button>
                    </div>
                    <input style={inp} type="number" placeholder="e.g. 115" value={glucose} onChange={(e) => setGlucose(e.target.value)}/>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      Meal Time
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
                    color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                    cursor: confirming ? "wait" : "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  {confirming ? "Speichere…" : "✓ Speichern (ohne Bolus)"}
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
                      {running ? "Berechne…" : "Bolus berechnen →"}
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
                      color: "rgba(255,255,255,0.55)",
                      fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em",
                      cursor: running || confirming ? "not-allowed" : "pointer",
                      textDecoration: "underline", textUnderlineOffset: 3,
                      textDecorationColor: "rgba(255,255,255,0.25)",
                    }}
                  >
                    Bolus direkt eingeben
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
                        Direkter Bolus
                      </span>
                      <button
                        type="button"
                        onClick={() => { setDirectBolusOpen(false); setDirectBolusValue(""); setConfirmErr(""); }}
                        disabled={confirming}
                        aria-label="Abbrechen"
                        style={{
                          background: "transparent", border: "none",
                          color: "rgba(255,255,255,0.45)", fontSize: 18,
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
                            background: "#0D0D12",
                            border: `1px solid ${BORDER}`,
                            borderRadius: 10,
                            padding: "0 36px 0 12px",
                            color: "#fff", fontSize: 16, fontWeight: 700,
                            outline: "none", textAlign: "right",
                          }}
                        />
                        <span style={{
                          position: "absolute", right: 12, top: "50%",
                          transform: "translateY(-50%)",
                          color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600,
                          pointerEvents: "none",
                        }}>
                          IE
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
                              color: "#fff",
                              fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
                              cursor: blocked ? (confirming ? "wait" : "not-allowed") : "pointer",
                              transition: "background 0.2s",
                            }}
                          >
                            {confirming
                              ? "Speichere…"
                              : valid
                                ? `Speichern mit ${iNum} IE`
                                : "Speichern"}
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
                    color: "#666680", fontSize: 13, fontWeight: 500,
                    cursor: running || confirming ? "not-allowed" : "pointer",
                  }}
                >
                  ← Zurück
                </button>
              </div>
            </div>
          )}

          {/* ───────── STEP 3: Deine Empfehlung ───────── */}
          {stepIndex === 2 && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 16, color: "#fff" }}>
                Deine Empfehlung
              </h2>

              {!result ? (
                // Defensive: should not happen because handleRun gates the
                // transition on a successful calc, but if state was lost
                // (e.g. tab switch + reset) give the user a clean way back.
                <div style={{ ...card, padding: 20, marginBottom: 16 }}>
                  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                    Keine Empfehlung verfügbar. Bitte zurück zu Schritt 2 und neu berechnen.
                  </div>
                  <button
                    onClick={() => setStepIndex(1)}
                    style={{
                      padding: "10px 18px", borderRadius: 10,
                      border: `1px solid ${BORDER}`, background: "transparent",
                      color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    ← Zurück
                  </button>
                </div>
              ) : (
                <>
                  {/* Result card — dose front-and-center, 32px bold white,
                      confidence chip + ICR ratio underneath. */}
                  <div style={{
                    background: "#0D0D14", border: "1px solid #1C1C28",
                    borderRadius: 16, padding: 20, marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 11, color: "#666680", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
                      Empfohlene Dosis
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 14 }}>
                      <span style={{ fontSize: 32, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
                        {result.dose}
                      </span>
                      <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>IE</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                      <span style={{ color: "rgba(255,255,255,0.55)" }}>ICR: 1:{adaptedICR}</span>
                      <span style={{
                        padding: "2px 10px", borderRadius: 99,
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                        background: `${CONF_COLOR[result.confidence]}22`,
                        color: CONF_COLOR[result.confidence],
                        border: `1px solid ${CONF_COLOR[result.confidence]}40`,
                      }}>
                        {result.confidence}
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>
                        {result.source === "historical" ? "Historische Daten" : result.source === "blended" ? "Blended Modell" : "ICR Formel"}
                      </span>
                    </div>
                  </div>

                  {/* Collapsible GPT reasoning — chevron toggles the body. */}
                  <div style={{
                    background: "#0D0D14", border: "1px solid #1C1C28",
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
                        color: "#666680", fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                      }}
                    >
                      <span>GPT Reasoning</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        style={{ transition: "transform 0.2s", transform: reasoningExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    {reasoningExpanded && (
                      <div id="gpt-reasoning-body" style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.6, color: "#AAAACC" }}>
                        {result.reasoning}
                      </div>
                    )}
                  </div>

                  {/* Meal summary line — shows what the user is about to save. */}
                  <div style={{ marginBottom: 18, fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, padding: "0 4px" }}>
                    {(desc.trim() || transcript.trim() || "Mahlzeit")} · {parseFloat(carbs) || 0}g KH
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
                          color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                          cursor: confirming ? "wait" : "pointer",
                          marginBottom: 8,
                          transition: "background 0.2s",
                        }}
                      >
                        {confirming ? "Speichere…" : "✓ Bestätigen & Speichern"}
                      </button>
                      <button
                        onClick={() => setStepIndex(1)}
                        disabled={confirming}
                        style={{
                          width: "100%", height: 36, borderRadius: 8,
                          border: "none", background: "transparent",
                          color: "#666680", fontSize: 13, fontWeight: 500,
                          cursor: confirming ? "not-allowed" : "pointer",
                        }}
                      >
                        ← Nochmal anpassen
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
                        ✓ Gespeichert — {wizardSavedDose} IE geloggt
                      </div>
                      <button
                        onClick={handleNewMeal}
                        style={{
                          width: "100%", height: 52, borderRadius: 12, border: "none",
                          background: ACCENT,
                          color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em",
                          cursor: "pointer",
                          transition: "background 0.2s",
                        }}
                      >
                        Neues Essen
                      </button>
                    </>
                  )}

                  {/* Important medical disclaimer — same wording as the legacy result panel. */}
                  <div style={{ marginTop: 24, padding: "14px 18px", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: `1px solid ${BORDER}` }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
                      <strong style={{ color: "rgba(255,255,255,0.4)" }}>Important:</strong> Glev Engine provides decision support only. Always consult your endocrinologist before adjusting insulin doses. This tool is not a medical device.
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        )}

              {tab === "log"         && <EngineLogTab />}
      {tab === "bolus"       && <InsulinForm />}
      {tab === "exercise"    && <ExerciseForm />}
      {tab === "fingerstick" && <FingerstickLogCard />}
    </div>
  );
}
