import { redirect } from "next/navigation";

// /log was the legacy "Mahlzeit loggen" entry screen. It has been
// fully superseded by /engine, which hosts the Engine | Insulin |
// Übung | Glukose tabs + the 3-step meal wizard via the
// EngineHeader dropdown. The bottom-nav Glev button already routes
// to /engine (components/Layout.tsx ~line 296).
//
// This file used to be a 1196-line client component containing the
// old single-screen meal entry form. Replaced with a server-side
// redirect on 2026-04-29 so any deep link, browser refresh, stale
// bookmark, or in-app push() to /log lands directly on the modern
// /engine view without flashing the old UI. The previous content is
// preserved in git history.
//
// DO NOT re-add UI here — add new entry surfaces inside /engine
// instead, where the Engine context (chip state, adaptive ICR,
// header dropdown) is wired up.
export default function LogRedirectPage() {
  redirect("/engine");
}
