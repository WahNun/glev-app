"use client";

import { useState, useEffect } from "react";
import { fetchMeals, type Meal } from "@/lib/meals";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SkeletonRow() {
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ height: 14, width: "60%", background: "rgba(255,255,255,0.06)", borderRadius: 6 }}/>
        <div style={{ height: 11, width: 50, background: "rgba(255,255,255,0.04)", borderRadius: 6 }}/>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[80, 100, 70].map((w, i) => (
          <div key={i} style={{ height: 26, width: w, background: "rgba(255,255,255,0.04)", borderRadius: 99 }}/>
        ))}
      </div>
    </div>
  );
}

export default function EntriesPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    fetchMeals()
      .then(setMeals)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load entries"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Entries</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            {loading ? "Loading…" : error ? "Error loading entries" : meals.length === 0 ? "No entries yet" : `${meals.length} meal${meals.length === 1 ? "" : "s"} logged`}
          </p>
        </div>
        {!loading && !error && meals.length > 0 && (
          <span style={{ fontSize: 11, padding: "5px 12px", background: `${ACCENT}18`, color: ACCENT, borderRadius: 99, fontWeight: 600 }}>
            {meals.length} total
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </div>
      ) : error ? (
        <div style={{
          background: SURFACE, border: `1px solid ${PINK}22`, borderRadius: 18,
          padding: "40px 32px", textAlign: "center",
        }}>
          <div style={{ fontSize: 28, marginBottom: 12, color: PINK }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Could not load entries</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginBottom: 20 }}>{error}</div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchMeals().then(setMeals).catch(e => setError(e instanceof Error ? e.message : "Failed")).finally(() => setLoading(false)); }}
            style={{ padding: "8px 20px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, color: "white", fontSize: 13, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      ) : meals.length === 0 ? (
        <div style={{
          background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 18,
          padding: "60px 40px", textAlign: "center",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>◈</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>No entries yet</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
            Head to <strong style={{ color: ACCENT }}>Log Meal</strong> to describe your food and save your first entry.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {meals.map(meal => (
            <div key={meal.id} style={{
              background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px 18px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ flex: 1, marginRight: 12, fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: "rgba(255,255,255,0.85)" }}>
                  {meal.input_text}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", flexShrink: 0, textAlign: "right" }}>
                  {timeAgo(meal.created_at)}
                </div>
              </div>

              {meal.parsed_json.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)", borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {meal.parsed_json.map((food, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", background: `${ACCENT}12`, borderRadius: 99,
                      border: `1px solid ${ACCENT}25`,
                    }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>{food.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>{food.grams}g</span>
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", fontSize: 11, color: GREEN, fontWeight: 600, alignSelf: "center" }}>
                    {meal.parsed_json.reduce((s, f) => s + f.grams, 0)}g total
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
