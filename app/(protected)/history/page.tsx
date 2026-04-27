"use client";

import { useState } from "react";
import InsightsPage from "../insights/page";
import EntriesPage from "../entries/page";

const ACCENT = "#4F6EF7";
const PILL_BG = "rgba(255,255,255,0.06)";

type SubTab = "insights" | "entries";

export default function HistoryPage() {
  const [tab, setTab] = useState<SubTab>("insights");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        role="tablist"
        aria-label="Verlauf"
        style={{
          display: "inline-flex", alignSelf: "flex-start",
          padding: 4, background: PILL_BG, borderRadius: 99,
          gap: 2,
        }}
      >
        <button
          role="tab"
          aria-selected={tab === "insights"}
          onClick={() => setTab("insights")}
          style={{
            padding: "8px 18px", borderRadius: 99,
            border: "none", cursor: "pointer",
            background: tab === "insights" ? ACCENT : "transparent",
            color: "white",
            fontSize: 13, fontWeight: tab === "insights" ? 600 : 500,
            transition: "background 0.15s",
          }}
        >
          Insights
        </button>
        <button
          role="tab"
          aria-selected={tab === "entries"}
          onClick={() => setTab("entries")}
          style={{
            padding: "8px 18px", borderRadius: 99,
            border: "none", cursor: "pointer",
            background: tab === "entries" ? ACCENT : "transparent",
            color: "white",
            fontSize: 13, fontWeight: tab === "entries" ? 600 : 500,
            transition: "background 0.15s",
          }}
        >
          Einträge
        </button>
      </div>

      <div>
        {tab === "insights" ? <InsightsPage /> : <EntriesPage />}
      </div>
    </div>
  );
}
