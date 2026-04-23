"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveMeal, classifyMeal, computeEvaluation, computeCalories, type ParsedFood } from "@/lib/meals";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

export default function LogPage() {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [parsing, setParsing]     = useState(false);
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

  // Food parser test panel (mockup)
  const [pfLoading, setPfLoading] = useState(false);
  const [pfRaw, setPfRaw]         = useState<string | null>(null);
  const [pfParsed, setPfParsed]   = useState<ParsedFood[] | null>(null);
  const [pfError, setPfError]     = useState<string | null>(null);

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
    setPfLoading(false); setPfRaw(null); setPfParsed(null); setPfError(null);
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
    setParsing(true); setError("");
    try {
      const fd = new FormData();
      fd.append("audio", blob, `voice.${ext}`);
      const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
      const tData = await tRes.json();
      if (!tRes.ok || !tData.text) throw new Error(tData.error || "Empty transcript");
      const text = tData.text as string;
      setTranscript(text);
      await autoFill(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally { setParsing(false); }
  }

  async function autoFill(text: string) {
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
    } catch { /* keep transcript even if parse fails */ }
  }

  async function testFoodParser() {
    const text = "small banana and handful blueberries";
    setPfLoading(true); setPfRaw(null); setPfParsed(null); setPfError(null);
    try {
      const res  = await fetch("/api/parse-food", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setPfRaw(text);
      setPfParsed((data.parsed || []).map((f: Partial<ParsedFood>) => ({
        name: f.name || "", grams: f.grams || 0,
        carbs: f.carbs || 0, protein: f.protein || 0, fat: f.fat || 0, fiber: f.fiber || 0,
      })));
    } catch (e) {
      setPfError(e instanceof Error ? e.message : "Request failed");
    } finally { setPfLoading(false); }
  }

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

  const voiceLabel = recording ? "Listening…" : parsing ? "Parsing…" : speechAvail ? "Tap to speak" : "Voice unavailable";

  return (
    <div style={{ maxWidth:560, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      <style>{`
        @keyframes vPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes spin   { to { transform: rotate(360deg) } }
        .mic-btn:hover:not(:disabled) { transform: scale(1.04); }
      `}</style>

      <div style={{ marginBottom:6 }}>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.14em", marginBottom:6 }}>GLEV — SMART INSULIN DECISIONS</div>
        <h1 style={{ fontSize:28, fontWeight:800, letterSpacing:"-0.03em", margin:0 }}>Log</h1>
      </div>

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
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color: recording ? ACCENT : parsing ? ORANGE : "rgba(255,255,255,0.45)" }}>
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

      {/* 2. AI Food Parser test panel */}
      <div style={{ ...card, padding:"14px 18px", border:`1px solid rgba(79,110,247,0.18)` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", color:"rgba(255,255,255,0.45)" }}>
              AI FOOD PARSER <span style={{ fontSize:8, color:ACCENT, fontWeight:500, marginLeft:4 }}>GPT-powered · test</span>
            </div>
            {!pfRaw && !pfError && (
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.22)" }}>Sends "small banana and handful blueberries"</div>
            )}
          </div>
          <button
            onClick={testFoodParser}
            disabled={pfLoading}
            style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${ACCENT}44`, background:pfLoading ? "rgba(255,255,255,0.04)" : `${ACCENT}22`, color: pfLoading ? "rgba(255,255,255,0.3)" : ACCENT, fontSize:11, fontWeight:700, letterSpacing:"0.04em", cursor: pfLoading ? "default" : "pointer", display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap", flexShrink:0 }}
          >
            {pfLoading ? <><div style={{ width:10, height:10, border:`1.5px solid ${ACCENT}44`, borderTopColor:ACCENT, borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>Parsing…</> : "Test Food Parser"}
          </button>
        </div>
        {pfError && (
          <div style={{ marginTop:10, fontSize:11, color:PINK, padding:"8px 10px", background:`${PINK}10`, borderRadius:8, border:`1px solid ${PINK}25` }}>{pfError}</div>
        )}
        {pfRaw && pfParsed && pfParsed.length > 0 && (
          <div style={{ marginTop:10, padding:"8px 10px", background:`${GREEN}08`, borderRadius:8, border:`1px solid ${GREEN}22` }}>
            <div style={{ fontSize:9, color:GREEN, letterSpacing:"0.06em", fontWeight:700, marginBottom:6 }}>PARSED FOODS</div>
            {pfParsed.map((item, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom: i < pfParsed.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.75)" }}>{item.name}</span>
                <span style={{ fontSize:12, fontWeight:700, color:ACCENT }}>{item.grams}g</span>
              </div>
            ))}
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
            <label style={labelStyle}>Insulin (u)</label>
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
    </div>
  );
}
