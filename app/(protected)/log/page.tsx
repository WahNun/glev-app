"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { saveMeal, classifyMeal, computeCalories, fetchMeals, type ParsedFood, type Meal } from "@/lib/meals";
import { scheduleAutoFillForMeal } from "@/lib/postMealCgmAutoFill";
import { supabase } from "@/lib/supabase";
import { parseLluTs } from "@/lib/time";

import { TYPE_COLORS, TYPE_LABELS } from "@/lib/mealTypes";

type CgmLatest = {
  current: {
    value: number;
    unit: string;
    timestamp: string;
    trend: string;
  };
};

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";
const CONF_COLOR: Record<string, string> = { HIGH: GREEN, MEDIUM: ORANGE, LOW: PINK };

interface Recommendation {
  dose: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: string;
  reasoning: string;
  carbDose: number;
  correctionDose: number;
  similarMeals: Meal[];
}

function runGlevEngine(meals: Meal[], currentGlucose: number, carbs: number): Recommendation {
  const icr = 15, cf = 50, target = 110;
  const carbDose = carbs / icr;
  const correctionDose = Math.max(0, (currentGlucose - target) / cf);
  const formulaDose = Math.round((carbDose + correctionDose) * 10) / 10;
  const similar = meals.filter(m =>
    m.carbs_grams !== null && Math.abs((m.carbs_grams || 0) - carbs) <= 12 &&
    m.glucose_before !== null && Math.abs((m.glucose_before || 0) - currentGlucose) <= 35 &&
    m.evaluation === "GOOD" && m.insulin_units
  );
  if (similar.length >= 3) {
    const avg = Math.round(similar.reduce((s, m) => s + (m.insulin_units || 0), 0) / similar.length * 10) / 10;
    return { dose: avg, confidence: "HIGH", source: "historical",
      reasoning: `Basiert auf ${similar.length} ähnlichen Mahlzeiten mit GUTEM Verlauf (±12g Carbs, ±35 mg/dL Glukose). Historischer Insulin-Schnitt: ${avg}u.`,
      carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: similar.slice(0, 5) };
  }
  if (similar.length >= 1) {
    const histAvg = similar.reduce((s, m) => s + (m.insulin_units || 0), 0) / similar.length;
    const blended = Math.round(((histAvg + formulaDose) / 2) * 10) / 10;
    return { dose: blended, confidence: "MEDIUM", source: "blended",
      reasoning: `Mix aus ${similar.length} ähnlicher Mahlzeit + ICR-Formel. Wenig historische Daten — log mehr Mahlzeiten für höhere Konfidenz.`,
      carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: similar };
  }
  return { dose: formulaDose, confidence: "LOW", source: "formula",
    reasoning: `Keine ähnlichen Mahlzeiten gefunden. Standard ICR-Formel: ${carbs}g ÷ ${icr} + ${Math.round(correctionDose * 10) / 10}u Korrektur.`,
    carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: [] };
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Translation keys for the wizard step pills. Rendered via t(STEP_KEYS[i])
// against the "log" namespace in messages/<locale>.json. The order is the
// canonical step order (Essen → Makros → Ergebnis); changing it would
// reorder the visible pills, NOT just relabel them.
const STEP_KEYS = ["step1", "step2", "step3"] as const;

export default function LogPage() {
  const router = useRouter();
  const t = useTranslations("log");
  const locale = useLocale();
  const [recording, setRecording] = useState(false);
  const [hasActiveMeal, setHasActiveMeal] = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [pipeStatus, setPipeStatus] = useState<"idle" | "transcribing" | "parsing">("idle");
  const [transcript, setTranscript] = useState("");

  // Wizard step (0 = Essen, 1 = Makros, 2 = Ergebnis). Per spec the pill
  // tabs are display-only — navigation is exclusively via the
  // Zurück/Weiter buttons at the bottom of each step.
  const [stepIndex, setStepIndex] = useState<0 | 1 | 2>(0);

  // Entry-details fields
  const [glucose, setGlucose]   = useState("");
  const [carbs, setCarbs]       = useState("");
  const [fiber, setFiber]       = useState("");
  const [protein, setProtein]   = useState("");
  const [fat, setFat]           = useState("");
  const [calories, setCalories] = useState("");
  const [desc, setDesc]         = useState("");
  const [insulin, setInsulin]   = useState("");
  const [isCorrectionBolus, setIsCorrectionBolus] = useState(false);
  const [relatedMealId, setRelatedMealId] = useState<string | null>(null);
  const [recentMeals, setRecentMeals] = useState<Meal[]>([]);
  const [mealTime, setMealTime] = useState<string>(() => toDatetimeLocal(new Date().toISOString()));
  const [mealTimeDirty, setMealTimeDirty] = useState(false);

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState(false);
  const [speechAvail, setSpeechAvail] = useState(true);
  const [cgmLoading, setCgmLoading] = useState(false);
  const [cgmTimestamp, setCgmTimestamp] = useState<string | null>(null);
  const [cgmFailed, setCgmFailed] = useState(false);
  const [glucoseTouched, setGlucoseTouched] = useState(false);

  // Glev Engine recommendation
  const [meals, setMeals] = useState<Meal[]>([]);
  const [rec, setRec]     = useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);

  useEffect(() => {
    fetchMeals().then(fetched => {
      setMeals(fetched);
      const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
      setRecentMeals(fetched.filter(m => new Date(m.meal_time ?? m.created_at).getTime() >= sixHoursAgo));
    }).catch(console.error);
  }, []);

  // Deep-link from engine's post-confirm decision panel: ?bolusFor=<mealId>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const bolusFor = params.get("bolusFor");
    if (!bolusFor || recentMeals.length === 0) return;
    if (!recentMeals.some(m => m.id === bolusFor)) return;
    setIsCorrectionBolus(true);
    setRelatedMealId(bolusFor);
    // Skip to Step 3 since the user already knows the dose context — they
    // just need to confirm/enter the IE.
    setStepIndex(2);
    window.history.replaceState({}, "", window.location.pathname);
  }, [recentMeals]);

  // GPT reasoning chat panel
  type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
  const [chatMsgs, setChatMsgs]   = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [macroUpdatedAt, setMacroUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!macroUpdatedAt) return;
    const t = setTimeout(() => setMacroUpdatedAt(null), 6000);
    return () => clearTimeout(t);
  }, [macroUpdatedAt]);
  const [chatBusy, setChatBusy]   = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recordingStopTsRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined");
    if (!ok) setSpeechAvail(false);
  }, []);

  function resetForm() {
    setRecording(false); setHasActiveMeal(false);
    setParsing(false); setTranscript("");
    setGlucose(""); setCarbs(""); setFiber(""); setProtein(""); setFat(""); setCalories(""); setDesc(""); setInsulin("");
    setIsCorrectionBolus(false); setRelatedMealId(null);
    setMealTime(toDatetimeLocal(new Date().toISOString())); setMealTimeDirty(false);
    setSaving(false); setError(""); setSuccess(false);
    setChatMsgs([]); setChatInput(""); setPipeStatus("idle");
    setRec(null); setRecLoading(false);
    setStepIndex(0);
    try { mediaRecRef.current?.stop(); } catch {}
  }

  useEffect(() => {
    return () => { setHasActiveMeal(false); };
  }, []);

  const num = (v: string): number | null => {
    if (!v.trim()) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const totalCarbs   = num(carbs)   ?? 0;
  const totalProtein = num(protein) ?? 0;
  const totalFat     = num(fat)     ?? 0;
  const totalFiber   = num(fiber)   ?? 0;
  const glucoseNum   = num(glucose);
  const insulinNum   = num(insulin);

  async function startRecording() {
    setError("");
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
        console.log("[PERF voice/log] stop → blob built:", tBlob - tStop, "ms · blob:", Math.round(blob.size / 1024), "KB ·", actualType);
        const ext = actualType.includes("mp4")  ? "m4a"
                 : actualType.includes("mpeg") ? "mp3"
                 : actualType.includes("ogg")  ? "ogg"
                 : "webm";
        await handleVoiceInput(blob, ext);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);
      if (!hasActiveMeal) setTranscript("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error_mic_unavailable"));
      setRecording(false);
    }
  }

  function stopRecording() {
    recordingStopTsRef.current = Date.now();
    mediaRecRef.current?.stop();
    setRecording(false);
  }

  async function transcribeBlob(blob: Blob, ext = "webm"): Promise<string> {
    const fd = new FormData();
    fd.append("audio", blob, `voice.${ext}`);
    const tFetch0 = Date.now();
    const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
    const tData = await tRes.json();
    // eslint-disable-next-line no-console
    console.log("[PERF voice/log] /api/transcribe round-trip:", Date.now() - tFetch0, "ms");
    if (!tRes.ok || !tData.text) throw new Error(tData.error || t("error_empty_transcript"));
    return tData.text as string;
  }

  async function handleVoiceInput(blob: Blob, ext = "webm") {
    const tHandlerStart = Date.now();
    const tStop = recordingStopTsRef.current ?? tHandlerStart;
    setParsing(true); setError(""); setPipeStatus("transcribing");
    if (!hasActiveMeal) pullCgm();
    try {
      const text = await transcribeBlob(blob, ext);
      if (!text) return;
      const tAfterTranscribe = Date.now();
      if (hasActiveMeal) {
        setPipeStatus("idle");
        // eslint-disable-next-line no-console
        console.log("[PERF voice/log] transcribe → chat-macros branch (correction path)");
        await sendChat(text);
      } else {
        setTranscript(text);
        setPipeStatus("parsing");
        // eslint-disable-next-line no-console
        console.log("[PERF voice/log] transcribe → parse start gap:", Date.now() - tAfterTranscribe, "ms");
        await autoFill(text);
      }
      // eslint-disable-next-line no-console
      console.log("[PERF voice/log] TOTAL (stop → done):", Date.now() - tStop, "ms · branch:", hasActiveMeal ? "chat" : "parse");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log("[PERF voice/log] FAILED after:", Date.now() - tStop, "ms");
      setError(e instanceof Error ? e.message : t("error_transcription_failed"));
    } finally { setParsing(false); setPipeStatus("idle"); recordingStopTsRef.current = null; }
  }

  // Silent background compute so Step 3 can reveal the recommendation
  // without a network round-trip.
  const precomputedRecRef = useRef<Recommendation | null>(null);
  useEffect(() => {
    const g = num(glucose) ?? 110;
    const c = num(carbs) ?? 0;
    const t = setTimeout(() => {
      try {
        precomputedRecRef.current = runGlevEngine(meals, g, c);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [glucose, carbs, protein, fat, fiber, insulin, meals]);

  function runRecommendation() {
    setError(""); setRecLoading(true);
    setTimeout(() => {
      const r = precomputedRecRef.current ?? runGlevEngine(meals, num(glucose) ?? 110, num(carbs) ?? 0);
      setRec(r);
      if (!insulin) setInsulin(String(r.dose));
      setRecLoading(false);
    }, 120);
  }

  // Auto-trigger recommendation when entering Step 3 (Ergebnis) so the
  // dose appears immediately without the user having to click anything.
  useEffect(() => {
    if (stepIndex === 2 && glucoseNum != null && totalCarbs > 0 && !rec && !recLoading) {
      runRecommendation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  async function autoFill(text: string) {
    setChatMsgs(c => [...c, { role: "user", content: text }]);
    try {
      const tFetch0 = Date.now();
      const res  = await fetch("/api/parse-food", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text }) });
      const data = await res.json();
      const tParseDone = Date.now();
      // eslint-disable-next-line no-console
      console.log("[PERF voice/log] /api/parse-food round-trip:", tParseDone - tFetch0, "ms");
      const t = data.totals || {};
      if (t.carbs    != null && !carbs)    setCarbs(String(t.carbs));
      if (t.fiber    != null && !fiber)    setFiber(String(t.fiber));
      if (t.protein  != null && !protein)  setProtein(String(t.protein));
      if (t.fat      != null && !fat)      setFat(String(t.fat));
      if (t.calories != null && !calories) setCalories(String(t.calories));
      // eslint-disable-next-line no-console
      console.log("[PERF voice/log] parse response → form fields filled:", Date.now() - tParseDone, "ms");
      if (typeof data.description === "string" && data.description.trim()) {
        setDesc(data.description.trim());
      }

      const items: Partial<ParsedFood>[] = data.parsed || [];
      const tCarbs = t.carbs ?? 0, tProt = t.protein ?? 0, tFat = t.fat ?? 0, tFiber = t.fiber ?? 0;
      const cType = data.mealType ?? classifyMeal(tCarbs, tProt, tFat, tFiber);
      const parts: string[] = [];
      if (data.summary) parts.push(data.summary);
      if (items.length) {
        parts.push("Breakdown:\n" + items.map(it => `• ${it.name} (${it.grams}g) — ${it.carbs ?? 0}g C / ${it.protein ?? 0}g P / ${it.fat ?? 0}g F`).join("\n"));
      }
      parts.push(`Totals: ${tCarbs}g carbs, ${tProt}g protein, ${tFat}g fat, ${tFiber}g fiber.`);
      parts.push(`Meal classification: ${TYPE_LABELS[cType] || cType} — based on the macro mix above.`);
      setChatMsgs(c => [...c, { role: "assistant", content: parts.join("\n\n") }]);
      setHasActiveMeal(true);
    } catch {
      setChatMsgs(c => [...c, { role: "assistant", content: t("chat_parse_failed") }]);
    }
  }

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMsgs, chatBusy]);

  async function sendChat(prefill?: string) {
    const text = (prefill ?? chatInput).trim();
    if (!text || chatBusy) return;
    const next: ChatMsg[] = [...chatMsgs, { role: "user", content: text }];
    setChatMsgs(next);
    setChatInput("");
    setChatBusy(true);
    try {
      const res = await fetch("/api/chat-macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          description: desc || transcript || "",
          macros: { carbs: totalCarbs, protein: totalProtein, fat: totalFat, fiber: totalFiber },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("error_chat_failed"));
      setChatMsgs(c => [...c, { role: "assistant", content: data.reply || "(no reply)" }]);
      if (
        data.macros && typeof data.macros === "object" &&
        typeof data.description === "string" && data.description.trim()
      ) {
        const m = data.macros as { carbs: number; protein: number; fat: number; fiber?: number; calories?: number };
        setCarbs(String(m.carbs));
        setProtein(String(m.protein));
        setFat(String(m.fat));
        setFiber(String(m.fiber ?? 0));
        setDesc(data.description.trim());
        setMacroUpdatedAt(Date.now());
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("error_chat_failed");
      setChatMsgs(c => [...c, { role: "assistant", content: `⚠ ${msg}` }]);
    } finally { setChatBusy(false); }
  }

  useEffect(() => {
    if (chatMsgs.length === 0 && (transcript || desc) && (totalCarbs || totalProtein || totalFat)) {
      sendChat(`Erkläre kurz wie du auf diese Makros gekommen bist für: "${desc || transcript}". Erwähne Portionsgrößen-Annahmen und Approximationen.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  async function getLatestCGM(): Promise<
    | { ok: true; value: number; timestamp: string; formattedTime: string }
    | { ok: false; status: number; message: string }
  > {
    if (!supabase) return { ok: false, status: 401, message: t("error_session_expired") };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { ok: false, status: 401, message: t("error_session_expired") };

      const res = await fetch("/api/cgm/latest", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const msg =
          res.status === 401 ? t("error_session_expired") :
          res.status === 404 ? t("error_cgm_no_credentials") :
          res.status === 502 ? t("error_cgm_unavailable") :
          t("error_cgm_load_failed");
        return { ok: false, status: res.status, message: msg };
      }

      const data = (await res.json()) as Partial<CgmLatest>;
      const cur = data?.current;
      if (!cur || typeof cur.value !== "number" || !cur.timestamp) {
        return { ok: false, status: 502, message: t("error_cgm_unavailable") };
      }
      const tsMs = parseLluTs(cur.timestamp);
      const formattedTime = tsMs == null
        ? cur.timestamp
        : new Date(tsMs).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
      return { ok: true, value: Math.round(cur.value), timestamp: cur.timestamp, formattedTime };
    } catch {
      return { ok: false, status: 0, message: t("error_cgm_load_failed") };
    }
  }

  const [cgmError, setCgmError] = useState<string>("");

  async function pullCgm(opts: { force?: boolean; silent?: boolean } = {}) {
    if (!opts.silent) { setCgmLoading(true); setError(""); }
    setCgmFailed(false);
    setCgmError("");
    const res = await getLatestCGM();
    if (!opts.silent) setCgmLoading(false);
    if (!res.ok) {
      setCgmFailed(true);
      if (!opts.silent) setCgmError(res.message);
      return;
    }
    setCgmTimestamp(res.formattedTime);
    if (opts.force || !glucoseTouched || !glucose) {
      setGlucose(String(res.value));
      setGlucoseTouched(false);
    }
    if (!mealTimeDirty) setMealTime(toDatetimeLocal(res.timestamp));
  }

  useEffect(() => {
    const id = setInterval(() => { pullCgm({ silent: true }).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasAny = totalCarbs > 0 || totalProtein > 0 || totalFat > 0 || !!desc.trim();

  // Step gating — Weiter is only enabled when the current step has the
  // minimum required data. Step 1 (Essen) needs at least a description or
  // some macros / a transcript so the user has something to inspect on
  // Step 2. Step 2 (Makros) needs glucose AND carbs (the saveMeal Pflicht
  // fields) before the user is allowed to advance to Ergebnis.
  const canAdvanceFrom1 = !!(transcript.trim() || desc.trim() || hasAny);
  const canAdvanceFrom2 = glucoseNum != null && totalCarbs > 0;

  async function handleConfirm() {
    if (!glucoseNum || !totalCarbs) { setError(t("error_required_fields")); return; }
    setSaving(true); setError("");
    try {
      const ev = null;
      const mealTimeIso = mealTime ? new Date(mealTime).toISOString() : new Date().toISOString();
      const saved = await saveMeal({
        inputText: desc || transcript || "Manual entry",
        parsedJson: [],
        glucoseBefore: glucoseNum, glucoseAfter: null,
        carbsGrams: totalCarbs,
        proteinGrams: totalProtein,
        fatGrams: totalFat,
        fiberGrams: totalFiber,
        calories: num(calories) ?? computeCalories(totalCarbs, totalProtein, totalFat),
        insulinUnits: insulinNum,
        mealType: classifyMeal(totalCarbs, totalProtein, totalFat, totalFiber),
        evaluation: ev,
        mealTime: mealTimeIso,
        relatedMealId: isCorrectionBolus ? relatedMealId : null,
      });
      try { scheduleAutoFillForMeal(saved.id, mealTimeIso); } catch { /* non-fatal */ }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:meal-saved", { detail: { id: saved.id, mealTime: mealTimeIso } }));
      }
      setSuccess(true);
      setHasActiveMeal(false);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (e) { setError(e instanceof Error ? e.message : t("error_save_failed")); }
    finally { setSaving(false); }
  }

  const card: React.CSSProperties = { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "20px 24px" };
  const inp: React.CSSProperties  = { background: "#0D0D12", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, width: "100%", outline: "none", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase", display: "block" };

  if (success) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"60vh", gap:16 }}>
      <div style={{ width:64, height:64, borderRadius:99, background:`${GREEN}20`, border:`2px solid ${GREEN}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div style={{ fontSize:20, fontWeight:700 }}>{t("success_logged")}</div>
      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:14 }}>{t("success_redirect")}</div>
    </div>
  );

  const voiceLabel = recording ? t("listening") : speechAvail ? t("tap_to_speak") : t("voice_unavailable");
  const pipeLabel  = pipeStatus === "transcribing" ? t("pipe_transcribing") : pipeStatus === "parsing" ? t("pipe_parsing_nutrition") : null;

  // Live classification chip used in Step 3.
  const liveType = (totalCarbs > 0 || totalProtein > 0 || totalFat > 0)
    ? classifyMeal(totalCarbs, totalProtein, totalFat, totalFiber)
    : null;
  const liveTypeColor = liveType ? (TYPE_COLORS[liveType] || ACCENT) : "rgba(255,255,255,0.3)";
  const liveTypeLabel = liveType ? (TYPE_LABELS[liveType] || liveType) : "Auto from macros";

  return (
    <div style={{ maxWidth:1100, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      <style>{`
        @keyframes vPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes spin   { to { transform: rotate(360deg) } }
        .mic-btn:hover:not(:disabled) { transform: scale(1.04); }
        .log-grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 18px; align-items: start; }
        .log-grid .chat-col { position: sticky; top: 16px; }
        /* Mobile: stack vertically AND let the chat panel flex-grow to fill
           every remaining pixel between the AI Parser chip and the bottom
           nav bar. The 240px subtraction accounts for the workspace's
           top chrome (logo bar + artifact-selector chip ≈ 116px), the
           page H1 + pill tabs (≈ 60px), the footer nav with its safe-area
           padding (≈ 80px), and a small 24px slack so we never undercut
           the viewport on devices with notches. The !important overrides
           are needed because the chat-col root carries inline desktop
           sizes (height: calc(100vh - 180px), maxHeight: 760, …) which
           would otherwise win the cascade. */
        @media (max-width: 900px) {
          .log-grid {
            display: flex !important;
            flex-direction: column !important;
            grid-template-columns: 1fr;
            gap: 12px !important;
            min-height: calc(100dvh - 240px) !important;
          }
          .log-grid > div:first-child { flex: 0 0 auto !important; }
          .log-grid .chat-col {
            position: static !important;
            height: auto !important;
            max-height: none !important;
            min-height: 240px !important;
            flex: 1 1 auto !important;
            display: flex !important;
          }
        }
        /* Wizard step pills — base size for mobile, larger on desktop.
           Sizing lives in CSS (not the inline style object) so we can
           respond to viewport without an isMobile state hook. The 768px
           threshold matches Layout.tsx's sidebar breakpoint. */
        .wizard-pill { font-size: 12px; padding: 8px 12px; }
        @media (min-width: 769px) {
          .wizard-pill { font-size: 14px; padding: 10px 22px; }
        }
      `}</style>

      <div style={{ marginBottom:6 }}>
        <h1 style={{ fontSize:28, fontWeight:800, letterSpacing:"-0.03em", margin:0 }}>{t("title")}</h1>
      </div>

      {/* PILL TABS — display-only per spec ("Klick wechselt Step NICHT").
          They surface progress through the wizard; navigation happens
          exclusively via the Zurück/Weiter buttons at the bottom of each
          step. Active pill: filled with ACCENT. Inactive: transparent
          background, ACCENT border.
          marginTop creates visible breathing room from the workspace
          chrome above (artifact-selector "Engine" chip) — without it
          the pills look glued to that chip on narrow viewports. */}
      <div role="tablist" aria-label={t("wizard_steps")} style={{
        display: "flex", gap: 8, padding: "4px 0", marginTop: 14,
      }}>
        {STEP_KEYS.map((key, i) => {
          const label = t(key);
          const active = i === stepIndex;
          return (
            <div
              key={key}
              role="tab"
              aria-selected={active}
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
              {label}
            </div>
          );
        })}
      </div>

      <div className="log-grid">
        <div style={{ display:"flex", flexDirection:"column", gap:14, minWidth:0 }}>

          {/* ─────────────────  STEP 1 — ESSEN  ───────────────── */}
          {stepIndex === 0 && (
            <>
              <div style={{ ...card, padding:"24px 22px 22px" }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
                  <div style={{ position:"relative", width:96, height:96 }}>
                    {recording && <div style={{ position:"absolute", inset:-16, borderRadius:"50%", background:`radial-gradient(circle,${ACCENT}24 0%,transparent 70%)`, animation:"vPulse 2s ease-in-out infinite", pointerEvents:"none" }}/>}
                    <button
                      className="mic-btn"
                      onClick={() => recording ? stopRecording() : startRecording()}
                      disabled={parsing || !speechAvail}
                      aria-label={recording ? t("voice_aria_stop") : t("voice_aria_start")}
                      style={{
                        position:"absolute", inset:0, borderRadius:"50%",
                        border: recording ? `1px solid ${ACCENT}88` : `1px solid rgba(255,255,255,0.08)`,
                        cursor: parsing || !speechAvail ? "default" : "pointer",
                        background: `radial-gradient(circle at 36% 32%, #1e1e2e 0%, #141420 45%, #09090B 100%)`,
                        boxShadow: recording
                          ? `0 0 0 1px ${ACCENT}55, 0 0 30px ${ACCENT}55, inset 0 0 20px rgba(79,110,247,0.15)`
                          : `0 6px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        transition:"all 0.2s",
                      }}
                    >
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={recording ? ACCENT : "rgba(255,255,255,0.85)"} strokeWidth="2" strokeLinecap="round">
                        <rect x="9" y="2" width="6" height="11" rx="3" fill={recording ? ACCENT : "rgba(255,255,255,0.85)"} stroke="none"/>
                        <path d="M5 10a7 7 0 0 0 14 0"/>
                        <line x1="12" y1="19" x2="12" y2="22"/>
                        <line x1="9"  y1="22" x2="15" y2="22"/>
                      </svg>
                    </button>
                  </div>
                  <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color: recording ? ACCENT : "rgba(255,255,255,0.45)" }}>
                    {voiceLabel}
                  </div>
                  {transcript ? (
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", fontStyle:"italic", textAlign:"center", lineHeight:1.5, padding:"7px 12px", background:"rgba(255,255,255,0.03)", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", maxWidth:400 }}>
                      "{transcript}"
                    </div>
                  ) : (
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.22)", letterSpacing:"0.06em", textAlign:"center" }}>
                      {t("voice_example")}
                    </div>
                  )}
                  {!speechAvail && <div style={{ fontSize:11, color:ORANGE }}>{t("voice_unsupported")}</div>}
                </div>
              </div>

              <div style={{ ...card, padding:"12px 18px", border:`1px solid rgba(79,110,247,0.18)`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color:"rgba(255,255,255,0.45)" }}>
                  {t("ai_food_parser_caps")} <span style={{ fontSize:8, color:ACCENT, fontWeight:500, marginLeft:4 }}>{t("gpt_powered")}</span>
                </div>
                {parsing || pipeLabel ? (
                  <div style={{ fontSize:11, color:ACCENT, display:"flex", alignItems:"center", gap:6, fontWeight:700, letterSpacing:"0.04em" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink:0 }} aria-hidden="true">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3"/>
                      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                      </path>
                    </svg>
                    {pipeLabel ?? t("parsing")}
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:GREEN, display:"flex", alignItems:"center", gap:6, fontWeight:700, letterSpacing:"0.04em" }}>
                    <div style={{ width:8, height:8, borderRadius:99, background:GREEN, boxShadow:`0 0 6px ${GREEN}88`}}/>
                    {t("parser_status_ready_caps")}
                  </div>
                )}
              </div>

              {/* Erkannt — shown only when AI parse produced something. */}
              {(desc.trim() || hasAny) && (
                <div style={{ ...card, padding:"16px 18px" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.1em", marginBottom:10, textTransform:"uppercase" }}>{t("recognized")}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    <div>
                      <label style={labelStyle}>{t("description_editable_label")}</label>
                      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t("placeholder_description")} style={{ ...inp, fontSize:13 }}/>
                    </div>
                    {hasAny && (
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.55)", lineHeight:1.5 }}>
                        {t("proposed_macros_prefix")} <strong style={{ color:"#fff" }}>{totalCarbs}g C</strong> · <strong style={{ color:"#fff" }}>{totalProtein}g P</strong> · <strong style={{ color:"#fff" }}>{totalFat}g F</strong>{totalFiber > 0 ? <> · <strong style={{ color:"#fff" }}>{totalFiber}g {t("fiber_short")}</strong></> : null}
                        <span style={{ display:"block", marginTop:4, fontSize:10, color:"rgba(255,255,255,0.35)" }}>{t("proposed_macros_hint")}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && <div style={{ fontSize:12, color:PINK, padding:"8px 12px", background:`${PINK}10`, borderRadius:8, border:`1px solid ${PINK}25` }}>{error}</div>}

              {/* Step 1 nav: only Weiter (no Zurück on first step). */}
              <WizardNav
                onBack={null}
                onNext={() => setStepIndex(1)}
                nextLabel={t("next_to_macros")}
                nextDisabled={!canAdvanceFrom1}
                nextHint={canAdvanceFrom1 ? null : t("hint_speak_or_type")}
              />
            </>
          )}

          {/* ─────────────────  STEP 2 — MAKROS  ───────────────── */}
          {stepIndex === 1 && (
            <>
              <div style={{ ...card, padding:20 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", marginBottom:14, textTransform:"uppercase" }}>{t("step2_section")}</div>
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
                      <label style={{ ...labelStyle, marginBottom:0 }}>{t("glucose_before_label")} <span style={{ color:PINK, marginLeft:4 }}>*</span></label>
                      <span style={{ fontSize:10, color: cgmFailed ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.4)", letterSpacing:"0.02em" }}>
                        {cgmLoading ? t("cgm_loading") : cgmTimestamp ? t("cgm_last_reading", { time: cgmTimestamp }) : cgmFailed ? t("cgm_no_data") : ""}
                      </span>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <input value={glucose} onChange={e => { setGlucose(e.target.value); setGlucoseTouched(true); }} placeholder={t("placeholder_glucose")} type="number" style={{ ...inp, flex:1 }}/>
                      <button onClick={() => pullCgm({ force: true })} disabled={cgmLoading} title={t("cgm_refresh_title")}
                        style={{ padding:"0 14px", borderRadius:10, border:`1px solid ${ACCENT}44`, background: cgmLoading ? "rgba(255,255,255,0.04)" : `${ACCENT}18`, color:ACCENT, cursor: cgmLoading ? "default" : "pointer", fontSize:11, fontWeight:700, whiteSpace:"nowrap", letterSpacing:"0.04em", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background: cgmFailed ? PINK : GREEN, boxShadow:`0 0 5px ${cgmFailed ? PINK : GREEN}88`, flexShrink:0 }}/>
                        {cgmLoading ? (
                          <div style={{ width:12, height:12, border:`1.5px solid ${ACCENT}44`, borderTopColor:ACCENT, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-3.1-6.8"/>
                            <polyline points="21 4 21 10 15 10"/>
                          </svg>
                        )}
                        CGM
                      </button>
                    </div>
                    {cgmError && (
                      <div style={{ marginTop:6, fontSize:11, color:PINK, letterSpacing:"0.02em" }}>
                        {cgmError}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>{t("meal_time_label")}</label>
                    <input
                      value={mealTime}
                      onChange={e => { setMealTime(e.target.value); setMealTimeDirty(true); }}
                      type="datetime-local"
                      style={inp}
                    />
                    <div style={{ marginTop:4, fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.02em" }}>
                      {t("meal_time_hint")}
                    </div>
                  </div>
                  {macroUpdatedAt && Date.now() - macroUpdatedAt < 6000 && (
                    <div style={{ fontSize:10, color:GREEN, letterSpacing:"0.06em", fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ width:6, height:6, borderRadius:99, background:GREEN, boxShadow:`0 0 6px ${GREEN}88`}}/>
                      {t("macros_updated_from_correction")}
                    </div>
                  )}
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, marginBottom:-4 }}>
                    <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:ACCENT, padding:"3px 9px", borderRadius:99, background:`${ACCENT}14`, border:`1px solid ${ACCENT}33` }}>{t("macros_chip")}</span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.02em" }}>{t("macros_chip_hint")}</span>
                  </div>
                  {/* MAKRO-GRID — auto-fit collapses 5 macro fields to 2-3
                      cols on Desktop, 1-2 cols on tablets, 1 col on phones.
                      minmax(220px, 1fr): 220px is the comfortable minimum
                      width for "z.B. 60" + label. Glukose, Mahlzeit-Zeit,
                      Beschreibung stay full-row outside this grid because
                      they have special concerns (CGM button, datetime
                      input, free text). */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:10 }}>
                    <div>
                      <label style={labelStyle}>{t("carbs_label")} <span style={{ color:PINK, marginLeft:4 }}>*</span></label>
                      <input value={carbs} onChange={e => setCarbs(e.target.value)} placeholder={t("placeholder_carbs")} type="number" style={inp}/>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("protein_label")} <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>{t("optional_short")}</span></label>
                      <input value={protein} onChange={e => setProtein(e.target.value)} placeholder={t("placeholder_protein")} type="number" style={inp}/>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("fat_label")} <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>{t("optional_short")}</span></label>
                      <input value={fat} onChange={e => setFat(e.target.value)} placeholder={t("placeholder_fat")} type="number" style={inp}/>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("fiber_label")} <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>{t("optional_short")}</span></label>
                      <input value={fiber} onChange={e => setFiber(e.target.value)} placeholder={t("placeholder_fiber")} type="number" style={inp}/>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("calories_label")} <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>{t("calories_optional_hint")}</span></label>
                      <input value={calories} onChange={e => setCalories(e.target.value)} placeholder={totalCarbs || totalProtein || totalFat ? t("calories_auto_prefix", { value: computeCalories(totalCarbs, totalProtein, totalFat) }) : t("placeholder_calories")} type="number" style={inp}/>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>{t("description_label")}</label>
                    <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t("placeholder_description")} style={{ ...inp, fontSize:13 }}/>
                  </div>
                </div>
              </div>

              {error && <div style={{ fontSize:12, color:PINK, padding:"8px 12px", background:`${PINK}10`, borderRadius:8, border:`1px solid ${PINK}25` }}>{error}</div>}

              <WizardNav
                onBack={() => setStepIndex(0)}
                onNext={() => setStepIndex(2)}
                nextLabel={t("next_to_result")}
                nextDisabled={!canAdvanceFrom2}
                nextHint={canAdvanceFrom2 ? null : t("carbs_required_hint")}
              />
            </>
          )}

          {/* ─────────────────  STEP 3 — ERGEBNIS  ───────────────── */}
          {stepIndex === 2 && (
            <>
              {/* Classification chip */}
              <div style={{ ...card, padding:"18px 20px" }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.1em", marginBottom:10, textTransform:"uppercase" }}>{t("classification_section")}</div>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", borderRadius:12, background:liveType ? `${liveTypeColor}14` : "rgba(255,255,255,0.03)", border:`1px solid ${liveType ? `${liveTypeColor}55` : "rgba(255,255,255,0.08)"}` }}>
                  <div style={{ width:10, height:10, borderRadius:99, background:liveTypeColor, boxShadow:liveType ? `0 0 8px ${liveTypeColor}88` : "none" }}/>
                  <span style={{ fontSize:14, fontWeight:700, color:liveType ? liveTypeColor : "rgba(255,255,255,0.4)", letterSpacing:"-0.01em" }}>{liveTypeLabel}</span>
                  <span style={{ marginLeft:"auto", fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.04em" }}>{t("classification_auto_from_macros")}</span>
                </div>
              </div>

              {/* Recommendation */}
              <div style={{ ...card, padding:"18px 20px", display:"flex", flexDirection:"column", gap:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.1em", textTransform:"uppercase" }}>{t("recommendation")}</div>
                  {rec && (
                    <span style={{
                      fontSize:9, fontWeight:700, letterSpacing:"0.08em",
                      padding:"3px 9px", borderRadius:99,
                      background:`${CONF_COLOR[rec.confidence]}18`,
                      color:CONF_COLOR[rec.confidence],
                      border:`1px solid ${CONF_COLOR[rec.confidence]}55`,
                    }}>{rec.confidence}</span>
                  )}
                </div>

                {recLoading && (
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 0", color:"rgba(255,255,255,0.55)", fontSize:13 }}>
                    <div style={{ width:14, height:14, border:`2px solid ${ACCENT}44`, borderTopColor:ACCENT, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
                    {t("calculating_dose")}
                  </div>
                )}

                {!recLoading && rec && (
                  <>
                    <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
                      <span style={{ fontSize:36, fontWeight:800, color:"#fff", letterSpacing:"-0.03em" }}>{rec.dose}</span>
                      <span style={{ fontSize:14, color:"rgba(255,255,255,0.55)" }}>{t("units_recommended_label")}</span>
                    </div>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>
                      {rec.reasoning}
                    </div>
                  </>
                )}

                {!recLoading && !rec && (
                  <button
                    type="button"
                    onClick={runRecommendation}
                    style={{ padding:"10px 14px", borderRadius:10, border:`1px solid ${ACCENT}44`, background:`${ACCENT}18`, color:ACCENT, fontSize:12, fontWeight:700, cursor:"pointer", letterSpacing:"0.04em" }}
                  >
                    {t("calculate_recommendation")}
                  </button>
                )}

                <div>
                  <label style={labelStyle}>{t("insulin_label")} <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>{t("insulin_optional_hint")}</span></label>
                  <input value={insulin} onChange={e => setInsulin(e.target.value)} placeholder={rec ? String(rec.dose) : t("placeholder_insulin")} type="number" style={inp}/>
                </div>

                {/* Correction-Bolus tagging — same logic as before, only
                    appears when user enters a positive insulin dose. */}
                {insulinNum != null && insulinNum > 0 && (
                  <div style={{ background:`${ACCENT}08`, border:`1px solid ${ACCENT}30`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap: isCorrectionBolus ? 10 : 0 }}>
                    <label style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", gap:12 }}>
                      <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:"#fff" }}>{t("correction_bolus")}</span>
                        <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.45)", lineHeight:1.4 }}>
                          {t("correction_bolus_hint")}
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={isCorrectionBolus}
                        onChange={e => { setIsCorrectionBolus(e.target.checked); if (!e.target.checked) setRelatedMealId(null); }}
                        style={{ width:18, height:18, accentColor:ACCENT, cursor:"pointer", flexShrink:0 }}
                      />
                    </label>
                    {isCorrectionBolus && (
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600 }}>
                          {t("correction_which_meal")}
                        </div>
                        {recentMeals.length === 0 ? (
                          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", padding:"8px 0", fontStyle:"italic" }}>
                            {t("correction_no_recent")}
                          </div>
                        ) : (
                          <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto" }}>
                            {recentMeals.map(rm => {
                              const mealDate = new Date(rm.meal_time ?? rm.created_at);
                              const timeStr = mealDate.toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" });
                              const sel = relatedMealId === rm.id;
                              return (
                                <button
                                  key={rm.id}
                                  type="button"
                                  onClick={() => setRelatedMealId(sel ? null : rm.id)}
                                  style={{
                                    padding:"8px 10px",
                                    background: sel ? `${ACCENT}25` : "rgba(255,255,255,0.03)",
                                    border:`1px solid ${sel ? ACCENT : BORDER}`,
                                    borderRadius:8,
                                    color:"#fff",
                                    cursor:"pointer",
                                    textAlign:"left",
                                    display:"flex",
                                    justifyContent:"space-between",
                                    alignItems:"center",
                                    gap:8,
                                  }}
                                >
                                  <span style={{ fontSize:11.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                    {rm.input_text.length > 40 ? rm.input_text.slice(0, 40) + "…" : rm.input_text}
                                  </span>
                                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.5)", flexShrink:0, fontFamily:"var(--font-mono)" }}>{timeStr}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {error && <div style={{ fontSize:12, color:PINK, padding:"8px 12px", background:`${PINK}10`, borderRadius:8, border:`1px solid ${PINK}25` }}>{error}</div>}

              <WizardNav
                onBack={() => setStepIndex(1)}
                onNext={null}
                primaryLabel={saving ? t("saving") : t("save_meal")}
                primaryDisabled={saving || !glucoseNum || !totalCarbs}
                onPrimary={handleConfirm}
              />

              <button
                onClick={() => {
                  if (saving) return;
                  const dirty = hasAny || transcript.trim() || glucose;
                  if (dirty && !window.confirm(t("discard_confirm"))) return;
                  resetForm();
                }}
                disabled={saving}
                style={{ padding:"12px", borderRadius:12, border:`1px solid rgba(255,255,255,0.08)`, background:"transparent",
                  color: saving ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)", fontSize:13, fontWeight:600,
                  cursor: saving ? "not-allowed" : "pointer", transition:"all 0.2s" }}>
                {t("cancel")}
              </button>
            </>
          )}

        </div>{/* /left col */}

        {/* RIGHT COL: GPT reasoning chat — visible on desktop in Steps 1+2,
            hidden in Step 3 (final summary) and on mobile (CSS rule). */}
        {stepIndex < 2 && (
        <div className="chat-col" style={{ ...card, padding:0, display:"flex", flexDirection:"column", height:"calc(100vh - 180px)", maxHeight:760, minHeight:420, overflow:"hidden" }}>
          <div style={{ padding:"14px 18px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", color:"#fff", textTransform:"uppercase" }}>{t("gpt_reasoning_title")}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{t("chat_subtitle")}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:99, background: chatBusy ? ORANGE : GREEN, boxShadow:`0 0 6px ${chatBusy ? ORANGE : GREEN}88`}}/>
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:700 }}>{chatBusy ? t("chat_status_thinking") : t("chat_status_ready")}</span>
            </div>
          </div>

          <div ref={chatScrollRef} style={{ flex:1, overflowY:"auto", padding:"14px 18px", display:"flex", flexDirection:"column", gap:10 }}>
            {chatMsgs.length === 0 && !chatBusy && (
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:12, textAlign:"center", padding:"24px 8px", lineHeight:1.6 }}>
                {t("chat_intro")}
              </div>
            )}
            {chatMsgs.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} style={{ display:"flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth:"88%",
                    background: isUser ? `${ACCENT}22` : "rgba(255,255,255,0.05)",
                    border: `1px solid ${isUser ? ACCENT+"40" : "rgba(255,255,255,0.07)"}`,
                    borderRadius: 12,
                    padding: "9px 12px",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.9)",
                    whiteSpace: "pre-wrap",
                  }}>
                    <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color: isUser ? ACCENT : GREEN, marginBottom:4 }}>
                      {isUser ? t("chat_user_label") : t("gpt_label")}
                    </div>
                    {m.content}
                  </div>
                </div>
              );
            })}
            {chatBusy && (
              <div style={{ display:"flex", justifyContent:"flex-start" }}>
                <div style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"9px 12px", fontSize:12, color:"rgba(255,255,255,0.5)", display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:10, height:10, border:`1.5px solid ${ACCENT}44`, borderTopColor:ACCENT, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
                  {t("chat_thinking_inline")}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:"10px 12px", borderTop:`1px solid ${BORDER}`, display:"flex", gap:8 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder={t("chat_placeholder")}
              style={{ ...inp, flex:1, fontSize:13 }}
              disabled={chatBusy}
            />
            <button
              onClick={() => sendChat()}
              disabled={chatBusy || !chatInput.trim()}
              style={{
                padding:"0 16px", borderRadius:10, border:"none",
                background: chatBusy || !chatInput.trim() ? "rgba(255,255,255,0.05)" : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                color: chatBusy || !chatInput.trim() ? "rgba(255,255,255,0.3)" : "#fff",
                cursor: chatBusy || !chatInput.trim() ? "default" : "pointer",
                fontSize:13, fontWeight:700, letterSpacing:"-0.01em", whiteSpace:"nowrap",
              }}
            >{t("send")}</button>
          </div>
        </div>
        )}

      </div>{/* /grid */}
    </div>
  );
}

/**
 * Bottom navigation bar shared across all wizard steps. Renders one of two
 * shapes:
 *   - Steps 1 & 2: a Zurück (optional) + Weiter (next-step) pair.
 *   - Step 3:      a Zurück + primary action (Speichern) pair.
 *
 * The split keeps the per-step blocks above readable — each step only
 * has to provide the relevant labels/handlers without re-implementing
 * button styling.
 */
function WizardNav({
  onBack, onNext, nextLabel, nextDisabled, nextHint,
  onPrimary, primaryLabel, primaryDisabled,
}: {
  onBack: (() => void) | null;
  onNext: (() => void) | null;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextHint?: string | null;
  onPrimary?: () => void;
  primaryLabel?: string;
  primaryDisabled?: boolean;
}) {
  const t = useTranslations("log");
  const ACCENT = "#4F6EF7";
  const cta: React.CSSProperties = {
    flex: 1,
    padding: "14px",
    borderRadius: 12,
    border: "none",
    background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    cursor: "pointer",
    transition: "opacity 0.2s",
  };
  const ghost: React.CSSProperties = {
    padding: "14px 18px",
    borderRadius: 12,
    border: `1px solid rgba(255,255,255,0.1)`,
    background: "rgba(255,255,255,0.03)",
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {onBack ? (
          <button type="button" onClick={onBack} style={ghost}>← {t("back")}</button>
        ) : null}
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            disabled={!!nextDisabled}
            style={{ ...cta, opacity: nextDisabled ? 0.4 : 1, cursor: nextDisabled ? "default" : "pointer" }}
          >
            {nextLabel ?? t("next")} →
          </button>
        ) : null}
        {onPrimary ? (
          <button
            type="button"
            onClick={onPrimary}
            disabled={!!primaryDisabled}
            style={{ ...cta, opacity: primaryDisabled ? 0.4 : 1, cursor: primaryDisabled ? "default" : "pointer" }}
          >
            ✓ {primaryLabel ?? t("save")}
          </button>
        ) : null}
      </div>
      {nextHint ? (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "right", letterSpacing: "0.02em" }}>
          {nextHint}
        </div>
      ) : null}
    </div>
  );
}
