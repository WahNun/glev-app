"use client";

import { useEffect } from "react";
import InsightsPage from "../insights/page";
import EntriesPage from "../entries/page";
import { useHistoryHeader } from "@/lib/historyHeaderContext";

/**
 * /history is a thin wrapper that swaps between Insights and
 * Einträge based on a sub-tab held in HistoryHeaderContext. The tab
 * picker itself is rendered into the global mobile header by
 * components/Layout.tsx as a small "Insights ▾ / Einträge ▾" chip
 * — see HistoryHeaderChip there. This page registers visible=true
 * on mount so that chip appears, and resets to false on unmount in
 * case the route change race-loses to the layout's defensive
 * pathname-based reset.
 */
export default function HistoryPage() {
  const { tab, setVisible } = useHistoryHeader();

  useEffect(() => {
    setVisible(true);
    return () => setVisible(false);
  }, [setVisible]);

  return (
    <div>
      {tab === "insights" ? <InsightsPage /> : <EntriesPage />}
    </div>
  );
}
