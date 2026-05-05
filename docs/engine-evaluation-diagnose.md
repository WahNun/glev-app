# Engine-Evaluation: Diagnose der Inkonsistenzen

> Reine Diagnose (Task #248). **Keine** Code-Änderungen, keine neuen Tests, keine
> Migrationen. Dieses Dokument rekonstruiert die aktuelle Engine-Logik, listet
> nachweisbare Inkonsistenzen, beschreibt fehlende Regeln und schlägt eine
> Ziel-Logik auf High-Level-Ebene vor.

---

## 0. Inventar der untersuchten Dateien

| Datei | Rolle |
| --- | --- |
| `lib/engine/evaluation.ts` | Kern-Bewertung pro Mahlzeit (`evaluateEntry`), liefert `outcome` (GOOD / UNDERDOSE / OVERDOSE / SPIKE / HYPO_DURING / CHECK_CONTEXT). |
| `lib/engine/lifecycle.ts` | State-Machine `pending → provisional → final` einer Mahlzeit, ruft `evaluateEntry` auf. |
| `lib/engine/chipState.ts` | UI-Chip-Metadaten (Farbe + Label) auf Basis von `lifecycleFor`. |
| `lib/engine/recommendation.ts` | Dosis-Empfehlung (`recommendDose`) — getrennt von der Bewertung, kein Outcome-Feedback. |
| `lib/engine/adjustment.ts` | Vorschläge zur ICR/CF-Anpassung auf Basis von `Pattern`. Erzeugt Curve-Advisories (Hypo-Rate, Late-Dip-Rate). |
| `lib/engine/patterns.ts` | Aggregat über die letzten 20 Mahlzeiten / 30 Tage; gewichtetes Outcome-Counting + Curve-Insights. |
| `lib/engine/adaptiveICR.ts` | Outcome-gewichteter ICR-Schnitt, koppelt Boli ↔ Mahlzeiten via `pairing.ts`. |
| `lib/engine/pairing.ts` | Bolus↔Meal-Pairing (explizit > Zeitfenster ±30 min). |
| `lib/engine/trend.ts` | Pre-Meal-CGM-Trend-Klassifikator, **rein dokumentarisch**. |
| `lib/insulinEval.ts` | Bolus-Scoring (ON_TARGET / UNDER / OVER / SPIKED / PENDING). Eigener, **paralleler** Outcome-Raum für Bolus-Logs. |
| `lib/exerciseEval.ts` | Exercise-Scoring (STABLE / DROPPED / SPIKED / HYPO_RISK / PENDING). Eigener, paralleler Outcome-Raum für Workouts. |
| `lib/engineMessages.ts` | i18n-Renderer für `AdjustmentMessage`-Strukturen. |
| `app/api/debug/engine/route.ts` | Debug-Endpoint, gibt nur den letzten Engine-Run zurück (kein eigenes Scoring). |
| `app/(protected)/engine/page.tsx` | UI; Wrapper `runGlevEngine`, Safety-Notes. Kein eigenständiges Scoring der Outcome-Logik. |
| `messages/de.json` / `messages/en.json` | Quelle der String-Templates inkl. `eval_explain_GOOD = "Insulin-Dosis hat zur Kohlenhydratlast gepasst."` |

---

## 1. Aktuelle Logik (Pseudocode)

### 1.1 `evaluateEntry()` — Outcome pro Mahlzeit
Datei: `lib/engine/evaluation.ts`, Zeilen 135–246.

```
INPUT: carbs, fiber, insulin, bgBefore, bgAfter, classification,
       speed1, speed2, minBg180, maxBg180, timeToPeakMin, hadHypoWindow,
       settings (ICR/CF/targetBG), preTrend, recentInsulinLogs, recentExerciseLogs

netCarbs = max(0, carbs - fiber)
delta    = (bgBefore != null && bgAfter != null) ? bgAfter - bgBefore : null

# Spike-Schwelle hängt nur von der Klassifikation ab (Zeile 147–151):
spikeCutoff = 70 if FAST_CARBS
              40 if HIGH_FAT
              50 if HIGH_PROTEIN
              55 sonst (BALANCED / null)

# (1) Curve-aware Hypo, Zeilen 157–166
if hadHypoWindow == true AND bgBefore != null:
    return HYPO_DURING, confidence=high
    # Dosis spielt keine Rolle, insulin-Wert wird nicht geprüft.

# (2) Peak-basierter Spike, Zeilen 168–187
if maxBg180 != null AND bgBefore != null:
    peakRise = round(maxBg180 - bgBefore)
    if peakRise > spikeCutoff: return SPIKE

# (3) Delta-basierte Bewertung (bg_2h vs Baseline), Zeilen 189–220
if delta != null:
    if delta >  spikeCutoff: outcome = SPIKE
    elif delta >  30:        outcome = UNDERDOSE
    elif delta < -30:        outcome = OVERDOSE
    else:                    outcome = GOOD          # nur das Δ entscheidet
    # confidence = high|medium (Zeile 211); Zwischenwerte ignoriert.

# (4) ICR-Heuristik ohne bgAfter, Zeilen 222–245
expected = netCarbs / settings.icr
if bgBefore > targetBg: expected += (bgBefore - targetBg) / settings.cf
ratio = insulin / max(expected, 0.1)
if   ratio > 1.35: OVERDOSE
elif ratio < 0.65: UNDERDOSE
else:              GOOD          # confidence=low
```

Wichtige Eigenschaften:
- `Outcome = "CHECK_CONTEXT"` ist im Typ deklariert (Zeile 8) **wird aber nirgends von `evaluateEntry` zurückgegeben** — totes Outcome.
- `insulin` (gegebene Einheiten) wird ausschließlich im ICR-Fallback (4) verwendet. In den Pfaden (1)–(3) hat `insulin` **keinen Einfluss**, auch nicht bei `insulin == 0`.
- `speed1` / `speed2` werden in `speedMessages()` (Zeilen 116–133) nur als **Begleit-Text** gerendert — keine Schwellwerte, keine Outcome-Konsequenzen.
- `preTrend` ist laut Kommentar (Zeilen 49–52) strikt Doku, Outcome wird nicht geändert.
- `contextMessages()` (Zeilen 74–109) hängt nur Basal-/Exercise-Hinweise an.

### 1.2 `lifecycleFor()` — Lebenszyklus einer Mahlzeit
Datei: `lib/engine/lifecycle.ts`, Zeilen 48–165.

```
hasCurve = had_hypo_window != null OR max_bg_180 != null OR min_bg_180 != null

if hasCurve AND bgBefore != null:
    after = bg_2h ?? bg_1h ?? null
    return final + evaluateEntry(after, +Curve-Felder)

if bg_2h != null AND bgBefore != null:
    if Δt(bg_2h_at, expected+120min) > 30 min  → provisional + "outside_window"
    else                                       → final + evaluateEntry(bg_2h)

if bg_1h != null AND bgBefore != null:
    if Δt > 30 min → provisional + "outside_window"
    else           → provisional + evaluateEntry(bg_1h) + "1h-Prefix"

if ageMinutes < 60 → pending
else               → provisional + evaluateEntry(null) + "no_post_meal"|"updates_after_2h"
```

### 1.3 `chipForMeal()` — UI-Chip
Datei: `lib/engine/chipState.ts`, Zeilen 37–96.
- Im Final-State wird `lc.outcome ?? meal.evaluation` als Outcome verwendet (Zeile 83).
- `body = lc.messages` — die rohen Engine-Nachrichten werden gerendert.
- Der **gespeicherte** `meal.evaluation`-Wert (Spalte in der DB) wird *nicht* von der Engine selbst gepflegt — nur als Cache. Das ist die Bruchstelle für den `eval_explain_*`-Pfad in `app/(protected)/entries/page.tsx`.

### 1.4 `app/(protected)/entries/page.tsx` — Insulin-Kommentar
Zeilen 211–212, 978–979.
```
txEvalLabel   = t(`eval_${meal.evaluation}`)             # z.B. "Gut"
txEvalExplain = t(`eval_explain_${meal.evaluation}`)     # z.B. "Insulin-Dosis hat zur Kohlenhydratlast gepasst."
```
Quelle: `messages/de.json:1335`.
- Diese Zeilen lesen **direkt** den persistierten `meal.evaluation`-String und konstruieren daraus den i18n-Key.
- Kein Guard für `insulin_units == 0`.
- Kein Guard für `lifecycleFor`-Differenz: ist `meal.evaluation` veraltet (z. B. "GOOD" gespeichert, Curve-Backfill macht später HYPO_DURING), zeigt diese Anzeige weiterhin "Gut" + "Insulin-Dosis hat gepasst".

### 1.5 `recommendDose()` — getrennte Empfehlungs-Logik
Datei `lib/engine/recommendation.ts`, Zeilen 49–173. Liefert `recommendedUnits`, eigene Confidence, eigene Messages. **Hat keinerlei Verbindung zur späteren `evaluateEntry`-Bewertung.** Die Empfehlung kennt das Outcome nicht und das Outcome kennt die Empfehlung nicht.

### 1.6 Parallele Outcome-Räume
- `lib/insulinEval.ts` (Bolus-Logs) — eigene 5 Outcomes, eigene Schwellen (`SPIKE_DELTA_MGDL = 50`, `OVER_CORRECTED_DELTA_MGDL = -100`, `HYPO_THRESHOLD = 70`).
- `lib/exerciseEval.ts` (Workouts) — eigene 5 Outcomes, eigene Schwellen (-30 % / +20 %).
- `lib/engine/evaluation.ts` (Mahlzeiten) — eigener 6er-Raum.
Die drei Systeme **teilen keinerlei Konstanten oder Logik** und können sich gegenseitig widersprechen.

---

## 2. Konkrete Inkonsistenzen (Cases)

### Case A — `insulinUnits = 0`, trotzdem Kommentar „Insulin-Dosis passt"
**Möglich. Reproduziert über zwei Pfade.**

1. *Pfad Lifecycle/Chip:* In `evaluateEntry` (Zeilen 189–220) wird `outcome = GOOD` allein durch `|delta| ≤ 30 mg/dL` bestimmt; der Wert von `insulin` wird in diesem Block überhaupt nicht gelesen. Eine Mahlzeit mit `insulin_units = 0`, deren Glukose innerhalb ±30 mg/dL bleibt, erzeugt also `outcome = GOOD` mit der Begleit-Message `engine_eval_good` ("Dosis passte zur Mahlzeit", `messages/de.json:329`).
2. *Pfad Entries-Seite:* `app/(protected)/entries/page.tsx:212` rendert `eval_explain_${meal.evaluation}`. Für `evaluation = "GOOD"` liefert `messages/de.json:1335` exakt den beobachteten String **„Insulin-Dosis hat zur Kohlenhydratlast gepasst."** — auch wenn das Mahlzeit-Insulin `0` war.

Es gibt an keiner Stelle (`evaluation.ts`, `lifecycle.ts`, `chipState.ts`, `entries/page.tsx`) einen Guard `if (insulin <= 0) suppress("Insulin-Dosis…")`.

### Case B — Hypo erkannt, trotzdem Bewertung „Gut"
**Möglich, an mehreren Stellen.**

1. *Sparse-Pfad ohne Curve:* Solange kein Curve-Backfill (`max_bg_180/min_bg_180/had_hypo_window` alle null) gelaufen ist, sieht `evaluateEntry` nur `bgBefore` und `bgAfter (= bg_2h)`. Eine Hypo **zwischen** den beiden Punkten ist unsichtbar. Beispiel: 110 → (Mitte 60) → 100 → `delta = -10` → Block (3) liefert `GOOD` (Zeile 205). Die Hypo wird vom Outcome-Pfad nie gesehen.
2. *Cache-Skew:* `meal.evaluation` wird zum Insert-Zeitpunkt mit `null` belegt (`app/(protected)/engine/page.tsx:1135, 1210, 1280`). Wenn später `lifecycleFor` durch hereinkommende Curve-Aggregate auf HYPO_DURING flipped, hat der Datenbank-Cache trotzdem evtl. später `GOOD` (durch andere Schreibpfade) — `entries/page.tsx:211–212` zeigt dann `eval_GOOD` + `eval_explain_GOOD`, weil es **nur** auf `meal.evaluation` schaut, nicht auf `lifecycleFor(meal).outcome`. Demgegenüber benutzt `chipState.ts:83` `lc.outcome ?? meal.evaluation`, also kann der Chip "HYPO_DURING" zeigen während die direkt darunter gerenderte Erklärung "Insulin-Dosis hat gepasst" sagt.
3. *1h-Provisional-Pfad:* In `lifecycleFor` (Zeilen 113–142) wird `evaluateEntry(bg_1h)` aufgerufen — eine spätere Hypo zwischen +1h und +2h ist im `outcome` der provisorischen Bewertung nicht enthalten und kann als `GOOD` gelabelt werden, bevor der Curve-Backfill greift.

### Case C — Starker negativer Delta / hohe Geschwindigkeit → kein Einfluss auf Bewertung
**Teils möglich.**
- Δ < -30 mg/dL führt zu `OVERDOSE` (Zeile 201). Ein **starker negativer Delta** beeinflusst die Bewertung also bereits.
- Aber **die Geschwindigkeit (`speed1`/`speed2`, mg/dL/min) hat null Einfluss auf das Outcome**: `speedMessages()` (Zeilen 116–133) erzeugt nur Text. Ein Sturz von -200 mg/dL/h, der aber im 2h-Wert wieder bei -25 mg/dL Δ landet, wird `GOOD` gelabelt (Block 3, Zeile 205). Auch ein extremer Spike-Speed (z. B. +120 mg/dL in der ersten Stunde, danach Korrektur zurück) wird nicht als SPIKE markiert, solange `delta ≤ spikeCutoff`. Die Schwelle für SPIKE ist rein der Δ-Wert oder (nur mit Curve) der `peakRise`.
- `peakRise > spikeCutoff` (Zeile 170) ist die einzige Stelle, an der die Form der Kurve einbezogen wird — und auch nur die Höhe, nicht die Geschwindigkeit.
- Es gibt **keine** Differenzierung "leichter" vs. "starker" Spike (siehe §3 unten).

---

## 3. Spike-Logik im Detail

Schwellen (`evaluation.ts:147–151`):

| Klassifikation | spikeCutoff |
| --- | --- |
| FAST_CARBS | 70 mg/dL |
| HIGH_PROTEIN | 50 mg/dL |
| HIGH_FAT | 40 mg/dL |
| BALANCED / null | 55 mg/dL |

Erkennung:
- **Curve-Pfad:** `peakRise = maxBg180 - bgBefore > spikeCutoff` (Zeile 170). Zeitfenster: 0–180 min. `timeToPeakMin` wird ausschließlich für die Anzeige genutzt, nicht für die Klassifikation.
- **Sparse-Pfad:** `delta = bg_2h - bgBefore > spikeCutoff` (Zeile 192).
- **Speed:** geht **nicht** in die Spike-Erkennung ein.

Berücksichtigung in der Gesamt-Bewertung:
- SPIKE ist ein **gleichwertiger** Outcome-Wert (kein Modifier auf GOOD), d.h. eine Mahlzeit ist *entweder* GOOD *oder* SPIKE — nicht „GOOD mit Spike-Hinweis".
- Hat eine Mahlzeit gleichzeitig HYPO_DURING und einen Spike, wird HYPO_DURING zuerst geprüft (Zeile 157) und SPIKE gar nicht ausgewertet — implizite Hierarchie HYPO_DURING > SPIKE > Δ-basiert.
- In der Pattern-Aggregation (`patterns.ts`) zählt SPIKE mit Outcome-Gewicht 0.7 (`adaptiveICR.ts:9`) und löst `pattern.type = "spiking"` aus, wenn Anteil > 40 % (Zeile 153).

Differenzierung leicht/stark:
- **Keine.** Ein Spike-Cutoff ist binär: Δ knapp über Schwelle → SPIKE, Δ knapp drunter → GOOD/UNDERDOSE. Es gibt keine zweite Schwelle und keine Severity-Skala.
- Die UI nutzt eine einzelne `spike`-Farbe via `getEvalColor`.

---

## 4. Fehlende Regeln

1. **Risiko-Hierarchie nicht durchgesetzt.** Es existiert nur die implizite Reihenfolge (HYPO_DURING → SPIKE-Curve → Δ-Block → ICR-Fallback). Eine ausdrückliche Regel "Hypo überschreibt jedes andere Outcome" fehlt für den **Sparse-Pfad** (Block 3 sieht keine Hypo).
2. **`insulinUnits = 0` Guard fehlt.** Weder `evaluation.ts` noch `entries/page.tsx` unterdrücken die Insulin-Erklärungen, wenn keine Dosis gegeben wurde.
3. **Konsistenz `meal.evaluation` ↔ `lifecycleFor()` nicht garantiert.** Der DB-Cache ist optional, wird zum Insert auf `null` gesetzt, aber an anderer Stelle (`entries/page.tsx`) als Single Source of Truth gelesen. Die Engine selbst hat keinen Reconciliation-Pfad.
4. **Geschwindigkeit (mg/dL/min) ungewichtet.** Trotz Berechnung von `speed1`/`speed2` (`lifecycle.ts:57–58`) und der Existenz vollständiger Klassifikatoren in `trend.ts` fließt Geschwindigkeit **nicht** in das Mahlzeit-Outcome ein.
5. **Outcome- und Empfehlungspfad sind isoliert.** `recommendDose` kennt das frühere Outcome-Muster nicht; `evaluateEntry` kennt die Empfehlung nicht. Bewertet wird nicht die "Abweichung von der empfohlenen Dosis", sondern allein das BG-Verhalten.
6. **Drei parallele Outcome-Räume** (`evaluation.ts`, `insulinEval.ts`, `exerciseEval.ts`) ohne gemeinsame Konstanten — die Hypo-Schwelle ist 3× redundant definiert, die Spike-Schwellen unterscheiden sich (50 mg/dL bei Bolus, 40–70 mg/dL bei Mahlzeit).
7. **`CHECK_CONTEXT` ist totes Outcome.** Im Typ deklariert, nie produziert.
8. **Keine Differenzierung leicht/stark Spike** (§3).
9. **Trend ist deklarativ tot.** `preTrend` wird zwar bis in `evaluateEntry` durchgereicht, ändert aber nichts an Outcome oder Empfehlungs-Zahlen — das ist explizit so dokumentiert (Zeilen 49–52, recommendation.ts:108–111), erzeugt aber den Eindruck einer Logik, die keine ist.
10. **`speedMessages` für Δ ≈ 0:** Ein nahezu-flacher Verlauf erzeugt trotzdem `engine_speed1_rose`/`engine_speed1_fell` mit `+0.00` — kosmetisch, aber irreführend.

---

## 5. Vorschlag Ziel-Logik (High-Level, kein Code)

### 5.1 Strikte Risiko-Hierarchie (vor Outcome-Score)
1. **HYPO** überschreibt alles. Quelle: `had_hypo_window === true` ODER `min_bg_180 < 70` ODER `bg_1h < 70` ODER `bg_2h < 70`. Outcome bleibt negativ, unabhängig vom Δ-Wert.
2. **SPIKE** als eigene Kategorie (nicht als Spielart von "GOOD"). Wird nur ausgewertet, wenn keine Hypo erkannt ist. Aufteilung in `SPIKE_MILD` und `SPIKE_STRONG` (z. B. > 1.5 × cutoff = stark).
3. **OVER/UNDERDOSE** über Δ-Schwelle und ergänzend über Geschwindigkeit (z. B. |speed1| > 1.5 mg/dL/min als zusätzlicher Trigger).
4. **GOOD** nur, wenn keine der oberen Regeln greift **und** ein Post-Meal-Wert vorliegt (sonst eigener Outcome `INCOMPLETE` statt `GOOD` aus dem ICR-Fallback).

### 5.2 Insulin-Kommentar an Dosis koppeln
- `insulinUnits == 0` → Insulin-bezogene Begleit-Sätze (`engine_eval_good`, `eval_explain_GOOD`, …) unterdrücken bzw. durch eine neutrale Variante ersetzen ("Verlauf ok ohne Insulin").
- Insulin-Erklärungen nur dann zeigen, wenn `insulinUnits > 0` und ein BG-Verlauf vorliegt.

### 5.3 Status ↔ Bewertung verknüpfen
- Den im Chip gezeigten Status (Hypo/Spike/Provisional/Final) und die "Gut/Schlecht"-Bewertung aus **derselben** Quelle ableiten (`lifecycleFor(meal)` als Single Source of Truth). `meal.evaluation` als Cache nur dann verwenden, wenn er mit `lifecycleFor` konsistent ist — sonst neu berechnen.
- `entries/page.tsx` darf nicht auf `meal.evaluation` allein zurückgreifen.

### 5.4 Geschwindigkeit als First-Class-Signal
- `speed1`/`speed2` mit Schwellen versehen (z. B. `|speed| > 2 mg/dL/min` als Spike-Trigger, auch wenn Δ-2h klein ist).
- Trend (`preTrend`) als Modifier in der **Empfehlung** zulassen (z. B. `falling_fast` reduziert `correctionDose`), nicht nur als Doku.

### 5.5 Outcome-Räume harmonisieren
- Gemeinsame Konstanten `HYPO_THRESHOLD`, `HIGH_THRESHOLD`, `SPIKE_DELTA_MGDL` zentral definieren und in `evaluation.ts`, `insulinEval.ts`, `exerciseEval.ts` referenzieren.
- `Outcome` und `BolusOutcome` auf eine konsistente Hierarchie heben oder den "totes Outcome" `CHECK_CONTEXT` entfernen.

### 5.6 Reconciliation
- Hintergrund-Job, der nach Curve-Backfill `meal.evaluation` neu setzt, damit Cache und Live-Bewertung nicht divergieren. (Out of scope dieses Tasks, aber notwendig, um Case B Punkt 2 dauerhaft auszuschließen.)

---

## Anhang: Schlüsselzeilen für die drei Cases

| Case | Quelle | Zeilen |
| --- | --- | --- |
| A — Insulin-Dosis "passt" trotz 0u | `messages/de.json` `eval_explain_GOOD` | 1335 |
| A — Auswahl `eval_explain_*` ohne Guard | `app/(protected)/entries/page.tsx` | 212, 978–979 |
| A — `evaluateEntry` ignoriert `insulin` im Δ-Block | `lib/engine/evaluation.ts` | 189–220 |
| B — Sparse-Pfad sieht Hypo nicht | `lib/engine/evaluation.ts` | 189–220 (kein Hypo-Check) |
| B — Hypo-Curve gewinnt nur, wenn Curve da | `lib/engine/evaluation.ts` | 157–166 |
| B — `meal.evaluation` Cache vs `lc.outcome` | `lib/engine/chipState.ts` | 83 vs `entries/page.tsx:211–212` |
| C — Geschwindigkeit nur Begleittext | `lib/engine/evaluation.ts` | 116–133 |
| C — Spike binär, keine Severity | `lib/engine/evaluation.ts` | 147–151, 168–187, 192–197 |
