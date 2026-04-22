"use client";

import { useState, useRef, useEffect } from "react";
import { saveMeal, type ParsedFood } from "@/lib/meals";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const ORANGE  = "#FF9500";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10, padding: "11px 14px", color: "white", fontSize: 14,
  width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit",
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, ...style }}>{children}</div>;
}

function Spinner({ size = 14, color = "white" }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid ${color}40`, borderTopColor: color,
      borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0,
    }}/>
  );
}

function computeEvaluation(totalGrams: number, insulinUnits: number, glucoseBefore: number | null): string {
  const icr = 15;
  const correctionFactor = 50;
  const targetGlucose = 110;
  let estimated = totalGrams / icr;
  if (glucoseBefore && glucoseBefore > targetGlucose) {
    estimated += (glucoseBefore - targetGlucose) / correctionFactor;
  }
  const ratio = insulinUnits / Math.max(estimated, 0.1);
  if (ratio > 1.35) return "OVERDOSE";
  if (ratio < 0.65) return "UNDERDOSE";
  return "GOOD";
}

interface EditableFood extends ParsedFood { editing: boolean; draft: string; }

export default function LogPage() {
  const [glucoseBefore, setGlucoseBefore] = useState("");
  const [mealText, setMealText]           = useState("");
  const [recording, setRecording]         = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [analyzing, setAnalyzing]         = useState(false);
  const [parsed, setParsed]               = useState<EditableFood[] | null>(null);
  const [parseError, setParseError]       = useState<string | null>(null);
  const [insulinUnits, setInsulinUnits]   = useState("");
  const [saving, setSaving]               = useState(false);
  const [saveError, setSaveError]         = useState<string | null>(null);
  const [saved, setSaved]                 = useState(false);

  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setVoiceSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function toggleVoice() {
    const w = window as unknown as Record<string, unknown>;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (recording) {
      (recognitionRef.current as { stop: () => void } | null)?.stop();
      setRecording(false);
      return;
    }
    const recognition = new (SR as new () => {
      lang: string; interimResults: boolean; maxAlternatives: number;
      onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    })();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setMealText(prev => prev ? `${prev} ${transcript}` : transcript);
    };
    recognition.onend  = () => setRecording(false);
    recognition.onerror = () => setRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
  }

  async function analyzeMeal() {
    if (!mealText.trim()) return;
    setAnalyzing(true);
    setParsed(null);
    setParseError(null);
    setSaveError(null);
    try {
      const res  = await fetch("/api/parse-food", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: mealText }),
      });
      const json = await res.json() as { parsed?: ParsedFood[]; error?: string };
      if (!res.ok) { setParseError(json.error ?? `HTTP ${res.status}`); return; }
      const items = Array.isArray(json.parsed) ? json.parsed : [];
      setParsed(items.map(f => ({ ...f, editing: false, draft: String(f.grams) })));
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  function commitGrams(idx: number) {
    setParsed(prev => prev
      ? prev.map((f, i) => i === idx ? { ...f, grams: Math.max(1, parseInt(f.draft) || f.grams), editing: false } : f)
      : prev
    );
  }

  function removeFood(idx: number) {
    setParsed(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
  }

  function addFood() {
    setParsed(prev => {
      const newItem: EditableFood = { name: "New item", grams: 100, editing: true, draft: "100" };
      return prev ? [...prev, newItem] : [newItem];
    });
  }

  const totalGrams      = parsed ? parsed.reduce((s, f) => s + f.grams, 0) : 0;
  const insulinNum      = parseFloat(insulinUnits) || 0;
  const glucoseNum      = parseFloat(glucoseBefore) || null;
  const estimatedInsulin = totalGrams > 0
    ? totalGrams / 15 + (glucoseNum && glucoseNum > 110 ? (glucoseNum - 110) / 50 : 0)
    : 0;
  const evaluation = parsed && insulinNum > 0 && totalGrams > 0
    ? computeEvaluation(totalGrams, insulinNum, glucoseNum)
    : null;
  const evalColor = evaluation === "GOOD" ? GREEN : evaluation === "OVERDOSE" ? PINK : ORANGE;
  const evalLabel = evaluation === "GOOD" ? "Dose looks appropriate"
    : evaluation === "OVERDOSE" ? "Insulin may be too high"
    : evaluation === "UNDERDOSE" ? "Insulin may be too low"
    : null;

  async function saveEntry() {
    if (!parsed) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveMeal({
        inputText: mealText,
        parsedJson: parsed.map(({ name, grams }) => ({ name, grams })),
        glucoseBefore: glucoseNum,
        carbsGrams: totalGrams,
        insulinUnits: insulinNum > 0 ? insulinNum : null,
        evaluation,
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false); setMealText(""); setParsed(null);
        setGlucoseBefore(""); setInsulinUnits(""); setSaveError(null);
      }, 2000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420, gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 99, background: `${GREEN}18`, border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: GREEN }}>Entry saved</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Your meal has been logged</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Log Meal</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Describe your meal — AI parses the foods, you enter your insulin dose</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        <Card style={{ padding: 20 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", marginBottom: 10 }}>
            BLOOD GLUCOSE BEFORE <span style={{ color: "rgba(255,255,255,0.2)" }}>(mg/dL)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="number" value={glucoseBefore}
              onChange={e => setGlucoseBefore(e.target.value)}
              placeholder="e.g. 110" min={40} max={400}
              style={{ ...inp, maxWidth: 150 }}
            />
            {glucoseNum && (
              <div style={{
                fontSize: 12, padding: "5px 12px", borderRadius: 99, fontWeight: 600,
                background: glucoseNum < 70 ? `${PINK}18` : glucoseNum > 180 ? `${ORANGE}18` : `${GREEN}18`,
                color: glucoseNum < 70 ? PINK : glucoseNum > 180 ? ORANGE : GREEN,
                border: `1px solid ${glucoseNum < 70 ? PINK : glucoseNum > 180 ? ORANGE : GREEN}33`,
              }}>
                {glucoseNum < 70 ? "⚠ Low" : glucoseNum > 180 ? "⚠ High" : "✓ In range"}
              </div>
            )}
          </div>
        </Card>

        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>MEAL DESCRIPTION</div>
            {voiceSupported && (
              <button onClick={toggleVoice} title={recording ? "Stop recording" : "Voice input"} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                background: recording ? `${PINK}18` : "rgba(255,255,255,0.07)",
                color: recording ? PINK : "rgba(255,255,255,0.5)",
                fontSize: 11, fontWeight: 600, transition: "all 0.15s",
              }}>
                {recording ? (
                  <>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: PINK, animation: "pulse 1s ease-in-out infinite" }}/>
                    Stop
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                    Voice
                  </>
                )}
              </button>
            )}
          </div>
          <textarea
            value={mealText} onChange={e => setMealText(e.target.value)}
            placeholder="e.g. large bowl of oatmeal with banana, handful of blueberries and a tablespoon of peanut butter"
            rows={4}
            style={{ ...inp, resize: "vertical", lineHeight: 1.6, fontSize: 13 }}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyzeMeal(); }}
          />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>⌘ + Enter to analyze</div>
        </Card>

        <button onClick={analyzeMeal} disabled={analyzing || !mealText.trim()} style={{
          padding: "13px", border: "none", borderRadius: 12,
          cursor: analyzing || !mealText.trim() ? "default" : "pointer",
          background: analyzing || !mealText.trim() ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          color: analyzing || !mealText.trim() ? "rgba(255,255,255,0.3)" : "white",
          fontSize: 14, fontWeight: 700, transition: "all 0.15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
        }}>
          {analyzing ? <><Spinner />Analyzing meal…</> : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Parse with AI
            </>
          )}
        </button>

        {parseError && (
          <div style={{ fontSize: 13, color: PINK, padding: "11px 14px", background: `${PINK}0E`, borderRadius: 10, border: `1px solid ${PINK}25` }}>
            {parseError}
          </div>
        )}

        {parsed && (
          <Card style={{ padding: 20, border: `1px solid ${GREEN}20` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: 99, background: GREEN }}/>
                <span style={{ fontSize: 11, color: GREEN, fontWeight: 700, letterSpacing: "0.08em" }}>PARSED FOODS</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{parsed.length} items</span>
                <button onClick={addFood} style={{
                  width: 24, height: 24, borderRadius: 99, border: `1px solid rgba(255,255,255,0.15)`,
                  background: "rgba(255,255,255,0.06)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)",
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </div>
            </div>

            {parsed.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "16px 0" }}>
                No items detected — try being more specific, or add one manually
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 16 }}>
                {parsed.map((item, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9,
                    background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: 99, background: `${ACCENT}80`, flexShrink: 0 }}/>
                    <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{item.name}</span>
                    {item.editing ? (
                      <input
                        type="number" value={item.draft} autoFocus
                        onChange={e => setParsed(prev => prev ? prev.map((f, j) => j === i ? { ...f, draft: e.target.value } : f) : prev)}
                        onBlur={() => commitGrams(i)}
                        onKeyDown={e => { if (e.key === "Enter") commitGrams(i); }}
                        style={{ width: 72, padding: "4px 8px", background: "rgba(255,255,255,0.1)", border: `1px solid ${ACCENT}60`, borderRadius: 7, color: "white", fontSize: 13, fontWeight: 700, outline: "none", fontFamily: "inherit" }}
                      />
                    ) : (
                      <button
                        onClick={() => setParsed(prev => prev ? prev.map((f, j) => j === i ? { ...f, editing: true, draft: String(f.grams) } : f) : prev)}
                        style={{ background: `${ACCENT}15`, border: `1px solid ${ACCENT}25`, borderRadius: 7, padding: "4px 10px", color: ACCENT, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                        title="Click to edit grams"
                      >
                        {item.grams}g
                      </button>
                    )}
                    <button onClick={() => removeFood(i)} style={{ width: 22, height: 22, borderRadius: 99, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, letterSpacing: "0.06em" }}>TOTAL WEIGHT</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>
                    {totalGrams}<span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>g</span>
                  </div>
                </div>
                {estimatedInsulin > 0 && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4, letterSpacing: "0.06em" }}>SUGGESTED DOSE</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: ACCENT }}>
                      ~{estimatedInsulin.toFixed(1)}<span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>u</span>
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>1:15 ICR</div>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", marginBottom: 8 }}>
                  INSULIN TAKEN <span style={{ color: "rgba(255,255,255,0.2)" }}>(units)</span>
                </div>
                <input
                  type="number" value={insulinUnits}
                  onChange={e => setInsulinUnits(e.target.value)}
                  placeholder="e.g. 4.5" step="0.5" min={0} max={50}
                  style={{ ...inp, maxWidth: 160 }}
                />
              </div>

              {evaluation && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                  background: `${evalColor}0E`, borderRadius: 10, border: `1px solid ${evalColor}25`, marginBottom: 14,
                }}>
                  <div style={{ width: 9, height: 9, borderRadius: 99, background: evalColor, flexShrink: 0 }}/>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: evalColor, letterSpacing: "0.05em" }}>{evaluation}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{evalLabel}</div>
                  </div>
                </div>
              )}

              {saveError && (
                <div style={{ fontSize: 13, color: PINK, padding: "10px 12px", background: `${PINK}0E`, borderRadius: 9, border: `1px solid ${PINK}25`, marginBottom: 12 }}>
                  {saveError}
                </div>
              )}

              <button onClick={saveEntry} disabled={saving || parsed.length === 0} style={{
                width: "100%", padding: "13px",
                border: saving || parsed.length === 0 ? "1px solid rgba(255,255,255,0.1)" : `1px solid ${GREEN}40`,
                borderRadius: 11, cursor: saving || parsed.length === 0 ? "default" : "pointer",
                background: saving || parsed.length === 0 ? "rgba(255,255,255,0.04)" : `${GREEN}18`,
                color: saving || parsed.length === 0 ? "rgba(255,255,255,0.25)" : GREEN,
                fontSize: 14, fontWeight: 700, transition: "all 0.15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              }}>
                {saving ? <><Spinner color={GREEN} />Saving…</> : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Save Entry
                  </>
                )}
              </button>
            </div>
          </Card>
        )}
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
      `}</style>
    </div>
  );
}
