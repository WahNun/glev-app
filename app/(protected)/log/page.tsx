"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveMeal, classifyMeal, computeEvaluation, computeCalories, fetchMeals, type ParsedFood, type Meal } from "@/lib/meals";
import { scheduleAutoFillForMeal } from "@/lib/postMealCgmAutoFill";
import { supabase } from "@/lib/supabase";
import { parseDbDate, parseLluTs } from "@/lib/time";

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
      reasoning: `Based on ${similar.length} similar past meals with GOOD outcomes (±12g carbs, ±35 mg/dL glucose). Historical average insulin: ${avg}u.`,
      carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: similar.slice(0, 5) };
  }
  if (similar.length >= 1) {
    const histAvg = similar.reduce((s, m) => s + (m.insulin_units || 0), 0) / similar.length;
    const blended = Math.round(((histAvg + formulaDose) / 2) * 10) / 10;
    return { dose: blended, confidence: "MEDIUM", source: "blended",
      reasoning: `Blended from ${similar.length} similar meal(s) + ICR formula. Limited historical data — log more meals for higher confidence.`,
      carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: similar };
  }
  return { dose: formulaDose, confidence: "LOW", source: "formula",
    reasoning: `No similar historical meals found. Using standard ICR formula: ${carbs}g ÷ ${icr} + ${Math.round(correctionDose * 10) / 10}u correction.`,
    carbDose: Math.round(carbDose * 10) / 10, correctionDose: Math.round(correctionDose * 10) / 10, similarMeals: [] };
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LogPage() {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [hasActiveMeal, setHasActiveMeal] = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [pipeStatus, setPipeStatus] = useState<"idle" | "transcribing" | "parsing">("idle");
  const [transcript, setTranscript] = useState("");

  // Entry-details fields (mockup 1:1)
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
      // Surface meals from the last 6h so a correction bolus can be tagged
      // back to the meal it's correcting. Read-only; no DB write.
      const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
      setRecentMeals(fetched.filter(m => new Date(m.meal_time ?? m.created_at).getTime() >= sixHoursAgo));
    }).catch(console.error);
  }, []);

  // Deep-link from engine's post-confirm decision panel: ?bolusFor=<mealId>
  // pre-selects "Korrektur-Bolus" + the linked meal so the user only has to
  // type the actual dose. Runs once recentMeals is loaded so the meal can
  // actually be matched in the picker.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const bolusFor = params.get("bolusFor");
    if (!bolusFor || recentMeals.length === 0) return;
    if (!recentMeals.some(m => m.id === bolusFor)) return;
    setIsCorrectionBolus(true);
    setRelatedMealId(bolusFor);
    // Clean the URL so a refresh doesn't re-trigger this prefill.
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
    try { mediaRecRef.current?.stop(); } catch {}
  }

  // Reset session state when the user navigates away from the page.
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
      setError(e instanceof Error ? e.message : "Could not access microphone.");
      setRecording(false);
    }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    setRecording(false);
  }

  // Shared transcription helper — POSTs the blob to /api/transcribe and
  // returns the transcript text. Throws on empty/error so callers can surface it.
  async function transcribeBlob(blob: Blob, ext = "webm"): Promise<string> {
    const fd = new FormData();
    fd.append("audio", blob, `voice.${ext}`);
    const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
    const tData = await tRes.json();
    if (!tRes.ok || !tData.text) throw new Error(tData.error || "Empty transcript");
    return tData.text as string;
  }

  // Single mic → context-aware router.
  // No active meal → autoFill (new meal). Active meal → sendChat (correction).
  async function handleVoiceInput(blob: Blob, ext = "webm") {
    setParsing(true); setError(""); setPipeStatus("transcribing");
    if (!hasActiveMeal) pullCgm(); // background CGM only on a fresh meal
    try {
      const text = await transcribeBlob(blob, ext);
      if (!text) return;
      if (hasActiveMeal) {
        setPipeStatus("idle");
        await sendChat(text);
      } else {
        setTranscript(text);
        setPipeStatus("parsing");
        await autoFill(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally { setParsing(false); setPipeStatus("idle"); }
  }

  // Silent background compute — always kept fresh so the user just
  // "reveals" the recommendation. No network call, purely local.
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

  async function autoFill(text: string) {
    // Show the user message in the chat ("you said …") so the chat reads as a conversation
    setChatMsgs(c => [...c, { role: "user", content: text }]);
    try {
      const res  = await fetch("/api/parse-food", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text }) });
      const data = await res.json();
      const t = data.totals || {};
      if (t.carbs    != null && !carbs)    setCarbs(String(t.carbs));
      if (t.fiber    != null && !fiber)    setFiber(String(t.fiber));
      if (t.protein  != null && !protein)  setProtein(String(t.protein));
      if (t.fat      != null && !fat)      setFat(String(t.fat));
      if (t.calories != null && !calories) setCalories(String(t.calories));
      // Trust the server-provided description directly — the API now always
      // returns a clean comma-separated "<grams>g <ingredient>" list. No more
      // ad-hoc concatenation of parsed[].name.
      if (typeof data.description === "string" && data.description.trim()) {
        setDesc(data.description.trim());
      }

      // Compose a reasoning bubble with the parsed items, totals, and meal classification.
      const items: Partial<ParsedFood>[] = data.parsed || [];
      const tCarbs = t.carbs ?? 0, tProt = t.protein ?? 0, tFat = t.fat ?? 0, tFiber = t.fiber ?? 0;
      const cType = data.mealType ?? classifyMeal(tCarbs, tProt, tFat);
      const parts: string[] = [];
      if (data.summary) parts.push(data.summary);
      if (items.length) {
        parts.push("Breakdown:\n" + items.map(it => `• ${it.name} (${it.grams}g) — ${it.carbs ?? 0}g C / ${it.protein ?? 0}g P / ${it.fat ?? 0}g F`).join("\n"));
      }
      parts.push(`Totals: ${tCarbs}g carbs, ${tProt}g protein, ${tFat}g fat, ${tFiber}g fiber.`);
      parts.push(`Meal classification: ${TYPE_LABELS[cType] || cType} — based on the macro mix above (using the same rule the rest of the app uses).`);
      setChatMsgs(c => [...c, { role: "assistant", content: parts.join("\n\n") }]);
      // Mark the session as having an active meal — subsequent voice input
      // will be routed through sendChat as a correction, not a new parse.
      setHasActiveMeal(true);
    } catch {
      setChatMsgs(c => [...c, { role: "assistant", content: "⚠ Parsing failed — you can still fill the form manually, or ask me below." }]);
    }
  }

  // Auto-scroll the chat panel as new messages arrive
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
      if (!res.ok) throw new Error(data.error || "Chat failed");
      setChatMsgs(c => [...c, { role: "assistant", content: data.reply || "(no reply)" }]);
      // ATOMIC update contract: the server only sends `macros` when it also
      // sends a paired `description`. We require both before applying ANY
      // change, so the meal label can never go stale relative to its totals
      // (and the UI never blends new numbers with an old ingredient list).
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
      const msg = e instanceof Error ? e.message : "Chat failed";
      setChatMsgs(c => [...c, { role: "assistant", content: `⚠ ${msg}` }]);
    } finally { setChatBusy(false); }
  }

  // Seed the chat with an opening reasoning message after first parse
  useEffect(() => {
    if (chatMsgs.length === 0 && (transcript || desc) && (totalCarbs || totalProtein || totalFat)) {
      sendChat(`Briefly explain how you arrived at these macros for: "${desc || transcript}". Mention portion-size assumptions and any approximations.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  async function getLatestCGM(): Promise<
    | { ok: true; value: number; timestamp: string; formattedTime: string }
    | { ok: false; status: number; message: string }
  > {
    if (!supabase) return { ok: false, status: 401, message: "Session expired, please log in again." };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return { ok: false, status: 401, message: "Session expired, please log in again." };

      const res = await fetch("/api/cgm/latest", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const msg =
          res.status === 401 ? "Session expired, please log in again." :
          res.status === 404 ? "No CGM credentials configured. Go to Settings to connect LibreLinkUp." :
          res.status === 502 ? "CGM service unavailable, please try again in a minute." :
          "Could not load CGM reading.";
        return { ok: false, status: res.status, message: msg };
      }

      const data = (await res.json()) as Partial<CgmLatest>;
      const cur = data?.current;
      if (!cur || typeof cur.value !== "number" || !cur.timestamp) {
        return { ok: false, status: 502, message: "CGM service unavailable, please try again in a minute." };
      }
      const tsMs = parseLluTs(cur.timestamp);
      const formattedTime = tsMs == null
        ? cur.timestamp
        : new Date(tsMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return { ok: true, value: Math.round(cur.value), timestamp: cur.timestamp, formattedTime };
    } catch {
      return { ok: false, status: 0, message: "Could not load CGM reading." };
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
      // On silent polling, don't surface errors loudly — only show on explicit click.
      if (!opts.silent) setCgmError(res.message);
      return;
    }
    setCgmTimestamp(res.formattedTime);
    // Don't overwrite a user-entered value unless refresh was clicked
    if (opts.force || !glucoseTouched || !glucose) {
      setGlucose(String(res.value));
      setGlucoseTouched(false);
    }
    // Anchor meal_time to the CGM reading time unless the user edited it.
    if (!mealTimeDirty) setMealTime(toDatetimeLocal(res.timestamp));
  }

  // Auto-refresh every 60s while the page is mounted. Silent failures.
  useEffect(() => {
    const id = setInterval(() => { pullCgm({ silent: true }).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasAny = totalCarbs > 0 || totalProtein > 0 || totalFat > 0 || !!desc.trim();

  async function handleConfirm() {
    if (!glucoseNum || !totalCarbs || !insulinNum) { setError("Glucose, carbs and insulin are required."); return; }
    setSaving(true); setError("");
    try {
      const ev = computeEvaluation(totalCarbs, insulinNum, glucoseNum);
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
        mealType: classifyMeal(totalCarbs, totalProtein, totalFat),
        evaluation: ev,
        mealTime: mealTimeIso,
        relatedMealId: isCorrectionBolus ? relatedMealId : null,
      });
      // Auto-fill bg_1h / bg_2h from CGM history at meal_time + 1h / +2h.
      // Schedules in-tab timers + persists so a reload / new tab can rehydrate;
      // the layout-level provider also reconciles past-due slots on focus.
      try { scheduleAutoFillForMeal(saved.id, mealTimeIso); } catch { /* non-fatal */ }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:meal-saved", { detail: { id: saved.id, mealTime: mealTimeIso } }));
      }
      setSuccess(true);
      setHasActiveMeal(false);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
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
      <div style={{ fontSize:20, fontWeight:700 }}>Meal Logged!</div>
      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:14 }}>Redirecting to dashboard…</div>
    </div>
  );

  const voiceLabel = recording ? "Listening…" : speechAvail ? "Tap to speak" : "Voice unavailable";
  const pipeLabel  = pipeStatus === "transcribing" ? "Transcribing audio…" : pipeStatus === "parsing" ? "Parsing nutrition…" : null;

  return (
    <div style={{ maxWidth:1280, marginRight:"auto", display:"flex", flexDirection:"column", gap:14 }}>
      <style>{`
        @keyframes vPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes spin   { to { transform: rotate(360deg) } }
        .mic-btn:hover:not(:disabled) { transform: scale(1.04); }
        .log-grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 18px; align-items: start; }
        @media (max-width: 900px) {
          .log-grid { grid-template-columns: 1fr; }
          .log-grid .chat-col { position: static !important; max-height: 480px; }
        }
        .log-grid .chat-col { position: sticky; top: 16px; }
      `}</style>

      <div style={{ marginBottom:6 }}>
        <h1 style={{ fontSize:28, fontWeight:800, letterSpacing:"-0.03em", margin:0 }}>Glev Engine</h1>
      </div>

      <div className="log-grid">
        <div style={{ display:"flex", flexDirection:"column", gap:14, minWidth:0 }}>

      {/* 1. Voice mic card */}
      <div style={{ ...card, padding:"24px 22px 22px" }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
          <div style={{ position:"relative", width:96, height:96 }}>
            {recording && <div style={{ position:"absolute", inset:-16, borderRadius:"50%", background:`radial-gradient(circle,${ACCENT}24 0%,transparent 70%)`, animation:"vPulse 2s ease-in-out infinite", pointerEvents:"none" }}/>}
            <button
              className="mic-btn"
              onClick={() => recording ? stopRecording() : startRecording()}
              disabled={parsing || !speechAvail}
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
              e.g. "handful blueberries, small banana, 200g yogurt"
            </div>
          )}
          {!speechAvail && <div style={{ fontSize:11, color:ORANGE }}>Voice input not supported in this browser</div>}
        </div>
      </div>

      {/* 2. AI Food Parser status strip */}
      <div style={{ ...card, padding:"12px 18px", border:`1px solid rgba(79,110,247,0.18)`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color:"rgba(255,255,255,0.45)" }}>
          AI FOOD PARSER <span style={{ fontSize:8, color:ACCENT, fontWeight:500, marginLeft:4 }}>GPT-powered</span>
        </div>
        {pipeLabel ? (
          <div style={{ fontSize:11, color:ORANGE, display:"flex", alignItems:"center", gap:6, fontWeight:700, letterSpacing:"0.04em" }}>
            <div style={{ width:10, height:10, border:`1.5px solid ${ORANGE}44`, borderTopColor:ORANGE, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
            {pipeLabel}
          </div>
        ) : (
          <div style={{ fontSize:11, color:GREEN, display:"flex", alignItems:"center", gap:6, fontWeight:700, letterSpacing:"0.04em" }}>
            <div style={{ width:8, height:8, borderRadius:99, background:GREEN, boxShadow:`0 0 6px ${GREEN}88` }}/>
            READY
          </div>
        )}
      </div>

      {/* 3. Entry details */}
      <div style={{ ...card, padding:20 }}>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", marginBottom:14, textTransform:"uppercase" }}>Entry Details — edit any field</div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:6 }}>
              <label style={{ ...labelStyle, marginBottom:0 }}>Glucose Before (mg/dL)</label>
              <span style={{ fontSize:10, color: cgmFailed ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.4)", letterSpacing:"0.02em" }}>
                {cgmLoading ? "Fetching CGM…" : cgmTimestamp ? `Last reading: ${cgmTimestamp}` : cgmFailed ? "No recent data" : ""}
              </span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={glucose} onChange={e => { setGlucose(e.target.value); setGlucoseTouched(true); }} placeholder="e.g. 115" type="number" style={{ ...inp, flex:1 }}/>
              <button onClick={() => pullCgm({ force: true })} disabled={cgmLoading} title="Refresh CGM reading"
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
            <label style={labelStyle}>Meal Time</label>
            <input
              value={mealTime}
              onChange={e => { setMealTime(e.target.value); setMealTimeDirty(true); }}
              type="datetime-local"
              style={inp}
            />
            <div style={{ marginTop:4, fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.02em" }}>
              When you ate. Defaults to the latest CGM reading time — edit to backfill a past meal.
            </div>
          </div>
          {macroUpdatedAt && Date.now() - macroUpdatedAt < 6000 && (
            <div style={{ fontSize:10, color:GREEN, letterSpacing:"0.06em", fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:6, height:6, borderRadius:99, background:GREEN, boxShadow:`0 0 6px ${GREEN}88` }}/>
              UPDATED FROM LATEST CORRECTION
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, marginBottom:-4 }}>
            <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:ACCENT, padding:"3px 9px", borderRadius:99, background:`${ACCENT}14`, border:`1px solid ${ACCENT}33` }}>Manuelle Makros</span>
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.02em" }}>Carbs ist Pflicht · Kalorien werden sonst berechnet</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={labelStyle}>Carbs (g)</label>
              <input value={carbs} onChange={e => setCarbs(e.target.value)} placeholder="e.g. 60" type="number" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Fiber (g) <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>opt.</span></label>
              <input value={fiber} onChange={e => setFiber(e.target.value)} placeholder="e.g. 8" type="number" style={inp}/>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label style={labelStyle}>Protein (g)</label>
              <input value={protein} onChange={e => setProtein(e.target.value)} placeholder="e.g. 30" type="number" style={inp}/>
            </div>
            <div>
              <label style={labelStyle}>Fat (g)</label>
              <input value={fat} onChange={e => setFat(e.target.value)} placeholder="e.g. 15" type="number" style={inp}/>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Kalorien (kcal) <span style={{ opacity:0.5, textTransform:"none", fontSize:9 }}>opt. — auto-berechnet wenn leer</span></label>
            <input value={calories} onChange={e => setCalories(e.target.value)} placeholder={totalCarbs || totalProtein || totalFat ? `auto: ${computeCalories(totalCarbs, totalProtein, totalFat)}` : "e.g. 520"} type="number" style={inp}/>
          </div>
          <div>
            <label style={labelStyle}>Meal Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. granola, banana, yogurt…" style={{ ...inp, fontSize:13 }}/>
          </div>
          <div>
            <label style={labelStyle}>Meal Classification</label>
            {(() => {
              const hasMacros = totalCarbs > 0 || totalProtein > 0 || totalFat > 0;
              const t = hasMacros ? classifyMeal(totalCarbs, totalProtein, totalFat) : null;
              const color = t ? (TYPE_COLORS[t] || ACCENT) : "rgba(255,255,255,0.3)";
              const label = t ? (TYPE_LABELS[t] || t) : "Auto from macros";
              return (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", borderRadius:10, background:t ? `${color}14` : "rgba(255,255,255,0.03)", border:`1px solid ${t ? `${color}55` : "rgba(255,255,255,0.08)"}` }}>
                  <div style={{ width:8, height:8, borderRadius:99, background:color, boxShadow:t ? `0 0 6px ${color}88` : "none" }}/>
                  <span style={{ fontSize:13, fontWeight:700, color:t ? color : "rgba(255,255,255,0.4)", letterSpacing:"-0.01em" }}>{label}</span>
                  {t && <span style={{ marginLeft:"auto", fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.04em" }}>auto</span>}
                </div>
              );
            })()}
          </div>

          <div>
            <label style={labelStyle}>Insulin (u)</label>
            <input value={insulin} onChange={e => setInsulin(e.target.value)} placeholder="e.g. 1.5" type="number" step="0.5" style={inp}/>
          </div>

          {/* CORRECTION-BOLUS TAG — only surfaces when a positive insulin dose
              is entered. Tagging links this dose to a parent meal so the
              engine can tell "primary meal coverage" from "later correction"
              when learning ICR. Self-FK; column added by 20260426 migration. */}
          {insulinNum != null && insulinNum > 0 && (
            <div style={{ background:`${ACCENT}08`, border:`1px solid ${ACCENT}30`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap: isCorrectionBolus ? 10 : 0 }}>
              <label style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", gap:12 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"#fff" }}>Korrektur-Bolus?</span>
                  <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.45)", lineHeight:1.4 }}>
                    Diese Dosis korrigiert eine vorherige Mahlzeit (statt sie zu begleiten).
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
                    Welche Mahlzeit korrigieren?
                  </div>
                  {recentMeals.length === 0 ? (
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", padding:"8px 0", fontStyle:"italic" }}>
                      Keine Mahlzeit in den letzten 6 Stunden.
                    </div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto" }}>
                      {recentMeals.map(rm => {
                        const t = new Date(rm.meal_time ?? rm.created_at);
                        const timeStr = t.toLocaleTimeString("de-DE", { hour:"2-digit", minute:"2-digit" });
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

          {error && <div style={{ fontSize:12, color:PINK, padding:"8px 12px", background:`${PINK}10`, borderRadius:8, border:`1px solid ${PINK}25` }}>{error}</div>}

          <button onClick={handleConfirm} disabled={saving || !glucose || !carbs || !insulin}
            style={{ marginTop:4, padding:"14px", borderRadius:12, border:"none",
              background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff",
              fontSize:14, fontWeight:700, letterSpacing:"-0.01em",
              cursor: (saving || !glucose || !carbs || !insulin) ? "default" : "pointer",
              opacity: (glucose && carbs && insulin && !saving) ? 1 : 0.4,
              transition:"opacity 0.2s",
            }}>
            {saving ? "Saving…" : "✓ Confirm Log"}
          </button>

          <button
            onClick={() => {
              if (saving) return;
              const dirty = hasAny || transcript.trim() || glucose || insulin;
              if (dirty && !window.confirm("Discard this entry? All inputs will be cleared.")) return;
              resetForm();
            }}
            disabled={saving}
            style={{ padding:"12px", borderRadius:12, border:`1px solid rgba(255,255,255,0.08)`, background:"transparent",
              color: saving ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.55)", fontSize:13, fontWeight:600,
              cursor: saving ? "not-allowed" : "pointer", transition:"all 0.2s" }}>
            Cancel
          </button>
        </div>
      </div>

        </div>{/* /left col */}

        {/* RIGHT COL: GPT reasoning chat */}
        <div className="chat-col" style={{ ...card, padding:0, display:"flex", flexDirection:"column", height:"calc(100vh - 140px)", maxHeight:760, minHeight:420, overflow:"hidden" }}>
          <div style={{ padding:"14px 18px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", color:"#fff", textTransform:"uppercase" }}>GPT Reasoning</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:2 }}>See why these macros were chosen — or correct them</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:99, background: chatBusy ? ORANGE : GREEN, boxShadow:`0 0 6px ${chatBusy ? ORANGE : GREEN}88` }}/>
              <span style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:700 }}>{chatBusy ? "THINKING" : "READY"}</span>
            </div>
          </div>

          <div ref={chatScrollRef} style={{ flex:1, overflowY:"auto", padding:"14px 18px", display:"flex", flexDirection:"column", gap:10 }}>
            {chatMsgs.length === 0 && !chatBusy && (
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:12, textAlign:"center", padding:"24px 8px", lineHeight:1.6 }}>
                Once you log a meal (voice or text), GPT will explain how it
                broke down the macros here. You can ask follow-ups or push
                back — corrections you confirm are applied to the form on
                the left.
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
                      {isUser ? "You" : "GPT"}
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
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:"10px 12px", borderTop:`1px solid ${BORDER}`, display:"flex", gap:8 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="Ask or correct… e.g. 'the banana was bigger'"
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
            >Send</button>
          </div>
        </div>

      </div>{/* /grid */}
    </div>
  );
}
