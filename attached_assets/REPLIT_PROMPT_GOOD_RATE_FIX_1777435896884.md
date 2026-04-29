# REPLIT PROMPT — Good Rate Konsistenz: Insights = Dashboard

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## PROBLEM

Die Good Rate in **Insights** ist höher als im **Dashboard** — weil zwei verschiedene Definitionen verwendet werden:

- **Dashboard** (korrekt): `rating === "GOOD"` — null-Werte werden **nicht** als GOOD gezählt
- **Insights** (falsch): EVAL_NORM-Funktion mappt `null` → `"GOOD"` — null-Werte zählen als GOOD

Ein Nutzer ohne Messwert soll **keinen** GOOD-Punkt bekommen. Die Dashboard-Definition ist medizinisch korrekt.

---

## STEP 1 — EVAL_NORM finden

```bash
grep -r "EVAL_NORM\|eval_norm\|null.*GOOD\|GOOD.*null" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l
```

Öffne die gefundene Datei(en) und suche die Stelle wo null auf "GOOD" gemappt wird.

---

## STEP 2 — Fix anwenden

Finde die Logik die Glukosewerte bewertet. Sie sieht wahrscheinlich so aus:

```ts
// FALSCH — null wird als GOOD gezählt:
function evalNorm(value: number | null): 'GOOD' | 'HIGH' | 'LOW' {
  if (value === null) return 'GOOD';  // ← das ist der Bug
  if (value >= 70 && value <= 180) return 'GOOD';
  if (value > 180) return 'HIGH';
  return 'LOW';
}
```

Ändere zu:

```ts
// KORREKT — null wird ausgeschlossen:
function evalNorm(value: number | null): 'GOOD' | 'HIGH' | 'LOW' | null {
  if (value === null) return null;  // ← null bleibt null
  if (value >= 70 && value <= 180) return 'GOOD';
  if (value > 180) return 'HIGH';
  return 'LOW';
}
```

---

## STEP 3 — Good Rate Berechnung in Insights prüfen

Finde wo die Good Rate in Insights berechnet wird:

```bash
grep -r "goodRate\|good_rate\|GOOD.*filter\|filter.*GOOD" app/ components/ --include="*.ts" --include="*.tsx" -n
```

Stelle sicher dass die Berechnung null-Werte herausfiltert:

```ts
// KORREKT:
const ratings = meals.map(m => evalNorm(m.glucose_value)).filter(r => r !== null);
const goodRate = ratings.length > 0
  ? ratings.filter(r => r === 'GOOD').length / ratings.length
  : 0;
```

Nicht:
```ts
// FALSCH:
const ratings = meals.map(m => evalNorm(m.glucose_value)); // enthält null-gewordene GOODs
```

---

## STEP 4 — TypeScript Typen anpassen

Falls andere Komponenten den Rückgabewert von evalNorm erwarten und `null` nicht kennen, passe die Typen an:

```ts
// Überall wo evalNorm verwendet wird:
const rating = evalNorm(meal.glucose_value);
if (rating === null) continue; // überspringen statt als GOOD zählen
```

---

## NICHT ÄNDERN

- Dashboard-Logik (ist bereits korrekt)
- DB-Schema
- Supabase Queries
- Andere Bewertungsmetriken (HbA1c-Schätzung, Trend etc.)

---

## VERIFY

1. `tsc --noEmit` → kein Fehler
2. Mahlzeit ohne Glukosewert loggen
3. Insights öffnen → Good Rate sollte **nicht** steigen durch den null-Eintrag
4. Dashboard Good Rate == Insights Good Rate (bei gleicher Zeitspanne)
5. `git add -A && git commit -m "fix: good rate null-exclusion consistent across dashboard and insights" && git push origin main`

=== END ===
