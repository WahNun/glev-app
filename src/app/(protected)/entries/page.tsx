"use client";

import { useEntries } from "@/context/EntriesContext";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const SURFACE = "#111117";
const BORDER = "rgba(255,255,255,0.06)";

function timeAgo(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function EntriesPage() {
  const { entries } = useEntries();

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>Entries</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            {entries.length === 0 ? "No entries yet" : `${entries.length} meal${entries.length === 1 ? "" : "s"} logged`}
          </p>
        </div>
        {entries.length > 0 && (
          <span style={{ fontSize: 11, padding: "5px 12px", background: `${ACCENT}18`, color: ACCENT, borderRadius: 99, fontWeight: 600 }}>
            {entries.length} total
          </span>
        )}
      </div>

      {entries.length === 0 ? (
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
          {entries.map(entry => (
            <div key={entry.id} style={{
              background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px 18px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ flex: 1, marginRight: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: "rgba(255,255,255,0.85)" }}>
                    {entry.text}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", flexShrink: 0, textAlign: "right" }}>
                  {timeAgo(entry.createdAt)}
                </div>
              </div>

              {entry.foods.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)", borderRadius: 9,
                  border: "1px solid rgba(255,255,255,0.05)",
                }}>
                  {entry.foods.map((food, i) => (
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
                    {entry.foods.reduce((s, f) => s + f.grams, 0)}g total
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
