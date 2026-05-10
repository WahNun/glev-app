import { redirect } from "next/navigation";

/**
 * Legacy /history route. The Insights + Einträge sub-tab pattern was
 * dropped (2026-05-10) in favor of restoring both as standalone
 * footer-nav tabs (Einträge zwischen Dashboard & Glev, Insights
 * zwischen Glev & Settings). Anything still linking here lands on
 * the Insights surface.
 */
export default function HistoryRedirect() {
  redirect("/insights");
}
