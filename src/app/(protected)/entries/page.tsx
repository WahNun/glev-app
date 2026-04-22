"use client";

import { useState, useEffect } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const ORANGE  = "#FF9500";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.06)";

function evalBadge(e: string | null) {
  if (e === "GOOD")      return { color: GREEN,  label: "GOOD" };
  if (e === "UNDERDOSE") return { color: ORANGE, label: "LOW DOSE" };
  if (e === "OVERDOSE")  return { color: PINK,   label: "OVERDOSE" };
  return { color: "#8B8FA8", label: "—" };
}

function timeAgo(s: string) {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtFull(s: string) {
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SkeletonRow() {
  return (
    <tr>
      {[120,180,80,60,60,80].map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div style={{ height: 12, width: w, background: "rgba(255,255,255,0.06)", borderRadius: 6 }}/>
        </td>
      ))}
    </tr>
  );
}

export default function EntriesPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<string>("all");

  function load() {
    setLoading(true); setError(null);
    fetchMeals()
      .then(setMeals)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = filter === "all" ? meals : meals.filter(m => m.evaluation === filter);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Entries</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            {loading ? "Loading…" : error ? "Error" : `${filtered.length} of ${meals.length} meal${meals.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!loading && !error && meals.length > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { key: "all",       label: "All" },
              { key: "GOOD",      label: "Good" },
              { key: "UNDERDOSE", label: "Low Dose" },
              { key: "OVERDOSE",  label: "Overdose" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)} style={{
                padding: "5px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 600,
                background: filter === key ? ACCENT : "rgba(255,255,255,0.07)",
                color: filter === key ? "white" : "rgba(255,255,255,0.5)",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {["Time","Meal","BG Before","Carbs","Insulin","Result"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em" }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody><SkeletonRow/><SkeletonRow/><SkeletonRow/></tbody>
            </table>
          </div>
        </div>
      ) : error ? (
        <div style={{ background: SURFACE, border: `1px solid ${PINK}22`, borderRadius: 14, padding: "40px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 28, color: PINK, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Could not load entries</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 20 }}>{error}</div>
          <button onClick={load} style={{ padding: "8px 20px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, color: "white", fontSize: 13, cursor: "pointer" }}>
            Retry
          </button>
        </div>
      ) : meals.length === 0 ? (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "60px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◈</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>No entries yet</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            Head to <strong style={{ color: ACCENT }}>Log Meal</strong> to record your first meal.
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "40px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.35)" }}>No entries match this filter.</div>
        </div>
      ) : (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {["Time","Meal","BG Before","Carbs","Insulin","Result"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 500, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((meal, i) => {
                  const ev = evalBadge(meal.evaluation);
                  return (
                    <tr key={meal.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid rgba(255,255,255,0.03)` : "none", transition: "background 0.1s" }}>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>{fmtFull(meal.created_at)}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{timeAgo(meal.created_at)}</div>
                      </td>
                      <td style={{ padding: "11px 16px", maxWidth: 220 }}>
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={meal.input_text}>
                          {meal.input_text}
                        </div>
                        {meal.parsed_json.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                            {meal.parsed_json.slice(0, 3).map((f, j) => (
                              <span key={j} style={{ fontSize: 10, padding: "2px 7px", background: `${ACCENT}12`, color: ACCENT, borderRadius: 99, border: `1px solid ${ACCENT}20`, whiteSpace: "nowrap" }}>
                                {f.name} {f.grams}g
                              </span>
                            ))}
                            {meal.parsed_json.length > 3 && (
                              <span style={{ fontSize: 10, padding: "2px 7px", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", borderRadius: 99 }}>
                                +{meal.parsed_json.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        {meal.glucose_before ? (
                          <span style={{
                            fontSize: 13, fontWeight: 700,
                            color: meal.glucose_before > 180 ? ORANGE : meal.glucose_before < 70 ? PINK : "rgba(255,255,255,0.85)",
                          }}>
                            {meal.glucose_before}
                            <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.35)", marginLeft: 3 }}>mg/dL</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        {meal.carbs_grams ? (
                          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
                            {meal.carbs_grams}<span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.35)", marginLeft: 2 }}>g</span>
                          </span>
                        ) : <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        {meal.insulin_units ? (
                          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
                            {meal.insulin_units}<span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.35)", marginLeft: 2 }}>u</span>
                          </span>
                        ) : <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>—</span>}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        <span style={{
                          fontSize: 10, padding: "3px 10px", borderRadius: 99, fontWeight: 700,
                          background: `${ev.color}18`, color: ev.color, letterSpacing: "0.06em", whiteSpace: "nowrap",
                        }}>
                          {ev.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
