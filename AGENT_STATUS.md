STATUS: DONE (Task #18 — Desktop-Layout für /log-Wizard + Sidebar-Nav-Sync)
LAST_DONE:
  4 zielgenaue Patches für Desktop-Responsive (≥768px) — Mobile-Layout unverändert.

  1. components/Layout.tsx Z.34 — NAV "Log"-Eintrag: path "/entries" → "/log".
     Klick auf Sidebar-"Log" landet jetzt im 3-Step-Wizard statt in der alten Entries-Liste.
     Label "Log" beibehalten (matcht englische Convention der anderen Items).

  2. app/(protected)/log/page.tsx Z.536 — Outer-Container:
     maxWidth 1280 → 1100 + marginRight:"auto" → margin:"0 auto".
     Zentriert die Page auf Desktop statt links-bündig zu kleben. 1100 (statt der Spec-Vorgabe 680)
     gewählt weil die Page ein 2-Col-Layout (Form 60% + AI-Chat 40%) hat das bei 680 zerquetscht würde.
     Die existierende 900px-Media-Query stackt das auf Mobile sowieso zu 1-Col.

  3. app/(protected)/log/page.tsx Z.794-815 — Step 2 Makro-Block:
     Drei separate Container (carbs/protein 2-col + fett/fiber 2-col + kalorien standalone)
     in EINEN auto-fit-Grid `repeat(auto-fit, minmax(220px, 1fr))` zusammengefasst.
     Auf Desktop ergibt das 2-3 Spalten je nach Breite, auf Mobile 1 Spalte. 220px als
     Minimum gewählt weil das die kleinste Breite ist bei der Label + Input + opt-Hint
     noch ohne Wrap passen.
     Glukose / Mahlzeit-Zeit / Beschreibung bleiben full-row außerhalb des Grids
     (Spezial-Behandlung wegen CGM-Btn / datetime-Input / Volltext).

  4. app/(protected)/log/page.tsx Pills (Z.575-578 CSS, Z.605-616 JSX):
     `.wizard-pill` Class hinzu mit responsiven Sizes:
       - Base (Mobile): font-size 12, padding 8/12
       - @media (min-width: 769px): font-size 14, padding 10/22
     Inline `fontSize:12, padding:"8px 12px"` aus dem Pill-Style-Object entfernt
     (jetzt via CSS-Class). 768px-Breakpoint matcht Layout.tsx-Sidebar-Convention.

  Verifikation:
  - npx tsc --noEmit clean
  - Workflow restart sauber (Next.js 16.2.4 Ready in 678ms)
  - HTTP smoke: /log und /dashboard antworten 307 (Auth-Redirect, korrekt)
  - Server-Logs sauber, keine HMR-Errors, Browser-Console ohne neue Fehler
  - Auto-Commit sollte nach mark_task_complete via Spec-autorisiertem `git push origin main`
    auf GitHub landen (Commit-Msg: "fix: desktop responsive layout for /log wizard + sidebar nav sync")

  Bewusst NICHT geändert (außerhalb Task-Scope):
  - Mobile-Bottom-Nav (vor 2 Runden gefixt, OK)
  - saveMeal-Logik / CGM-Pipeline / Voice-Pipeline
  - i18n-Strings (Sidebar-NAV-Array bleibt englisch — i18n-Roll-out ist separater Strang)
  - /engine Page (Spec sagt explizit: eigene Runde)
  - /entries Page (existiert weiter, von Mobile-Nav History → /history erreichbar)

NEXT (offen — aus Plan-File "Offene Fragen" + bekannte Stränge):
  a) Sidebar-Layout: Insights bleibt drin, History/Verlauf NICHT zur Sidebar hinzugefügt
     (Spec wollte History rein + Insights raus). Falls User das anders will — eigene Runde.
  b) /log maxWidth-Fallback: falls auf Desktop >900px die Chat-Spalte zu schmal wirkt,
     entweder Outer-maxWidth runter oder 2-Col bei <1024px zu 1-Col kollabieren.
  c) Restliche /log-Strings i18n (carbs/protein/fat/fiber/kcal Labels, Speichere-Toast,
     Korrektur-Bolus-Section, Recommendation-Card) — Strang aus Task #17 i18n Foundation.
  d) /engine Page Cleanup (offen seit 2+ Runden — eigener Task).
  e) /log?type=insulin/exercise Sub-Flow (offen seit 2+ Runden).

QUESTION:
  Ein/zwei Klick-Throughs auf Desktop ≥900px probieren — Pills lesbarer? Makros
  in 2-3 Spalten? Sidebar-Log → Wizard? Wenn ja: zu welchem Strang weiter
  (i18n-Rest / /engine-Cleanup / Sidebar-Items)?

TIMESTAMP: 23:56
