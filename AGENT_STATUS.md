STATUS: DONE (Glev-FAB-Submenü fixt + Desktop-Sidebar auf 4 Items)
LAST_DONE:
  Spec aus zwei User-Beschwerden in Folge:
  • "führt nicht zum gewünschten insulin bolus log screen"
  • "führt nicht zum gewünschten FS Glucose manual entry screen"
  Plus Klarstellung: "es gibt 4 elemente im nav … log wird mit insights zu verlauf
  zusammengeführt"

  Root-Cause der zwei Klick-Fehler war components/GlevActionSheet.tsx — die SUB_OPTIONS
  zeigten auf falsche URLs:
  • "Glukose messen"  → /engine            (landete auf engine-Haupttab, nicht FS-Karte)
  • "Insulin loggen"  → /log?type=insulin  (landete auf Mahlzeit-Wizard)
  • "Exercise loggen" → /log?type=exercise (gleiches Problem)
  /log ist der Meal-Wizard. Die Insulin-/FS-/Exercise-Karten leben unter /engine als
  interne Tabs (engine.tsx Z.145 tab-state mit "engine"|"log"|"bolus"|"exercise"|"fingerstick").

  Fix in 3 Files:

  1. components/GlevActionSheet.tsx Z.83-87
     SUB_OPTIONS jetzt:
     • Glukose messen  → /engine?tab=fingerstick
     • Insulin loggen  → /engine?tab=bolus
     • Exercise loggen → /engine?tab=exercise
     Plus Kommentar warum (engine page reads ?tab= on mount + on searchParams change)

  2. app/(protected)/engine/page.tsx Z.3 + Z.146-159
     • neuer import: useSearchParams from next/navigation
     • neuer useEffect: liest ?tab= aus URL, setzt setTab() wenn Wert in
       {engine,log,bolus,exercise,fingerstick}
     • Dependency [searchParams] (NICHT []) damit Re-Klick auf FAB während man schon
       auf /engine ist trotzdem den Tab wechselt — Next.js remountet die Page nicht
       bei reinen Query-Changes

  3. components/Layout.tsx Z.30-53 + Z.216-234
     Desktop-Sidebar reduziert von 5 → 4 Items wie der User es will:
     • Dashboard | Verlauf | Glev | Settings (statt: Dashboard, Log, Glev, Insights, Settings)
     • Log-Tab und standalone Insights-Tab raus — beide jetzt erreichbar über /history
       (das hat schon interne Sub-Tabs Insights/Entries)
     • NAV-Item-Shape geändert von {label,path,icon} → {key:NavKey,path,icon}
       damit tNav(key) gerendert wird statt hardcoded English (Verlauf vs History je
       nach UI-Sprache)
     • NAV.map render-Loop entsprechend angepasst

  4. messages/de.json + messages/en.json
     • neuer Key "nav.glev" → "Glev" in beiden (Brand bleibt, beide Sprachen)

  Verifikation:
  • npx tsc --noEmit clean
  • Workflow restart sauber (Next 16.2.4 Ready in 305ms)
  • /history 200, /engine?tab=fingerstick|bolus|exercise alle 307 (Auth-Redirect = Route exists)
  • Browser-Console Error "MISSING_MESSAGE nav.glev" war Pre-HMR-Stale (Key existiert,
    Timestamp lag vor dem letzten Reconnect)

  Bewusst NICHT geändert (auch wenn Tasks dazu existieren):
  • Task #27 "Glev von Desktop-Sidebar zu Top-Level-Aktion" — User hat in dieser Runde
    nichts dazu gesagt, nur "4 Items" gefordert was jetzt erfüllt ist (mit Glev drin)
  • Mobile bottom-nav — war schon 4 Tabs (Dashboard | [Glev FAB] | History | Settings),
    kein Refactor nötig
  • /history page selbst — funktioniert schon, hat Insights/Entries Sub-Tabs
  • Das alte /entries und /insights und /log — Routes existieren noch und funktionieren,
    aber sind jetzt nur über Deep-Links (oder von /history/dashboard/etc) erreichbar.
    Können später sauber gelöscht werden falls keine Inbound-Links

NEXT (offen):
  Task #19 Verlauf in Sidebar — IMPLEMENTED reingekommen + jetzt von mir nochmal
    übergebügelt (NAV-Refactor war redundant aber konsistent jetzt)
  Task #21 /log Restliche i18n-Strings — IN_PROGRESS
  Task #22 Engine Chat-Sidebar Desktop — PROPOSED
  Task #23 Engine Step-Indikator → /log-Pills — PROPOSED
  Task #24 Sprache wirkt nicht auf Step 1 (Voice) — PROPOSED
  Task #25 Mahlzeit-Zeiten je nach Sprache — PROPOSED
  Task #26 EN-TTS für Insulin-Begründung — PROPOSED
  Task #27 Glev → Top-Level-Aktion (Desktop) — PROPOSED

QUESTION:
  FAB testen: Glev-Button mittig in Mobile-Bottom-Nav antippen → "Mahlzeit loggen" geht
  zum Meal-Wizard, "Weiteres" aufklappen → "Glukose messen" sollte FS-Karte öffnen,
  "Insulin loggen" die Bolus-Form, "Exercise loggen" die Exercise-Form.
  Auf Desktop: Sidebar zeigt jetzt 4 Items mit "Verlauf" statt Log+Insights.
  Was als nächstes? Glev von Desktop-Sidebar weg (Task #27)?

TIMESTAMP: 00:25
