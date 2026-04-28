STATUS: DONE (Sprache-Picker als Dropdown + Save-Button)
LAST_DONE:
  Spec: "die sprachbuttons müssen keine buttons sein es reicht ein simples dropdown menü
  rechts davon in der gleichen card der save / speichern button"

  Vorher (war seit letztem Turn drin): 2 große Sprach-Buttons nebeneinander, Klick auf
  inaktiven öffnet Confirm-Modal mit Cancel/Confirm. User wollte das simpler.

  Jetzt (in derselben Card, eine Reihe):
  • flex:1 <select>-Dropdown links — zeigt 🇩🇪 Deutsch / 🇬🇧 English
  • "Speichern"-Button rechts (whiteSpace nowrap, ACCENT-filled wenn pending)
  • Save ist DISABLED solange Dropdown == aktuelle Locale (nichts zu speichern)
  • Kleiner Hint unter der Reihe sobald pending: "Die App lädt neu, …"
    (re-uses settings.language_confirm_body i18n key — beide Sprachen)
  • Kein Modal mehr — Dropdown→Save IST schon eine 2-Step-Bestätigung

  Custom-Styling am Select (damit es nicht nach Browser-OS-Default aussieht):
  • appearance:none + WebkitAppearance:none
  • inline-SVG Pfeil als backgroundImage rechts
  • Dark-Theme (background:SURFACE, color:#fff, border BORDER)
  • <option> Background explizit gesetzt damit Chrome/Firefox-Dropdown-Liste auch dunkel ist

  pendingLocale state (existiert seit letztem Turn): wird jetzt vom Select gesetzt
  statt vom Button — beim Re-Pick auf currentLocale wieder auf null zurück damit
  Save sauber disabled.

  Geänderte Dateien:
  • app/(protected)/settings/page.tsx Z.244-308 — kompletter Card-Block ersetzt
    (alte Buttons + Modal raus → Dropdown + Save + inline Hint rein)
  • messages/de.json + messages/en.json — UNGEÄNDERT (keys aus letztem Turn werden
    weiter verwendet)

  Verifikation:
  • npx tsc --noEmit clean
  • Workflow restart sauber (HMR Refresh-Logs only)
  • HTTP /settings → 200

  Bewusst NICHT geändert:
  • lib/locale.ts setLocale() — Cookie + DB + reload bleibt korrekt, nur der Trigger
    ist jetzt der Save-Button statt Modal-Confirm
  • language_confirm_title key bleibt in messages/* (ungenutzt jetzt, aber nicht
    löschen — könnte sonst beim Rollback-Bedarf wieder gebraucht werden, ist nur
    je 1 Zeile und macht 0 Bundle-Impact)
  • currentLocale/Cookie-Reconcile-Logik (Z.53-60) — funktioniert weiter

NEXT (offen):
  Task #19 Verlauf-Sidebar — wartet auf User-Input ob Insights ersetzen oder als 6.
  Task #20 Engine-Desktop-Layout — ist gerade IMPLEMENTED reingekommen, könnte review brauchen
  Task #21 /log restliche i18n-Strings — IN_PROGRESS
  Task #22 Engine Chat-Sidebar Desktop — PROPOSED, braucht User-Approve
  Task #23 Engine Step-Indikator → /log-Pills — PROPOSED, braucht User-Approve

QUESTION:
  Settings öffnen → Dropdown auf English umstellen → Save klicken (oder zurück auf Deutsch
  → Save wird disabled). Falls noch was am Look stört (Pfeil-Position, Save-Padding,
  Hint-Farbe) — sag's. Sonst: welcher Strang?

TIMESTAMP: 00:14
