STATUS: PARTIAL (2/3) — Frage zu #3
LAST_DONE:
  #1 Routing-Fix in components/GlevActionSheet.tsx — SUB_OPTIONS aktualisiert: "Insulin loggen" → /log?type=insulin (statt /log), "Exercise loggen" → /log?type=exercise (statt /log). "Mahlzeit loggen" routet weiterhin /log (war SCHON korrekt — Spec lag falsch dass es auf /engine routet). "Glukose messen" bleibt /engine (Spec adressiert nicht).
  #2 Mobile-Nav-Layout in components/Layout.tsx — Glev-FAB von left:50% → left:37.5% verschoben + Comment ergänzt. Damit sitzt der FAB exakt mittig über dem Spacer-Slot (Slot 2 von 4 in der flex-grid: Dashboard 12.5% / Spacer 37.5% / History 62.5% / Settings 87.5%). Dashboard ↔ FAB = 25% gap, FAB ↔ History = 25% gap → symmetrisch. Vorher überlagerte der FAB bei left:50% das History-Label.
  tsc --noEmit clean, Workflow restartet.

NEXT (wartet auf User-Bestätigung): #3 Log-Wizard-Rewrite. Spec will /log durch 3-Step Essen/Makros/Ergebnis ersetzen, ABER:
  (a) Wizard existiert bereits — am /engine, nicht /log (app/(protected)/engine/page.tsx Z. 160+, stepIndex 0/1/2, "Essen / Makros / Ergebnis" Pills, handleWizardSave).
  (b) Aktuelles /log ist 905-Zeilen-Komplett-Form (Glukose+Insulin+Macros+Meal-Time+Related-Meal+Voice-Pipeline+Glev-Engine-Recommendation). Alle 5 Macro-Felder sind bereits drin und voll gewired.
  (c) Strikter Food-only-Wizard würde Glukose/Insulin/Time/Related-Meal/Engine-Empfehlung aus /log killen — Insulin-Decision-Support futsch.
  Drei Optionen für User:
    A) /engine-Wizard nach /log MOVEN (engine bleibt für Glukose-Pulls, log bekommt vollen Wizard inkl. Insulin)
    B) /log so lassen, nur Labels Carbs→Kohlenhydrate / Fiber→Ballaststoffe / Fat→Fett auf Deutsch übersetzen
    C) /log wirklich nuken und mit Food-only-Wizard ersetzen (Insulin-Tracking aus /log fällt weg, müsste an /engine wandern)

QUESTION: Welche der 3 Optionen für Wizard-Thema (A/B/C)?
TIMESTAMP: 00:38
