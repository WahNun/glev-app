"use client";

import { useState } from "react";
import { useEntries } from "@/context/EntriesContext";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

interface ParsedFood { name: string; grams: number; }

const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10, padding: "10px 13px", color: "white", fontSize: 14,
  width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit",
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, ...style }}>{children}</div>;
}

export default function LogPage() {
  const { addEntry } = useEntries();
  const [mealText, setMealText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [parsed, setParsed] = useState<ParsedFood[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function analyzeMeal() {
    if (!mealText.trim()) return;
    setAnalyzing(true);
    setParsed(null);
    setParseError(null);
    try {
      const res = await fetch("/api/parse-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: mealText }),
      });
      const json = await res.json();
      if (!res.ok) { setParseError(json.error ?? `HTTP ${res.status}`); return; }
      const items: ParsedFood[] = Array.isArray(json.parsed) ? json.parsed : [];
      setParsed(items);
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  function saveEntry() {
    if (!parsed) return;
    addEntry(mealText, parsed);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      setMealText("");
      setParsed(null);
    }, 1800);
  }

  if (saved) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 16 }}>
        <div style={{ width: 60, height: 60, borderRadius: 99, background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 28, color: GREEN }}>✓</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>Entry saved</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Added to your log</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Log Meal</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Describe your meal and let AI parse the nutrition</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", marginBottom: 10 }}>MEAL DESCRIPTION</div>
          <textarea
            value={mealText}
            onChange={e => setMealText(e.target.value)}
            placeholder="e.g. large bowl of oatmeal with banana, handful of blueberries and a tablespoon of peanut butter"
            rows={4}
            style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontSize: 13 }}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyzeMeal(); }}
          />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 6 }}>⌘ + Enter to analyze</div>
        </Card>

        <button
          onClick={analyzeMeal}
          disabled={analyzing || !mealText.trim()}
          style={{
            padding: "13px", border: "none", borderRadius: 12, cursor: analyzing || !mealText.trim() ? "default" : "pointer",
            background: analyzing || !mealText.trim() ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
            color: analyzing || !mealText.trim() ? "rgba(255,255,255,0.3)" : "white",
            fontSize: 14, fontWeight: 700, transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {analyzing ? (
            <>
              <div style={{ width: 14, height: 14, border: `2px solid rgba(255,255,255,0.3)`, borderTopColor: "white", borderRadius: "50%", animation: "spin 0.7s linear infinite" }}/>
              Analyzing…
            </>
          ) : "Analyze Meal"}
        </button>

        {parseError && (
          <div style={{ fontSize: 12, color: PINK, padding: "10px 14px", background: `${PINK}0D`, borderRadius: 10, border: `1px solid ${PINK}22` }}>
            {parseError}
          </div>
        )}

        {parsed && (
          <Card style={{ padding: 20, border: `1px solid ${GREEN}22` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, letterSpacing: "0.08em" }}>◈ PARSED FOODS</div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{parsed.length} items</span>
            </div>

            {parsed.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "12px 0" }}>
                No food items detected — try being more specific
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 16 }}>
                  {parsed.map((item, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "9px 12px", borderRadius: 9,
                      background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                    }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{item.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{item.grams}g</span>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                      Estimated total: <strong style={{ color: "rgba(255,255,255,0.7)" }}>{parsed.reduce((s, f) => s + f.grams, 0)}g</strong>
                    </div>
                  </div>
                  <button
                    onClick={saveEntry}
                    style={{
                      width: "100%", padding: "12px", border: `1px solid ${GREEN}33`, borderRadius: 11, cursor: "pointer",
                      background: `${GREEN}22`, color: GREEN, fontSize: 14, fontWeight: 700,
                      transition: "all 0.15s",
                    }}
                  >
                    ✓ Save Entry
                  </button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
