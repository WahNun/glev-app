STATUS: DONE (Sprache-Wechsel Confirmation-Modal in Settings)
LAST_DONE:
  Spec: "die settings sollten auch per confirmation popup gespeichert werden oder gecancelt
  wenn man die sprache ändern will".

  Aktuelle Verhalten (vorher): Klick auf Sprach-Button rief sofort setLocale() → Cookie-Set +
  DB-Persist + window.location.reload() ohne Vorwarnung. Nicht-gespeicherte Eingaben
  (Macros, Glukose etc.) gingen lautlos verloren.

  Neues Verhalten:
  • Klick auf den AKTIVEN Sprach-Button = No-Op (kein Confirm wenn nichts ändert)
  • Klick auf den INAKTIVEN Sprach-Button setzt nur pendingLocale state
  • Modal-Overlay erscheint mit:
    - Flagge + Titel "Sprache wechseln?" / "Change language?"
    - Body "Die App lädt neu, damit die neue Sprache geladen wird. Nicht gespeicherte
      Eingaben gehen verloren." / EN-Pendant
    - Cancel-Button (transparent, BORDER) → setPendingLocale(null), Modal weg, kein Reload
    - Confirm-Button (ACCENT-filled) → setLocale(target) → Cookie + DB + Reload
  • Backdrop-Klick = ebenfalls Cancel
  • Active-Highlight am Button bleibt auf der TATSÄCHLICHEN Locale bis zum Reload
    (nicht wie vorher optimistisch geflippt — Modal-Titel zeigt ja schon den Target)

  Geänderte Dateien:
  1. messages/de.json — settings namespace erweitert um language_confirm_title +
     language_confirm_body
  2. messages/en.json — gleicher Patch in EN
  3. app/(protected)/settings/page.tsx:
     - Z.44: tCommon = useTranslations("common") (für cancel/confirm)
     - Z.66: state pendingLocale: Locale | null
     - Z.266-271: Button-onClick gated über if (loc !== currentLocale) → setPendingLocale
     - Z.295-360: neues Modal-JSX als Sibling der Sprache-Card, role="dialog"
       aria-modal="true", z-index 1000, backdrop-filter blur, Stop-Propagation
       am Inner-Box damit Klick auf den Inhalt nicht das Modal schließt

  Verifikation:
  - JSON.parse beide Files clean
  - npx tsc --noEmit clean (kein Output = success)
  - Workflow restart sauber (Next.js 16.2.4 Ready in 1283ms)
  - HTTP /settings → 200
  - Browser-Console nur HMR/Fast-Refresh-Logs, keine Fehler

  Bewusst NICHT geändert:
  - lib/locale.ts setLocale() Funktion bleibt unangefasst (das Cookie-Set + DB-Persist +
    Reload ist korrekt, nur der Trigger-Punkt wird jetzt durch Confirm geschützt)
  - Andere Settings (Macro-Targets, Insulin-Params) — die haben bereits eigene Save-Buttons
    und nicht dieses Reload-Problem
  - components/LanguageSync.tsx — der reconciliert beim Login DB↔Cookie und reloadet bei
    Divergenz; das ist ein anderer Codepfad und braucht kein Confirm (passiert beim Mount)

NEXT (offen — bestehende IN_PROGRESS Tasks):
  Task #19 (Verlauf-Eintrag in Sidebar) — wartet auf User-Input ob Insights ersetzen oder als 6.
  Task #20 (Engine-Seite Desktop-Layout) — kein Konflikt, eigene Runde
  Task #21 (Restliche /log-Übersetzungen) — kein Konflikt, eigene Runde
  Plus zwei neue PROPOSED: #22 Engine Chat-Sidebar, #23 Engine Step-Indikator → User-Approve nötig

QUESTION:
  Modal mal probieren (Settings → "settings" Tab → English-Button klicken → Cancel testen,
  dann nochmal → Confirm). Falls Visual-Tweaks gewünscht (kleinerer Modal, andere Buttons,
  Animation) — sag Bescheid. Sonst welcher Strang als nächstes (#19 Insights/Verlauf-Frage,
  #20 Engine, #21 i18n-Rest, #22/#23 Engine-Chat/Pills)?

TIMESTAMP: 00:11
