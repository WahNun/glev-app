"use client";

import { useState, useEffect, useRef } from "react";
import { fetchMeals, classifyMeal, computeCalories, saveMeal, deleteMeal, updateMeal, type Meal } from "@/lib/meals";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";
import { logDebug } from "@/lib/debug";
import { fetchRecentInsulinLogs, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, type ExerciseLog } from "@/lib/exercise";
import EngineLogTab, { InsulinForm, ExerciseForm } from "@/components/EngineLogTab";
import FingerstickLogCard from "@/components/FingerstickLogCard";
import GlevLogo from "@/components/GlevLogo";
import EngineChatPanel, { type SeedMessage } from "@/components/EngineChatPanel";
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined");
    if (!ok) setSpeechAvail(false);
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
        // Adaptive ICR — derive a personalised insulin:carb ratio from the
        // user's last 14 days of meals (capped at 20 most-recent samples).
        // HIGH evals mean past doses were too generous → push ICR up
        // (more carbs per unit = less insulin). LOW evals mean past doses
        // were too small → push ICR down. Read-only: never written to DB.
        const fourteenDaysAgo = Date.now() - 14 * 24 * 3600 * 1000;
        const recent = fetched
          .filter(m => parseDbTs(m.created_at) >= fourteenDaysAgo)
          .sort((a, b) => parseDbTs(b.created_at) - parseDbTs(a.created_at))
          .slice(0, 20);
        const evals = recent
          .map(m => m.evaluation)
          .filter((e): e is string => e === "HIGH" || e === "LOW" || e === "GOOD");
        if (evals.length >= 3) {
          const high = evals.filter(e => e === "HIGH").length;
          const low  = evals.filter(e => e === "LOW").length;
          const netBias = (high - low) / evals.length;
          const newICR = Math.round(Math.min(25, Math.max(8, 15 + netBias * 4)));
          setAdaptedICR(newICR);
          setIcrConfidence(evals.length >= 10 ? "high" : evals.length >= 5 ? "medium" : "low");
          setIcrSampleSize(evals.length);
          logDebug("ENGINE.ADAPTIVE_ICR", { newICR, sampleSize: evals.length, high, low, netBias });
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
      // PRE-FILL ENTFERNT: Insulin wird jetzt erst NACH Confirm Log + binärer
      // Bolus-Entscheidung im Post-Confirm-Flow eingegeben. Kein silent-set
      // mehr in den `insulin`-State, sonst würde beim Save eine Dosis
      // gespeichert, die der User nie bestätigt hat. Die Empfehlung
      // (`rec.dose`) bleibt im `result`-State und wird im Decision-Panel
      // angezeigt, sobald der Bolus-Pfad gewählt ist.
      logDebug("ENGINE", { input: { glucose: g, carbs: c }, matchedMeals: rec.similarMeals.map(m => ({ id: m.id, carbs: m.carbs_grams, glucose: m.glucose_before, insulin: m.insulin_units })), suggestedDose: rec.dose, confidence: rec.confidence, recentInsulin: insulinLogs.length, recentExercise: exerciseLogs.length });
    }, 600);
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
      <div style={{ marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <GlevLogo size={32} />
          <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em" }}>Glev Engine</h1>
        </div>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>
          {tab === "engine"
            ? "AI-powered insulin recommendations from your personal dosing history."
            : tab === "bolus"
            ? "Standalone Bolus- und Basal-Dosen dokumentieren. Glev rechnet nichts."
            : tab === "fingerstick"
            ? "Manueller Fingerstick — überschreibt CGM-Werte ≤ 5 min für die Engine."
            : tab === "exercise"
            ? "Sport-Sessions dokumentieren — Glev verknüpft sie mit Glukose-Reaktionen."
            : "Insulin- und Exercise-Logs sowie manuelle Glukose-Werte dokumentieren."}
        </p>
      </div>

      {/* TABS */}
      <div style={{
        display:"inline-flex", gap:4, marginBottom:24,
        background:"#0D0D12", border:`1px solid ${BORDER}`,
        borderRadius:12, padding:4,
      }}>
        {(isMobile
          ? [
              { id:"engine"      as const, label:"Engine" },
              { id:"bolus"       as const, label:"Insulin Log" },
              { id:"exercise"    as const, label:"Exercise Log" },
              { id:"fingerstick" as const, label:"FS Glucose" },
            ]
          : [
              { id:"engine"      as const, label:"Engine" },
              { id:"log"         as const, label:"Log" },
              { id:"fingerstick" as const, label:"FS Glucose" },
            ]
        ).map(t => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding:"8px 18px", borderRadius:8, border:"none",
                background: on ? `${ACCENT}22` : "transparent",
                color:    on ? ACCENT : "rgba(255,255,255,0.55)",
                fontSize:13, fontWeight:700, letterSpacing:"-0.01em",
                cursor:"pointer", transition:"all 0.15s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "engine" && (
      <div style={{
        display:"grid",
        gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1.65fr) minmax(0, 1fr)",
        gap: isMobile ? 16 : 24,
        alignItems:"stretch",
      }}>
      <div style={{ minWidth:0, display:"flex", flexDirection:"column" }}>
      {/* Voice input — transcribes & auto-fills macros via /api/transcribe → /api/parse-food */}
      <style>{`
        @keyframes engVPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes engSpin   { to { transform: rotate(360deg) } }
        .eng-mic-btn:hover:not(:disabled) { transform: scale(1.04); }
      `}</style>
      <div style={{ ...card, padding:"22px 22px 20px", marginBottom:20 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:11 }}>
          <div style={{ position:"relative", width:84, height:84 }}>
            {recording && <div style={{ position:"absolute", inset:-14, borderRadius:"50%", background:`radial-gradient(circle,${ACCENT}24 0%,transparent 70%)`, animation:"engVPulse 2s ease-in-out infinite", pointerEvents:"none" }}/>}
            <button
              className="eng-mic-btn"
              type="button"
              onClick={() => recording ? stopRecording() : startRecording()}
              disabled={parsing || !speechAvail}
              style={{
                position:"absolute", inset:0, borderRadius:"50%",
                border: recording ? `1px solid ${ACCENT}88` : `1px solid rgba(255,255,255,0.08)`,
                cursor: parsing || !speechAvail ? "default" : "pointer",
                background: `radial-gradient(circle at 36% 32%, #1e1e2e 0%, #141420 45%, #09090B 100%)`,
                boxShadow: recording
                  ? `0 0 0 1px ${ACCENT}55, 0 0 26px ${ACCENT}55, inset 0 0 18px rgba(79,110,247,0.15)`
                  : `0 5px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                transition:"all 0.2s",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={recording ? ACCENT : "rgba(255,255,255,0.85)"} strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="11" rx="3" fill={recording ? ACCENT : "rgba(255,255,255,0.85)"} stroke="none"/>
                <path d="M5 10a7 7 0 0 0 14 0"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
                <line x1="9"  y1="22" x2="15" y2="22"/>
              </svg>
            </button>
          </div>
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color: recording ? ACCENT : parsing ? ORANGE : "rgba(255,255,255,0.45)" }}>
            {recording ? "LISTENING…" : parsing ? "PARSING…" : speechAvail ? "TAP TO SPEAK" : "VOICE UNAVAILABLE"}
          </div>
          {transcript ? (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", fontStyle:"italic", textAlign:"center", lineHeight:1.5, padding:"7px 12px", background:"rgba(255,255,255,0.03)", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", maxWidth:480 }}>
              &quot;{transcript}&quot;
            </div>
          ) : (
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.22)", letterSpacing:"0.06em", textAlign:"center" }}>
              z. B. &quot;Pasta mit Tomatensauce, 80 g Nudeln und ein Apfel&quot;
            </div>
          )}
          {voiceErr && <div style={{ fontSize:11, color:PINK }}>{voiceErr}</div>}
          {!speechAvail && !voiceErr && <div style={{ fontSize:11, color:ORANGE }}>Sprach-Eingabe wird in diesem Browser nicht unterstützt.</div>}
        </div>
      </div>

      {/* Mobile: GPT reasoning chat sits between the mic card and the form,
          collapsed by default. The desktop equivalent lives in the right
          column below. */}
      {isMobile && (
        <div style={{ marginBottom: 20 }}>
          <EngineChatPanel
            macros={{
              carbs:   parseFloat(carbs)   || 0,
              protein: parseFloat(protein) || 0,
              fat:     parseFloat(fat)     || 0,
              fiber:   parseFloat(fiber)   || 0,
            }}
            description={desc}
            onPatch={(p) => {
              setCarbs(String(p.carbs));
              setProtein(String(p.protein));
              setFat(String(p.fat));
              setFiber(String(p.fiber));
              if (p.description) setDesc(p.description);
            }}
            seed={chatSeed}
            isMobile={true}
            expanded={chatExpanded}
            onToggleExpanded={() => setChatExpanded(v => !v)}
            parsing={parsing}
          />
        </div>
      )}

      {isMobile ? (
        // ---- Mobile: single-card flow that matches the original log-style
        // layout the user is used to. No "Current Conditions" / "Meal Details"
        // section titles; macros are a 2x2 grid (Carbs+Fiber, Protein+Fat);
        // Meal Classification is always visible as an inline field that shows
        // "Auto from macros" until the macros are filled.
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* Glucose + CGM pull */}
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, gap:8 }}>
                <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>
                  Glucose Before (mg/dL){lastReading ? ` · Last reading: ${lastReading}` : ""}
                </label>
                <button onClick={handlePullCgm} disabled={cgmPulling} style={{
                  display:"flex", alignItems:"center", gap:6,
                  padding:"4px 10px", borderRadius:99, border:`1px solid ${ACCENT}40`,
                  background:`${ACCENT}15`, color:ACCENT, fontSize:11, fontWeight:600,
                  cursor: cgmPulling ? "wait" : "pointer", flexShrink:0,
                }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:GREEN, boxShadow:`0 0 6px ${GREEN}` }}/>
                  CGM
                </button>
              </div>
              <input style={inp} type="number" placeholder="e.g. 115" value={glucose} onChange={e => setGlucose(e.target.value)}/>
            </div>

            {/* Meal Time */}
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>
                Meal Time
              </label>
              <input
                style={{ ...inp, fontFamily:"inherit", textAlign:"center" }}
                type="datetime-local"
                value={mealTime}
                onChange={e => setMealTime(e.target.value)}
              />
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:6, lineHeight:1.45 }}>
                When you ate. Defaults to the latest CGM reading time — edit to backfill a past meal.
              </div>
            </div>

            {/* Macros 2x2: Carbs+Fiber, Protein+Fat */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, rowGap:14 }}>
              <div>
                <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>Carbs (g)</label>
                <input style={inp} type="number" placeholder="e.g. 60" value={carbs} onChange={e => setCarbs(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>
                  Fiber (g) <span style={{ textTransform:"none", color:"rgba(255,255,255,0.3)", fontSize:10, fontWeight:500 }}>opt.</span>
                </label>
                <input style={inp} type="number" placeholder="e.g. 8" value={fiber} onChange={e => setFiber(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>Protein (g)</label>
                <input style={inp} type="number" placeholder="e.g. 30" value={protein} onChange={e => setProtein(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>Fat (g)</label>
                <input style={inp} type="number" placeholder="e.g. 15" value={fat} onChange={e => setFat(e.target.value)}/>
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>
                Meal Description
              </label>
              <input style={inp} placeholder="e.g. granola, banana, yogurt…" value={desc} onChange={e => setDesc(e.target.value)}/>
            </div>

            {/* Meal Classification — always visible, "Auto from macros" until
                the macros are filled, then shows the actual class. Der
                Parsing-Indikator gehört NICHT hierher (sonst flippt das Chip
                semantisch zwischen "Klassifizierung läuft" und "Voice-Parsing
                läuft", obwohl es zwei verschiedene Prozesse sind). Das
                Parsing-Feedback rendert jetzt im AI-FOOD-PARSER-Chip oben
                via EngineChatPanel `parsing` prop. */}
            {(() => {
              const isFilled = (s: string) => s != null && s !== "" && !isNaN(parseFloat(s));
              const filled = [carbs, protein, fat, fiber].some(isFilled);
              const cNum = parseFloat(carbs) || 0;
              const pNum = parseFloat(protein) || 0;
              const fNum = parseFloat(fat) || 0;
              const fbNum = parseFloat(fiber) || 0;
              // Live preview chip: prefer the AI label captured from the
              // most recent /api/parse-food response when present, so the
              // chip matches what handleConfirmLog will persist.
              const cls = filled ? (aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum)) : null;
              const color = cls ? (TYPE_COLORS[cls as string] || ACCENT) : "rgba(255,255,255,0.35)";
              const label = cls ? TYPE_LABELS[cls] : "Auto from macros";
              return (
                <div>
                  <label style={{ fontSize:11, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, display:"block", marginBottom:6 }}>
                    Meal Classification
                  </label>
                  <div style={{
                    ...inp,
                    display:"flex", alignItems:"center", gap:10,
                    color: cls ? "#fff" : "rgba(255,255,255,0.45)",
                    fontWeight: cls ? 600 : 400,
                  }}>
                    <span style={{
                      width:8, height:8, borderRadius:"50%",
                      background: color,
                      boxShadow: cls ? `0 0 6px ${color}` : "none",
                      flexShrink:0,
                    }}/>
                    {label}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Current Conditions</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)" }}>Glucose Before (mg/dL)</label>
                  <button onClick={handlePullCgm} disabled={cgmPulling} style={{
                    display:"flex", alignItems:"center", gap:6,
                    padding:"4px 10px", borderRadius:99, border:`1px solid ${ACCENT}40`,
                    background:`${ACCENT}15`, color:ACCENT, fontSize:11, fontWeight:600,
                    cursor: cgmPulling ? "wait" : "pointer",
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    {cgmPulling ? "Pulling…" : "Pull CGM"}
                  </button>
                </div>
                <input style={inp} type="number" placeholder="e.g. 115" value={glucose} onChange={e => setGlucose(e.target.value)}/>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Meal Time</label>
                <input
                  style={{ ...inp, fontFamily:"inherit" }}
                  type="datetime-local"
                  value={mealTime}
                  onChange={e => setMealTime(e.target.value)}
                />
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4 }}>
                  When you ate. Edit to backfill a past meal.
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Planned Carbs (g)</label>
                <input style={inp} type="number" placeholder="e.g. 60" value={carbs} onChange={e => setCarbs(e.target.value)}/>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Meal Details (optional)</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                <div>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Protein (g)</label>
                  <input style={inp} type="number" placeholder="0" value={protein} onChange={e => setProtein(e.target.value)}/>
                </div>
                <div>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Fat (g)</label>
                  <input style={inp} type="number" placeholder="0" value={fat} onChange={e => setFat(e.target.value)}/>
                </div>
                <div>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Fiber (g)</label>
                  <input style={inp} type="number" placeholder="0" value={fiber} onChange={e => setFiber(e.target.value)}/>
                </div>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Description</label>
                <input style={inp} placeholder="e.g. pasta with tomato sauce" value={desc} onChange={e => setDesc(e.target.value)}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {(() => {
        const gNum = parseFloat(glucose), cNum = parseFloat(carbs), pNum = parseFloat(protein), fNum = parseFloat(fat), fbNum = parseFloat(fiber);
        const allFilled = [gNum, cNum, pNum, fNum, fbNum].every(v => !isNaN(v) && v >= 0) && cNum > 0;
        if (!allFilled) return null;
        const TYPE_DESC: Record<string,string> = {
          FAST_CARBS: "High glycemic load — expect a sharp glucose rise. Consider pre-bolusing 15–20 min before eating.",
          HIGH_PROTEIN: "Protein-dominant — slower digestion, lower spike risk. Watch for delayed glucose rise.",
          HIGH_FAT: "Fat-dominant — significantly delayed absorption. Split-bolus or extended-bolus often appropriate.",
          BALANCED: "Macros are well-balanced — predictable absorption curve. Standard ICR usually works.",
        };
        const cls = aiMealType ?? classifyMeal(cNum, pNum, fNum, fbNum);
        const color = TYPE_COLORS[cls as string] || ACCENT;
        return (
          <div style={{
            background:`linear-gradient(135deg, ${color}10, ${color}04)`,
            border:`1px solid ${color}35`, borderRadius:16,
            padding:"18px 22px", marginBottom:20,
            display:"flex", gap:18, alignItems:"flex-start",
          }}>
            <div style={{
              width:42, height:42, borderRadius:12, flexShrink:0,
              background:`${color}20`, border:`1px solid ${color}40`,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v6"/><path d="M5 8h14"/><path d="M5 8l2 13h10l2-13"/>
              </svg>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:6 }}>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", textTransform:"uppercase", fontWeight:600 }}>Meal Classification</span>
                <span style={{ padding:"4px 12px", borderRadius:99, fontSize:11, fontWeight:700, background:`${color}25`, color, border:`1px solid ${color}45`, letterSpacing:"0.04em", textTransform:"uppercase" }}>
                  {TYPE_LABELS[cls]}
                </span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", lineHeight:1.55 }}>{TYPE_DESC[cls]}</div>
              <div style={{ marginTop:10, display:"flex", gap:14, flexWrap:"wrap", fontSize:11, color:"rgba(255,255,255,0.4)" }}>
                <span>Carbs <strong style={{ color:"rgba(255,255,255,0.75)" }}>{cNum}g</strong></span>
                <span>Protein <strong style={{ color:"rgba(255,255,255,0.75)" }}>{pNum}g</strong></span>
                <span>Fat <strong style={{ color:"rgba(255,255,255,0.75)" }}>{fNum}g</strong></span>
                <span>Fiber <strong style={{ color:"rgba(255,255,255,0.75)" }}>{fbNum}g</strong></span>
                <span>Net carbs <strong style={{ color:"rgba(255,255,255,0.75)" }}>{Math.max(0, cNum - fbNum)}g</strong></span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* INSULIN-EINGABEFELD HIER ENTFERNT.
          Der Pre-Confirm-Flow speichert die Mahlzeit ohne Dosis. Erst nach
          Confirm Log öffnet sich das Decision-Panel (`confirmedMeal != null`)
          mit der binären Frage "Bolus eingeben? / Empfehlung holen? / Verwerfen?".
          Wählt der User dort "Bolus", routet `handleDecisionBolus` nach
          `/log?bolusFor=<id>` — dort findet die eigentliche Insulin-Eingabe
          statt, sauber an die soeben gespeicherte Mahlzeit gekoppelt. */}

      {confirmErr && (
        <div style={{ marginBottom:10, padding:"10px 14px", borderRadius:10, background:`${PINK}15`, border:`1px solid ${PINK}40`, color:PINK, fontSize:12 }}>
          {confirmErr}
        </div>
      )}
      {/* Auto-dismiss toast for decision-panel actions (delete, accept rec, etc.) */}
      {decisionToast && (
        <div style={{ marginBottom:10, padding:"10px 14px", borderRadius:10, background:`${GREEN}15`, border:`1px solid ${GREEN}40`, color:GREEN, fontSize:12 }}>
          {decisionToast}
        </div>
      )}

      {/* Form mode: Confirm Log + Cancel.  Hidden once a meal has been saved
          and the decision panel below takes over. */}
      {!confirmedMeal && (
        <>
          <button
            onClick={handleConfirmLog}
            disabled={confirming || !carbs}
            style={{
              width:"100%", padding:"15px", borderRadius:14, border:"none",
              background: !confirming && carbs
                ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                : "rgba(79,110,247,0.25)",
              color: !confirming && carbs ? "#fff" : "rgba(255,255,255,0.55)",
              fontSize:15, fontWeight:700,
              cursor: confirming || !carbs ? "not-allowed" : "pointer",
              boxShadow: !confirming && carbs ? `0 4px 18px ${ACCENT}30` : "none",
              transition:"all 0.2s", marginBottom:10,
            }}
          >
            {confirming ? "Saving…" : "✓ Confirm Log"}
          </button>
          <button
            onClick={handleCancel}
            disabled={confirming}
            style={{
              width:"100%", padding:"13px", borderRadius:14,
              border:`1px solid ${BORDER}`, background:"transparent",
              color:"rgba(255,255,255,0.55)", fontSize:14, fontWeight:600,
              cursor: confirming ? "not-allowed" : "pointer",
              marginBottom:24,
            }}
          >
            Cancel
          </button>
        </>
      )}

      {/* Decision mode: shown after a successful Confirm Log.
          Two sub-views: "decision" (3 buttons) + "rec" (recommendation result). */}
      {confirmedMeal && (
        <div style={{ marginBottom:24, padding:"16px 18px", borderRadius:14, background:`${ACCENT}08`, border:`1px solid ${ACCENT}30`, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:11, letterSpacing:"0.1em", fontWeight:700, color:GREEN, textTransform:"uppercase" }}>
              ✓ Log gespeichert
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontFamily:"var(--font-mono)" }}>
              {(confirmedMeal.carbs_grams ?? 0)}g · {confirmedMeal.insulin_units != null ? `${confirmedMeal.insulin_units}u` : "Bolus offen"}
            </div>
          </div>

          {decisionMode === "decision" && (
            <>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", lineHeight:1.5 }}>
                Wie weiter? Bolus dokumentieren, Empfehlung berechnen oder den Eintrag verwerfen.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                <button
                  onClick={handleDecisionBolus}
                  disabled={decisionBusy}
                  style={{ padding:"12px 10px", borderRadius:10, border:"none", background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff", fontSize:13, fontWeight:700, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  Bolus loggen
                </button>
                <button
                  onClick={handleDecisionEmpfehlung}
                  disabled={decisionBusy}
                  style={{ padding:"12px 10px", borderRadius:10, border:`1px solid ${ACCENT}60`, background:"transparent", color:ACCENT, fontSize:13, fontWeight:700, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  {decisionBusy && decisionMode === "decision" ? "…" : "Empfehlung"}
                </button>
                <button
                  onClick={handleDecisionDelete}
                  disabled={decisionBusy}
                  style={{ padding:"12px 10px", borderRadius:10, border:`1px solid ${PINK}40`, background:"transparent", color:PINK, fontSize:13, fontWeight:700, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  Abbrechen
                </button>
              </div>
              <button
                onClick={handleDecisionNoBolus}
                disabled={decisionBusy}
                style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1px solid ${BORDER}`, background:"rgba(255,255,255,0.03)", color:"rgba(255,255,255,0.55)", fontSize:12, fontWeight:600, cursor:decisionBusy?"not-allowed":"pointer", letterSpacing:"0.01em" }}
              >
                Speichern — kein Bolus
              </button>
            </>
          )}

          {decisionMode === "rec" && decisionRec && (
            <>
              <div style={{ background:"#0D0D12", borderRadius:10, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>Empfehlung</div>
                <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                  <span style={{ fontSize:30, fontWeight:800, color:ACCENT, letterSpacing:"-0.02em" }}>{decisionRec.dose}</span>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.45)" }}>u</span>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginLeft:8 }}>
                    aktuell: <strong style={{ color:"rgba(255,255,255,0.7)" }}>
                      {confirmedMeal.insulin_units != null ? `${confirmedMeal.insulin_units}u` : "—"}
                    </strong>
                  </span>
                  <span style={{ marginLeft:"auto", padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:700, background:`${ACCENT}22`, color:ACCENT, letterSpacing:"0.05em" }}>
                    {decisionRec.confidence}
                  </span>
                </div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:8, lineHeight:1.5 }}>
                  {decisionRec.reasoning}
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <button
                  onClick={handleDecisionAcceptRec}
                  disabled={decisionBusy}
                  style={{ padding:"12px 10px", borderRadius:10, border:"none", background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff", fontSize:13, fontWeight:700, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  Übernehmen →
                </button>
                <button
                  onClick={() => { setDecisionMode("decision"); setDecisionRec(null); }}
                  disabled={decisionBusy}
                  style={{ padding:"12px 10px", borderRadius:10, border:`1px solid ${BORDER}`, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:13, fontWeight:600, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  Zurück
                </button>
              </div>
            </>
          )}

          {/* Insulin-Sub-Mode: editierbares Eingabefeld + Confirm Log + Zurück.
              Reachable EITHER via Bolus loggen (input startet leer) OR via
              Empfehlung → Übernehmen → (input vorbelegt mit rec.dose).
              Hier passiert der eigentliche PATCH der Dosis auf die schon
              gespeicherte Mahlzeit — vorher wird NICHTS in die DB geschrieben. */}
          {decisionMode === "insulin" && (
            <>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", lineHeight:1.5 }}>
                {decisionRec
                  ? <>Empfehlung <strong style={{ color:ACCENT }}>{decisionRec.dose}u</strong> übernommen — anpassen falls nötig, dann bestätigen.</>
                  : <>Trage die tatsächlich gespritzte Insulindosis für diese Mahlzeit ein.</>}
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Insulin (U)</label>
                <input
                  style={inp}
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="e.g. 1.5"
                  value={insulin}
                  onChange={e => { setInsulin(e.target.value); if (decisionInsulinErr) setDecisionInsulinErr(null); }}
                  disabled={decisionBusy}
                  autoFocus
                />
              </div>
              {decisionInsulinErr && (
                <div style={{ padding:"10px 14px", borderRadius:10, background:`${PINK}15`, border:`1px solid ${PINK}40`, color:PINK, fontSize:12 }}>
                  {decisionInsulinErr}
                </div>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <button
                  onClick={handleConfirmDecisionInsulin}
                  disabled={decisionBusy || !insulin.trim()}
                  style={{
                    padding:"13px 10px", borderRadius:10, border:"none",
                    background: !decisionBusy && insulin.trim()
                      ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`
                      : "rgba(79,110,247,0.25)",
                    color: !decisionBusy && insulin.trim() ? "#fff" : "rgba(255,255,255,0.55)",
                    fontSize:13, fontWeight:700,
                    cursor: decisionBusy || !insulin.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {decisionBusy ? "Speichere…" : "✓ Confirm Log"}
                </button>
                <button
                  onClick={handleDecisionInsulinBack}
                  disabled={decisionBusy}
                  style={{ padding:"13px 10px", borderRadius:10, border:`1px solid ${BORDER}`, background:"transparent", color:"rgba(255,255,255,0.6)", fontSize:13, fontWeight:600, cursor:decisionBusy?"not-allowed":"pointer" }}
                >
                  Zurück
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* INPUT SUMMARY */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6 }}>Input Glucose</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:"#60A5FA", letterSpacing:"-0.02em" }}>{parseFloat(glucose)||110}</span>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>mg/dL</span>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4 }}>
                {(parseFloat(glucose)||110) > 140 ? "elevated" : (parseFloat(glucose)||110) < 80 ? "low" : "in target"}
              </div>
            </div>
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:6 }}>Input Carbs</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:28, fontWeight:800, color:ORANGE, letterSpacing:"-0.02em" }}>{parseFloat(carbs)||0}</span>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>g</span>
              </div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:4 }}>
                {(parseFloat(carbs)||0) >= 60 ? "high-carb meal" : (parseFloat(carbs)||0) >= 30 ? "moderate" : "light"}
              </div>
            </div>
          </div>

          {/* MAIN RESULT */}
          <div style={{ background:SURFACE, border:`1px solid ${CONF_COLOR[result.confidence]}30`, borderRadius:16, padding:"28px 28px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:8 }}>Recommended Dose</div>
                <div style={{ fontSize:60, fontWeight:900, letterSpacing:"-0.04em", lineHeight:1, color:"#fff" }}>
                  {result.dose}
                  <span style={{ fontSize:20, fontWeight:400, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>units</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginBottom:8 }}>Confidence</div>
                <span style={{ padding:"8px 20px", borderRadius:99, fontSize:14, fontWeight:700, background:`${CONF_COLOR[result.confidence]}18`, color:CONF_COLOR[result.confidence], border:`1px solid ${CONF_COLOR[result.confidence]}40` }}>
                  {result.confidence}
                </span>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>
                  {result.source === "historical" ? "Historical data" : result.source === "blended" ? "Blended model" : "ICR formula"}
                </div>
              </div>
            </div>

            <div style={{ marginTop:20, padding:"14px 16px", background:"rgba(0,0,0,0.3)", borderRadius:10 }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4, letterSpacing:"0.05em", textTransform:"uppercase" }}>Reasoning</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)", lineHeight:1.6 }}>{result.reasoning}</div>
            </div>

            <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              {[
                { label:"Carb Dose", val:`${result.carbDose}u`, sub:`${carbs}g ÷ ${adaptedICR} ICR`, color:ORANGE },
                { label:"Correction", val:`+${result.correctionDose}u`, sub:`(BG - 110) ÷ 50`, color:ACCENT },
                { label:"Total", val:`${result.dose}u`, sub:"recommended", color:GREEN },
              ].map(d => (
                <div key={d.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"12px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4 }}>{d.label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color:d.color }}>{d.val}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", marginTop:2 }}>{d.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ADAPTIVE ICR INFO — read-only display, never written to DB */}
          {icrSampleSize >= 3 ? (
            <div style={{ padding:"10px 14px", background:"rgba(255,255,255,0.02)", borderRadius:10, border:`1px solid ${BORDER}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, fontSize:11.5, color:"rgba(255,255,255,0.55)", flexWrap:"wrap" }}>
              <span>
                ICR <strong style={{ color:"rgba(255,255,255,0.85)" }}>{adaptedICR}:1</strong>
                {" — basierend auf "}
                <strong style={{ color:"rgba(255,255,255,0.85)" }}>{icrSampleSize}</strong>
                {" Einträgen · Konfidenz "}
                <strong style={{ color:"rgba(255,255,255,0.85)" }}>{icrConfidence}</strong>
              </span>
              {adaptedICR !== 15 && (
                <span style={{ color: adaptedICR > 15 ? GREEN : ORANGE, fontWeight:700, fontSize:11, whiteSpace:"nowrap" }}>
                  {adaptedICR > 15 ? "↑ konservativer" : "↓ aggressiver"}
                </span>
              )}
            </div>
          ) : (
            <div style={{ padding:"10px 14px", background:"rgba(255,255,255,0.02)", borderRadius:10, border:`1px solid ${BORDER}`, fontSize:11.5, color:"rgba(255,255,255,0.4)" }}>
              ICR <strong style={{ color:"rgba(255,255,255,0.6)" }}>15:1</strong> — Standardwert (≥3 Einträge nötig zur Anpassung)
            </div>
          )}

          {/* SIMILAR MEALS */}
          {result.similarMeals.length > 0 && (
            <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
              <div style={{ padding:"16px 20px", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ fontSize:13, fontWeight:600 }}>Reference Meals ({result.similarMeals.length})</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:2 }}>Historical meals used in this recommendation</div>
              </div>
              {result.similarMeals.map(m => {
                const date = parseDbDate(m.created_at).toLocaleDateString("en",{month:"short",day:"numeric"});
                return (
                  <div key={m.id} style={{ padding:"12px 20px", borderBottom:`1px solid ${BORDER}`, display:"grid", gridTemplateColumns:"1fr 60px 60px 70px 80px", gap:12, alignItems:"center", fontSize:12 }}>
                    <div style={{ color:"rgba(255,255,255,0.65)" }}>{m.input_text.length>45?m.input_text.slice(0,45)+"…":m.input_text}</div>
                    <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.glucose_before}</div>
                    <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.carbs_grams}g</div>
                    <div style={{ textAlign:"right" }}>{m.insulin_units}u</div>
                    <div style={{ textAlign:"right" }}><span style={{ padding:"2px 8px", borderRadius:99, fontSize:10, fontWeight:700, background:`${GREEN}18`, color:GREEN, border:`1px solid ${GREEN}30` }}>{date}</span></div>
                  </div>
                );
              })}
            </div>
          )}

          {loading && <div style={{ color:"rgba(255,255,255,0.3)", fontSize:12, textAlign:"center" }}>Loading historical data…</div>}

          <div style={{ padding:"14px 18px", background:"rgba(255,255,255,0.03)", borderRadius:12, border:`1px solid ${BORDER}` }}>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", lineHeight:1.6 }}>
              <strong style={{ color:"rgba(255,255,255,0.4)" }}>Important:</strong> Glev Engine provides decision support only. Always consult your endocrinologist before adjusting insulin doses. This tool is not a medical device.
            </div>
          </div>
        </div>
      )}
      </div>{/* /left column */}

      {!isMobile && (
        <div style={{ minWidth:0, display:"flex", flexDirection:"column", height:"100%" }}>
          <EngineChatPanel
            macros={{
              carbs:   parseFloat(carbs)   || 0,
              protein: parseFloat(protein) || 0,
              fat:     parseFloat(fat)     || 0,
              fiber:   parseFloat(fiber)   || 0,
            }}
            description={desc}
            onPatch={(p) => {
              setCarbs(String(p.carbs));
              setProtein(String(p.protein));
              setFat(String(p.fat));
              setFiber(String(p.fiber));
              if (p.description) setDesc(p.description);
            }}
            seed={chatSeed}
            isMobile={false}
            expanded={true}
            parsing={parsing}
            onToggleExpanded={() => {}}
          />
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
