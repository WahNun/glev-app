# Agent Status

## Last completed task
**Report-Bug: Bolus gesamt zeigte nur 1.0U** (this turn)

### Diagnose
PDF Report `lib/pdfReport.tsx` `computeAggregates()` summierte Bolus-Einheiten nur aus der `insulin`-Tabelle (Standalone-Bolus aus Engine-Log-Tab). Mahlzeit-gebundener Bolus aus dem /log-Wizard landet aber als `meals.insulin_units`-Spalte direkt auf der Mahlzeit-Zeile — wurde komplett ignoriert.

User-Symptom: 1.0U über 11 Tage statt ~50-66U (4-6U/Tag × 11 Tage).

### Fix
`lib/pdfReport.tsx` L378-395 — `totalBolusUnits` und `bolusCount` zählen jetzt **beide Quellen**:
- `meals.insulin_units` (Mahlzeit-gebundener Bolus, ~99% der Einträge)
- `insulin` rows mit `insulin_type='bolus'` (Standalone-Korrekturen)

Basal unverändert (immer Standalone). Inline-Kommentar erklärt die zwei Storage-Pfade für zukünftige Wartung.

`tsc --noEmit --skipLibCheck` → clean.

### Was du jetzt tun musst
PDF neu generieren (Settings → Bericht oder /report Seite). Bolus gesamt sollte jetzt realistisch sein (~50-66U für deinen Zeitraum 17.04-28.04). Falls nicht, sag Bescheid mit Screenshot — dann checken wir auch ob es eine HTML-View gibt (search ergab nur PDF-Komponente, aber zur Sicherheit).

## Pending push (UNVERÄNDERT)
**Plattformseitig blockiert.** Lokal/`gitsafe-backup/main` hat:
- `ddd063d` Pro-page grid 2x2
- `54abbc7` /log Wizard layout
- `f849fc8` Beta-Page Early-Access perk
- `e909009` Beta-Page Stripe Payment Link
- `e6b5a08` Pro-Page Stripe Payment Link
- (jetzt) Report Bolus-Total Fix

User muss selbst pushen.

## Pending follow-ups
- **Audit weitere Insulin-Aggregationen** — gleiches Pattern könnte in anderen Stats vorhanden sein:
  - `app/(protected)/engine/page.tsx` L61, L69 — engine-recommendation rolling windows; checken ob `meals.insulin_units` mitgezählt werden muss
  - `lib/engine/recommendation.ts` L95, L102 — IOB/active insulin Berechnung; **kritisch** für Engine-Empfehlungen wenn nicht korrekt
  - `lib/engine/evaluation.ts` L65 — insulin evaluation
  - `lib/sheets.ts` L25 — Sheets-Export bolus_units
- **Task B — i18n DE/EN ausbauen**
- **Task C — Broteinheiten-Engine UI wiring**
- **Locale-aware date pattern** verbleibende Files

## Key files
- `lib/pdfReport.tsx` — `computeAggregates` jetzt korrekt für Bolus-Total
- `lib/meals.ts` — `Meal.insulin_units` ist die Quelle für Mahlzeit-gebundenen Bolus
- `lib/insulin.ts` — `insulin` table für Standalone-Bolus/Basal
- `app/api/log/route.ts` — schreibt in `logs` table (legacy/alternative path)
