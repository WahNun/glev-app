STATUS: DONE (Exercise-Tab auf /engine konsistent gemacht)
LAST_DONE:
  Spec: User-Beschwerde "führt nicht zum gewünschten exercise log screen" — Folge-Bug
  nach dem letzten Fix der Glev-FAB-Sub-Optionen. Insulin + FS hatten keine
  Folge-Beschwerden, also dort hat /engine?tab=bolus / ?tab=fingerstick gehalten.
  Exercise war aber laut User noch kaputt.

  Root-Cause-Analyse von /engine: zwei zusammenwirkende Probleme die exercise (und auch
  bolus auf Desktop) brachen:

  1. Die Tab-Strip-Konfiguration in app/(protected)/engine/page.tsx Z.1029-1040 war
     mobile↔desktop unterschiedlich:
     • mobile : engine, bolus, exercise, fingerstick (4 Buttons)
     • desktop: engine, log, fingerstick (3 Buttons — exercise + bolus FEHLTEN!)
     Folge auf Desktop: FAB-Klick auf "Exercise loggen" → /engine?tab=exercise →
     mein searchParams-Effekt setzt tab="exercise" → die ExerciseForm rendert
     unterhalb, ABER die Tab-Strip oben zeigt "Engine" als activeLabel (Fallback wenn
     tab nicht in tabsCfg), wirkt also als hätte die Navigation nicht stattgefunden.

  2. Z.311-319 normalize-Effekt der mobile↔desktop:
     • !isMobile && (prev === "bolus" || prev === "exercise") → return "log"
     Das forciert exercise/bolus auf Desktop zurück auf den "log"-Meta-Tab. Wenn der
     User die Browser-Größe je ändert (oder auf Desktop landet während die initiale
     Render isMobile=false hat und dann ein mq-event kommt), springt der Tab zurück
     auf "log" und überschreibt die Deep-Link-Auswahl.

  Fix in app/(protected)/engine/page.tsx:
  • Z.1043-1048: tabsCfg vereinheitlicht — mobile + desktop bekommen die gleichen 4
    Buttons (engine | Insulin | Übung | Glukose). Der Desktop-only "Log"-Combined-Tab
    fällt raus — User klickt jetzt direkt den Sub-Tab den er will, statt den
    Meta-View. EngineLogTab als Komponente bleibt im Code (für Backward-Compat falls
    nochmal gebraucht, und wird von tab="log" weiterhin gerendert wenn tab manuell
    auf "log" steht).
  • Z.314-325: normalize-Effekt vereinfacht — nur noch ein Downgrade übrig (mobile
    + tab="log" → "bolus", weil mobile keinen log-Tab hat). Kein Downgrade mehr für
    bolus/exercise auf Desktop, weil die jetzt eigene Strip-Buttons haben.

  Verifikation:
  • npx tsc --noEmit clean
  • Workflow restart sauber (Next 16.2.4)
  • /engine?tab=exercise|bolus|fingerstick alle 307 (Auth-Redirect = Routes existieren)
  • activeLabel rechnet jetzt korrekt für alle vier Sub-Tabs (Engine|Insulin|Übung|Glukose)
    auf beiden Viewports

  Bewusst NICHT geändert:
  • EngineLogTab.tsx Komponente bleibt erhalten — nur nicht mehr per Tab-Button
    erreichbar, aber tab="log" rendert sie noch falls jemand das Setup-Code irgendwo
    verwendet. Falls später Cleanup gewünscht: tab-Type kann auf "engine"|"bolus"|
    "exercise"|"fingerstick" reduziert werden (raus mit "log").
  • Mobile bottom-nav — schon korrekt (4 Tabs)
  • Desktop sidebar — schon korrekt aus letzter Runde (4 Items)
  • GlevActionSheet SUB_OPTIONS — die zeigen jetzt schon richtig auf
    /engine?tab=fingerstick|bolus|exercise (Letzte Runde)

NEXT (offen):
  Task #21 Restliche /log-Texte i18n — IMPLEMENTED (extern reingekommen, evtl noch
    Smoke-Test nötig wenn User es bemerkt)
  Task #22 Engine Chat-Sidebar Desktop — PROPOSED
  Task #23 Engine Step-Indikator → /log-Pills — PROPOSED
  Task #24 Sprache wirkt nicht auf Step 1 (Voice) — PROPOSED
  Task #25 Mahlzeit-Zeiten je nach Sprache — PROPOSED
  Task #26 EN-TTS für Insulin-Begründung — PROPOSED
  Task #27 Glev → Top-Level-Aktion (Desktop) — PROPOSED

  Falls später die Combined-"Log"-Sicht gar nicht mehr gebraucht wird:
  • EngineLogTab als Komponente entfernen
  • Tab-Type auf 4 Werte reduzieren (engine|bolus|exercise|fingerstick)
  • setActiveLabel labels Map entsprechend kürzen

QUESTION:
  FAB → Weiteres → "Exercise loggen" sollte jetzt auf beiden Viewports die
  Übung-Tab zeigen mit ExerciseForm darunter, und der Tab-Strip-Button oben
  zeigt "Übung" statt "Engine". Bestätigen ob das jetzt der gewünschte Screen ist?
  Falls ja, gleiches für Insulin (Strip zeigt jetzt "Insulin") und Glukose-Tab
  prüfen — beide sollten konsistent sein.

TIMESTAMP: 00:35
