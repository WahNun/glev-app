# Glev — Diagnose: Bolus-Logging & ICR-Berechnung

> Erstellt: 2026-05-29 · Basis: Analyse-Session Mai 2026  
> Scope: Bolus-Logging-Pipeline, ICR-Berechnung (roh + adaptiv), Evaluation-Engine, Insights-Darstellung

---

## 1. Überblick: Wie funktioniert der Bolus-ICR-Kreislauf in Glev?

```
Mahlzeit erfassen (Engine-Seite)
    ↓
saveMeal() → meals-Tabelle + insulin_logs-Mirror (Bolus-Eintrag)
    ↓
CGM liest nach ~1h / 2h die Glukose-Werte
    ↓
lifecycleFor() → evaluateEntry() → Outcome (GOOD / UNDERDOSE / OVERDOSE / SPIKE / HYPO_DURING)
    ↓
Adaptive ICR-Rechner: outcome-gewichteter Schnitt über letzte Mahlzeiten
    ↓
Insights-Seite: zeigt Rohen KH-Faktor (1:X) + Trefferquote + Ø Glukose
```

---

## 2. Bolus-Logging: gefundener und behobener Bug

### Problem: Doppeltes Speichern des Bolus

**Symptom:** Jede Mahlzeit erzeugte **zwei** Einträge in `insulin_logs` —  
einen via `saveMeal()` automatisch, einen zweiten manuell von `engine/page.tsx`.

**Ursache:**
- `lib/meals.ts → saveMeal()` enthält bereits seit längerem einen integrierten  
  Mirror-Schreibpfad: wenn `insulinUnits > 0`, wird automatisch ein  
  `insulin_logs`-Eintrag angelegt (Typ: `bolus`, Name: `"Mahlzeit-Bolus"`).
- `app/(protected)/engine/page.tsx` rief danach **nochmals** `insertInsulinLog()`  
  auf — an drei verschiedenen Stellen im Confirm-Flow.

**Fix (diese Session):**
1. `SaveMealInput` bekam einen neuen optionalen Parameter `insulinName?: string | null`  
   → `saveMeal()` nutzt jetzt den echten Insulin-Markennamen (z. B. „NovoRapid")  
   statt immer „Mahlzeit-Bolus".
2. Die drei redundanten `insertInsulinLog()`-Aufrufe in `engine/page.tsx`  
   wurden entfernt.

**Auswirkung des Bugs:** IOB-Berechnung, Bolus-Historie und Adaptive ICR  
zählten jede Einheit **doppelt** — die Engine empfahl zu niedrige Dosen.

---

## 3. ICR-Berechnung: Roh vs. Adaptiv

### 3.1 Roher KH-Faktor (Raw ICR)

Angezeigt auf der **Insights-Seite** (Performance-Karte, lila Tile).

```
estICR = Ø(carbs_grams / insulin_units) über letzte 7 Mahlzeiten
         (nur Mahlzeiten mit carbs > 0 UND insulin > 0)
```

- **Ignoriert** das Ergebnis (ob GOOD / SPIKE / etc.).
- **Ignoriert** den Pre-Meal-Glukosewert.
- **Ignoriert** separate Bolus-Logs (nur `meal.insulin_units`).
- Ist ein **rückwärtsblickender Ist-Wert** ohne klinische Korrektur.
- Typischer Wert: `1:30` bis `1:50` — bedeutet: 1 IE Insulin für 30–50 g KH.

### 3.2 Adaptiver ICR (Adaptive Engine)

Angezeigt auf der **Engine-Seite** (blauer Hero-Wert).

```
computeAdaptiveICR(meals, boluses?)
    → Für jede Mahlzeit: outcome-Gewicht
          GOOD        → 1.0
          UNDERDOSE   → 0.7  (Richtung: mehr Insulin)
          OVERDOSE    → 0.7  (Richtung: weniger Insulin)
          HYPO_DURING → 0.5
          SPIKE       → 0.7
    → Gewichteter Schnitt der (carbs / insulin)-Verhältnisse
    → Confidence: HIGH (≥8 Mahlzeiten), MEDIUM (≥4), LOW (<4)
```

**Bekanntes Problem (Task noch offen):** `computeAdaptiveICR` liest  
`meal.insulin_units` direkt — **separate Bolus-Logs** (Nutzer, die Insulin  
erst nach der Mahlzeit loggen oder auf mehrere Boli splitten) werden  
**nicht einbezogen**. Der Pairing-Algorithmus `lib/engine/pairing.ts`  
(Two-Pass-Greedy, ±30-min-Fenster) existiert bereits, wird aber von  
`computeAdaptiveICR` noch nicht aufgerufen.

**Empfehlung:** Bolus-Logs über `pairBolusesToMeals()` in die adaptive  
Berechnung einziehen (Task `engine-pairing-adaptive-icr` in Backlog).

---

## 4. Evaluation-Engine: Diagnose der Inkonsistenzen

### 4.1 Entscheidungslogik (vereinfacht)

```
evaluateEntry(bgBefore, bgAfter, carbs, insulin, curve-Daten, …)

spikeCutoff:  FAST_CARBS=70 / HIGH_FAT=40 / HIGH_PROTEIN=50 / BALANCED=55 mg/dL

(1) Hypo-Check:    hadHypoWindow=true OR minBg180 < 70  → HYPO_DURING
(2) Peak-Spike:    peakRise = maxBg180 - bgBefore > cutoff  → SPIKE
(3) Speed-Spike:   speed1 > 1.5 mg/dL/min (≈90 mg/dL/h)   → SPIKE
                   speed1 > 2.5 mg/dL/min                  → SPIKE_STRONG
(4) Delta-Check:   Δ = bgAfter - bgBefore
    Δ > cutoff   → SPIKE / SPIKE_STRONG
    Δ > +30      → UNDERDOSE
    Δ < −30      → OVERDOSE
    |Δ| ≤ 30     → GOOD
(5) ICR-Fallback:  (kein bgAfter vorhanden)
    ratio = insulin / expected_dose (ICR + CF-Korrektur)
    ratio > 1.35 → OVERDOSE  |  ratio < 0.65 → UNDERDOSE  |  sonst GOOD
    Toleranzband nach Fix: ±15 % → GOOD, ±15–35 % → SLIGHTLY_OVER/UNDER
```

### 4.2 Case A — `insulinUnits = 0`, Kommentar „Insulin-Dosis hat gepasst"

**Status: Teilweise behoben.**

- Pfad (4): `Δ ≤ 30` → GOOD — `insulin` wird hier **nicht geprüft**.  
  Eine Mahlzeit mit 0 IE, deren BZ stabil bleibt, erhält Outcome = GOOD.
- `entries/page.tsx` rendert `eval_explain_GOOD` = „Insulin-Dosis hat  
  zur Kohlenhydratlast gepasst." ohne Guard für `insulin_units = 0`.
- **Teilfix:** Bei `insulinUnits = 0` und kein `bgAfter` liefert  
  Pfad (5) jetzt: `outcome = GOOD` + Reasoning `"No insulin logged —  
  no dose evaluation."` (statt kommentarlos GOOD mit Insulin-Erklärung).  
  Der Entries-Seiten-Text ist noch **nicht** gepatcht.

**Empfehlung:** In `entries/page.tsx` vor dem Render-Pfad:  
```typescript
if ((meal.insulin_units ?? 0) === 0) {
  // zeige "Kein Insulin dokumentiert" statt eval_explain_GOOD
}
```

### 4.3 Case B — Hypo erkannt, Bewertung trotzdem „Gut"

**Status: Weitgehend behoben (Task #249).**

- `evaluateEntry` flaggt jetzt bereits bei `bgAfter < 70` als HYPO_DURING  
  (auch ohne Curve-Backfill).
- `entries/page.tsx` liest Outcome aus `lifecycleFor(meal).outcome`  
  (DB-Cache nur als Fallback).

**Restproblem:** 1h-Provisional-Pfad — eine Hypo zwischen +1h und +2h  
ist in der provisorischen Bewertung unsichtbar bis der `bg_2h`-Wert eintrifft.

### 4.4 Case C — Rapider Abfall ohne Bewertungskonsequenz

**Status: Für positiven Speed behoben (Task #251), negativer Speed offen.**

- Speed > 1.5 mg/dL/min (steil steigend) → SPIKE — **behoben**.
- Ein **rapider Abfall** (z. B. −2 mg/dL/min), der bis zur 2h-Messung  
  ausgeglichen ist, rutscht noch durch als GOOD.  
  Klinisch relevant: kurze Hypo-Episode unsichtbar.

---

## 5. Insights-Seite: was die Performance-Kacheln zeigen

### Kachel 1 — Roher KH-Faktor (lila)
- Wert: `1:X` (z. B. 1:46)
- Formel: `Σ(carbs/insulin) / Anzahl` — letzte 7 Mahlzeiten  
- Unkalibriert, ignoriert Outcome → Gesprächsgrundlage mit Diabetologen

### Kachel 2 — Ø Glukose vor Essen (farbkodiert ab dieser Session)
- Wert: `X mg/dL` (Durchschnitt `glucose_before` letzte 7 Tage)
- **Farbe:** < 100 → grün / 100–130 → orange / > 130 → pink
- Zeigt, ob der Nutzer überwiegend im Zielbereich spritzt

### Kachel 3 — Trefferquote (farbkodiert ab dieser Session)
- Wert: `X %` = GOOD-Anteil aller bewerteten Mahlzeiten
- **Farbe:** ≥ 70 % → grün / ≥ 50 % → orange / < 50 % → pink
- Zielwert nach klinischer Praxis: ≥ 70 %

### Kachel 4 — Ø Insulin
- Wert: `X.X u` (Durchschnitt `insulin_units` letzte 7 Tage)
- Sub-Label: Ø Kohlenhydrate als Referenz

---

## 6. Offene Punkte / Empfehlungen

| # | Problem | Priorität | Datei |
|---|---------|-----------|-------|
| 1 | Bolus-Pairing in adaptiver ICR fehlt | mittel | `lib/engine/adaptiveICR.ts` |
| 2 | `entries/page.tsx`: kein Guard für `insulin_units = 0` im Erklärungs-Text | niedrig | `app/(protected)/entries/page.tsx:212` |
| 3 | Rapider negativer Speed (Abfall) hat kein Outcome-Konsequenz | niedrig | `lib/engine/evaluation.ts` |
| 4 | 1h-Provisional zeigt GOOD wenn Hypo zwischen +1h und +2h | niedrig | `lib/engine/lifecycle.ts` |
| 5 | `CHECK_CONTEXT` Outcome ist deklariert aber nie erreichbar | sehr niedrig | `lib/engine/evaluation.ts:8` |

---

## 7. Bereits behobene Probleme (diese Session + letzte Sprints)

| Problem | Fix | Commit / Task |
|---------|-----|---------------|
| Doppeltes Bolus-Logging | `insertInsulinLog()` aus `engine/page.tsx` entfernt; `insulinName`-Param in `saveMeal()` | Session Mai 2026 |
| Hypo → trotzdem GOOD | `bgAfter < 70` Guard in `evaluateEntry`, lifecycle liest `lc.outcome` | Task #249 |
| Speed-Spike rutscht durch | `detectSpike()` mit `SPEED_SPIKE_MGDL_PER_MIN = 1.5` + SPIKE_STRONG | Task #251 |
| Performance-Tiles iOS Safari Bug | CSS 3D flip → konditionelles Render | Session Mai 2026 |
| ICR-Tile Backsides fehlen | Flip-Rückseiten für Adaptiven + Rohen ICR mit Disclaimer | Task ICR-Tile |

---

*Dieses Dokument fasst ausschließlich bereits analysierte und im Chat besprochene Erkenntnisse zusammen. Alle Empfehlungen sind technischer Natur und ersetzen keine ärztliche Einschätzung.*
