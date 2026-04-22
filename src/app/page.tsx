"use client";

import { useState } from "react";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const ORANGE = "#FF9500";
const BG     = "#09090B";
const SURFACE = "#111117";

type ParsedFood = { name: string; grams: number };

export default function Home() {
  const [loading, setLoading]       = useState(false);
  const [rawResponse, setRaw]       = useState<string | null>(null);
  const [parsedFoods, setParsed]    = useState<ParsedFood[] | null>(null);
  const [error, setError]           = useState<string | null>(null);

  async function testFoodParser() {
    setLoading(true);
    setRaw(null);
    setParsed(null);
    setError(null);

    try {
      const res = await fetch("/api/parse-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "small banana and handful blueberries" }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }

      setRaw(json.raw ?? null);

      try {
        const items: ParsedFood[] = Array.isArray(json.parsed) ? json.parsed : JSON.parse(json.raw ?? "[]");
        setParsed(items);
      } catch {
        setError("Response received but could not parse food items.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 20 }}>
      {/* Logo */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: `${ACCENT}22`, border: `1px solid ${ACCENT}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>◈</div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Glev</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em" }}>INSULIN DECISION SUPPORT</div>
      </div>

      {/* Parser test card */}
      <div style={{ width: "100%", maxWidth: 420, background: SURFACE, borderRadius: 16, border: `1px solid ${ACCENT}22`, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em" }}>
              AI FOOD PARSER
              <span style={{ marginLeft: 6, fontSize: 9, color: ACCENT, fontWeight: 400, letterSpacing: "0.04em" }}>GPT-powered</span>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
              Sends: &ldquo;small banana and handful blueberries&rdquo;
            </div>
          </div>
          <button
            onClick={testFoodParser}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: loading ? "rgba(255,255,255,0.04)" : `${ACCENT}22`,
              border: `1px solid ${ACCENT}44`,
              borderRadius: 9,
              color: loading ? "rgba(255,255,255,0.3)" : ACCENT,
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              letterSpacing: "0.03em",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}
          >
            {loading ? "Parsing…" : "Test Food Parser"}
          </button>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: PINK, padding: "10px 12px", background: `${PINK}0D`, borderRadius: 9, border: `1px solid ${PINK}22` }}>
            {error}
          </div>
        )}

        {rawResponse && (
          <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 9, border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em", marginBottom: 5 }}>RAW RESPONSE</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
              {rawResponse}
            </div>
          </div>
        )}

        {parsedFoods && parsedFoods.length > 0 && (
          <div style={{ padding: "10px 12px", background: `${GREEN}08`, borderRadius: 9, border: `1px solid ${GREEN}22` }}>
            <div style={{ fontSize: 9, color: GREEN, letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>PARSED FOODS</div>
            {parsedFoods.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: i < parsedFoods.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}
              >
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>{item.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{item.grams}g</span>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", textAlign: "center", padding: 8 }}>
            Parsing…
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: "0.06em" }}>
        MEMBERS ONLY · PRIVATE BETA
      </div>
    </main>
  );
}
