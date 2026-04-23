"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveMeal, classifyMeal, computeEvaluation, computeCalories, fetchMeals, type ParsedFood, type Meal } from "@/lib/meals";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

const TYPE_COLORS: Record<string, string> = { FAST_CARBS: ORANGE, HIGH_PROTEIN: ACCENT, HIGH_FAT: "#A855F7", BALANCED: GREEN };
const TYPE_LABELS: Record<string, string> = { FAST_CARBS: "Fast Carbs", HIGH_PROTEIN: "High Protein", HIGH_FAT: "High Fat", BALANCED: "Balanced" };
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

export default function LogPage() {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [pipeStatus, setPipeStatus] = useState<"idle" | "transcribing" | "parsing">("idle");
  const [transcript, setTranscript] = useState("");

  // Entry-details fields (mockup 1:1)
  const [glucose, setGlucose]   = useState("");
  const [carbs, setCarbs]       = useState("");
  const [fiber, setFiber]       = useState("");
  const [protein, setProtein]   = useState("");
  const [fat, setFat]           = useState("");
  const [desc, setDesc]         = useState("");
  const [insulin, setInsulin]   = useState("");

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState(false);
  const [speechAvail, setSpeechAvail] = useState(true);
  const [cgmLoading, setCgmLoading] = useState(false);

  // Glev Engine recommendation
  const [meals, setMeals] = useState<Meal[]>([]);
  const [rec, setRec]     = useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);

  useEffect(() => { fetchMeals().then(setMeals).catch(console.error); }, []);

  // GPT reasoning chat panel
  type ChatMsg = { role: "user" | "assistant" | "system"; content: string };
  const [chatMsgs, setChatMsgs]   = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
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
    setRecording(false); setParsing(false); setTranscript("");
    setGlucose(""); setCarbs(""); setFiber(""); setProtein(""); setFat(""); setDesc(""); setInsulin("");
    setSaving(false); setError(""); setSuccess(false);
    setChatMsgs([]); setChatInput(""); setPipeStatus("idle");
    setRec(null); setRecLoading(false);
    try { mediaRecRef.current?.stop(); } catch {}
  }

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
        await transcribeAndParse(blob, ext);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true); setTranscript("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access microphone.");
      setRecording(false);
    }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    setRecording(false);
  }

  async function transcribeAndParse(blob: Blob, ext = "webm") {
    setParsing(true); setError(""); setPipeStatus("transcribing");
    try {
      const fd = new FormData();
      fd.append("audio", blob, `voice.${ext}`);
      const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
      const tData = await tRes.json();
      if (!tRes.ok || !tData.text) throw new Error(tData.error || "Empty transcript");
      const text = tData.text as string;
      setTranscript(text);
      setPipeStatus("parsing");
      await autoFill(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally { setParsing(false); setPipeStatus("idle"); }
  }

  function runRecommendation() {
    const g = num(glucose) ?? 110;
    const c = num(carbs);
    if (!c) { setError("Carbs are required to get a recommendation."); return; }
    setError(""); setRecLoading(true);
    setTimeout(() => {
      const r = runGlevEngine(meals, g, c);
      setRec(r);
      if (!insulin) setInsulin(String(r.dose));
      setRecLoading(false);
    }, 350);
  }

  async function autoFill(text: string) {
    // Show the user message in the chat ("you said …") so the chat reads as a conversation
    setChatMsgs(c => [...c, { role: "user", content: text }]);
    try {
      const res  = await fetch("/api/parse-food", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text }) });
      const data = await res.json();
      const t = data.totals || {};
      if (t.carbs   != null && !carbs)   setCarbs(String(t.carbs));
      if (t.fiber   != null && !fiber)   setFiber(String(t.fiber));
      if (t.protein != null && !protein) setProtein(String(t.protein));
      if (t.fat     != null && !fat)     setFat(String(t.fat));
      if (!desc) {
        const names = (data.parsed || []).map((f: Partial<ParsedFood>) => f.name).filter(Boolean).join(", ");
        if (names) setDesc(names);
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
      if (data.macros) {
        if (data.macros.carbs   != null) setCarbs(String(data.macros.carbs));
        if (data.macros.protein != null) setProtein(String(data.macros.protein));
        if (data.macros.fat     != null) setFat(String(data.macros.fat));
        if (data.macros.fiber   != null) setFiber(String(data.macros.fiber));
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

  async function pullCgm() {
    setCgmLoading(true); setError("");
    await new Promise(r => setTimeout(r, 500 + Math.random() * 700));
    setGlucose(String(Math.round(80 + Math.random() * 80)));
    setCgmLoading(false);
  }

  const hasAny = totalCarbs > 0 || totalProtein > 0 || totalFat > 0 || !!desc.trim();

  async function handleConfirm() {
    if (!glucoseNum || !totalCarbs || !insulinNum) { setError("Glucose, carbs and insulin are required."); return; }
    setSaving(true); setError("");
    try {
      const ev = computeEvaluation(totalCarbs, insulinNum, glucoseNum);
      await saveMeal({
        inputText: desc || transcript || "Manual entry",
        parsedJson: [],
        glucoseBefore: glucoseNum, glucoseAfter: null,
        carbsGrams: totalCarbs,
        proteinGrams: totalProtein,
        fatGrams: totalFat,
        fiberGrams: totalFiber,
        calories: computeCalories(totalCarbs, totalProtein, totalFat),
        insulinUnits: insulinNum,
        mealType: classifyMeal(totalCarbs, totalProtein, totalFat),
        evaluation: ev,
      });
      setSuccess(true);
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
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.14em", marginBottom:6 }}>GLEV — SMART INSULIN DECISIONS</div>
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
              onClick={recording ? stopRecording : startRecording}
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
            <label style={labelStyle}>Glucose Before (mg/dL)</label>
            <div style={{ display:"flex", gap:8 }}>
              <input value={glucose} onChange={e => setGlucose(e.target.value)} placeholder="e.g. 115" type="number" style={{ ...inp, flex:1 }}/>
              <button onClick={pullCgm} disabled={cgmLoading} title="Pull simulated CGM reading"
                style={{ padding:"0 14px", borderRadius:10, border:`1px solid ${ACCENT}44`, background: cgmLoading ? "rgba(255,255,255,0.04)" : `${ACCENT}18`, color:ACCENT, cursor: cgmLoading ? "default" : "pointer", fontSize:11, fontWeight:700, whiteSpace:"nowrap", letterSpacing:"0.04em", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:GREEN, boxShadow:`0 0 5px ${GREEN}88`, flexShrink:0 }}/>
                {cgmLoading ? <div style={{ width:10, height:10, border:`1.5px solid ${ACCENT}44`, borderTopColor:ACCENT, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M15 6l6 6-6 6"/></svg>}
                CGM
              </button>
            </div>
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
          {/* GET RECOMMENDATION button */}
          <button
            onClick={runRecommendation}
            disabled={!num(carbs) || recLoading}
            style={{
              padding:"14px", borderRadius:12, border:"none",
              background: num(carbs) ? `linear-gradient(135deg, ${ACCENT}, #6B8BFF)` : "rgba(255,255,255,0.05)",
              color: num(carbs) ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize:14, fontWeight:700, letterSpacing:"-0.01em",
              cursor: num(carbs) && !recLoading ? "pointer" : "not-allowed",
              boxShadow: num(carbs) ? `0 4px 20px ${ACCENT}40` : "none",
              transition:"all 0.2s",
            }}
          >
            {recLoading ? "Analyzing history…" : rec ? "↻ Re-run Recommendation" : "Get Recommendation"}
          </button>

          {/* Recommendation result card (Glev Engine style) */}
          {rec && (() => {
            const gNum = num(glucose) ?? 110;
            const cNum = num(carbs) ?? 0;
            const conf = CONF_COLOR[rec.confidence];
            return (
              <div style={{ display:"flex", flexDirection:"column", gap:14, marginTop:4 }}>
                {/* Input summary */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div style={{ background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:12, padding:"12px 16px" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:4 }}>Input Glucose</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                      <span style={{ fontSize:24, fontWeight:800, color:"#60A5FA", letterSpacing:"-0.02em" }}>{gNum}</span>
                      <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>mg/dL</span>
                    </div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{gNum > 140 ? "elevated" : gNum < 80 ? "low" : "in target"}</div>
                  </div>
                  <div style={{ background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:12, padding:"12px 16px" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:4 }}>Input Carbs</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                      <span style={{ fontSize:24, fontWeight:800, color:ORANGE, letterSpacing:"-0.02em" }}>{cNum}</span>
                      <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>g</span>
                    </div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{cNum >= 60 ? "high-carb meal" : cNum >= 30 ? "moderate" : "light"}</div>
                  </div>
                </div>

                {/* Main result */}
                <div style={{ background:"#0D0D12", border:`1px solid ${conf}30`, borderRadius:14, padding:"22px 22px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
                    <div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Recommended Dose</div>
                      <div style={{ fontSize:48, fontWeight:900, letterSpacing:"-0.04em", lineHeight:1, color:"#fff" }}>
                        {rec.dose}<span style={{ fontSize:16, fontWeight:400, color:"rgba(255,255,255,0.4)", marginLeft:5 }}>units</span>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:6 }}>Confidence</div>
                      <span style={{ padding:"6px 16px", borderRadius:99, fontSize:12, fontWeight:700, background:`${conf}18`, color:conf, border:`1px solid ${conf}40` }}>{rec.confidence}</span>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:5 }}>{rec.source === "historical" ? "Historical data" : rec.source === "blended" ? "Blended model" : "ICR formula"}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:16, padding:"12px 14px", background:"rgba(0,0,0,0.3)", borderRadius:10 }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginBottom:4, letterSpacing:"0.05em", textTransform:"uppercase" }}>Reasoning</div>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.6 }}>{rec.reasoning}</div>
                  </div>
                  <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                    {[
                      { label:"Carb Dose", val:`${rec.carbDose}u`, sub:`${cNum}g ÷ 15 ICR`, color:ORANGE },
                      { label:"Correction", val:`+${rec.correctionDose}u`, sub:`(BG - 110) ÷ 50`, color:ACCENT },
                      { label:"Total", val:`${rec.dose}u`, sub:"recommended", color:GREEN },
                    ].map(d => (
                      <div key={d.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", textAlign:"center" }}>
                        <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginBottom:3 }}>{d.label}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:d.color }}>{d.val}</div>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.2)", marginTop:1 }}>{d.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reference meals */}
                {rec.similarMeals.length > 0 && (
                  <div style={{ background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
                    <div style={{ padding:"12px 16px", borderBottom:`1px solid ${BORDER}` }}>
                      <div style={{ fontSize:12, fontWeight:600 }}>Reference Meals ({rec.similarMeals.length})</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginTop:2 }}>Historical meals used in this recommendation</div>
                    </div>
                    {rec.similarMeals.map(m => {
                      const date = new Date(m.created_at).toLocaleDateString("en", { month:"short", day:"numeric" });
                      return (
                        <div key={m.id} style={{ padding:"10px 16px", borderBottom:`1px solid ${BORDER}`, display:"grid", gridTemplateColumns:"1fr 50px 50px 60px 70px", gap:10, alignItems:"center", fontSize:11 }}>
                          <div style={{ color:"rgba(255,255,255,0.65)" }}>{m.input_text.length > 38 ? m.input_text.slice(0, 38) + "…" : m.input_text}</div>
                          <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.glucose_before}</div>
                          <div style={{ color:"rgba(255,255,255,0.35)", textAlign:"right" }}>{m.carbs_grams}g</div>
                          <div style={{ textAlign:"right" }}>{m.insulin_units}u</div>
                          <div style={{ textAlign:"right" }}><span style={{ padding:"2px 7px", borderRadius:99, fontSize:9, fontWeight:700, background:`${GREEN}18`, color:GREEN, border:`1px solid ${GREEN}30` }}>{date}</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ padding:"12px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:`1px solid ${BORDER}` }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", lineHeight:1.6 }}>
                    <strong style={{ color:"rgba(255,255,255,0.4)" }}>Important:</strong> Glev Engine provides decision support only. Always consult your endocrinologist before adjusting insulin doses. This tool is not a medical device.
                  </div>
                </div>
              </div>
            );
          })()}

          <div>
            <label style={labelStyle}>Insulin (u){rec && <span style={{ marginLeft:8, fontSize:10, color:GREEN, fontWeight:700, letterSpacing:"0.04em" }}>· auto-filled from recommendation</span>}</label>
            <input value={insulin} onChange={e => setInsulin(e.target.value)} placeholder="e.g. 1.5" type="number" step="0.5" style={inp}/>
          </div>

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
