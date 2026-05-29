# HIGH_FIBER – Bolus-Diagnose Analyse
_Glev Codebase · Stand 2026-05-29_

---

## 1. Wo wird HIGH_FIBER verwendet?

| Datei | Zeile | Zweck |
|---|---|---|
| `lib/mealTypes.ts` | 8 | Typdefinition `MealType` |
| `lib/meals.ts` | 173 | **Klassifikations-Logik** (`classifyMeal`) |
| `lib/engine/evaluation.ts` | 52, 375 | **Spike-Cutoff** + Lookup |
| `lib/ai/systemPrompt.ts` | 5, 24 | KI-Parser-Anweisung |
| `app/(protected)/engine/page.tsx` | 1475 | Validierung AI-Rückgabe |
| `app/(protected)/insights/page.tsx` | 1155, 1167 | Meal-Type-Breakdown |
| `app/(protected)/entries/page.tsx` | 102, 135 | Filter-Chip |
| `tests/unit/classifyMeal.test.ts` | 189 | Unit-Test |

---

## 2. Net-Carbs-Logik (Fiber-Abzug vor Bolus)?

**Nein — es gibt keinen Fiber-Abzug.** Die Bolus-Formel in `lib/engine/evaluation.ts` verwendet immer die **Brutto-KH**:

```ts
// ICR-Formel (vereinfacht)
const recommendedDose = carbs / settings.icr;
```

`fiber_g` fließt **nicht** in die Dosisberechnung ein. Kein Schwellenwert, keine Net-Carbs-Logik.

---

## 3. Ist `fiber_g` als Feld vorhanden — wird es vom Voice-Extractor gefüllt?

**Ja**, `fiber` ist vollständig im System verankert.

### AI-Parser (`lib/ai/systemPrompt.ts:3`)

Der System-Prompt schreibt das Feld explizit vor:

```json
{
  "items":  [{"name":"...","grams":100,"carbs":30,"protein":5,"fat":2,"fiber":8}],
  "totals": {"carbs":30,"protein":5,"fat":2,"fiber":8,"calories":182}
}
```

### Klassifikation (`lib/meals.ts:147–173`)

`fiber` ist Pflicht-Parameter:

```ts
export function classifyMeal(
  carbs:   number,
  protein: number,
  fat:     number,
  fiber:   number = 0,        // ← fiber_g
  sugars:  number | null = null,
): string {
  // ...
  // HIGH_FIBER: mind. 7g Ballaststoffe UND mind. 20% der KH-Menge.
  if (carbs > 0 && fiber >= 7 && fiber / carbs >= 0.20) return "HIGH_FIBER";
  return "BALANCED";
}
```

### Stichprobe echter Meal-Logs (aus `tests/unit/`)

```ts
// Haferflocken + Milch — fiber=6 → BALANCED (6 < 7g-Schwelle)
{ name: "Haferflocken", grams: 60, carbs: 36, protein: 8, fat: 4, fiber: 6 }

// Banane — fiber=2.5 → FAST_CARBS (carbs>0, fat<3, protein<3 → pure-sugar-Pfad)
{ name: "Banane", grams: 100, carbs: 23, protein: 1, fat: 0.3, fiber: 2.5 }

// Chickpeas-Mahlzeit — fiber=25 → HIGH_FIBER (25 >= 7, 25/93 = 0.27 >= 0.20)
{ name: "roasted chickpeas", grams: 95, carbs: 93, protein: 51, fat: 39, fiber: 25 }
```

---

## 4. Beeinflusst HIGH_FIBER den Spike-Cutoff in `evaluateEntry`?

**Ja — gleichwertig mit HIGH_FAT.** In `lib/engine/evaluation.ts:49–53`:

```ts
export const SPIKE_CUTOFF_FAST_CARBS   = 70;  // mg/dL
export const SPIKE_CUTOFF_HIGH_FAT     = 40;
export const SPIKE_CUTOFF_HIGH_PROTEIN = 50;
export const SPIKE_CUTOFF_HIGH_FIBER   = 40;  // ← identisch mit HIGH_FAT
export const SPIKE_CUTOFF_BALANCED     = 55;
```

Lookup in `evaluateEntry` (Zeile 375):

```ts
cls === "HIGH_FIBER" ? SPIKE_CUTOFF_HIGH_FIBER : ...
```

**Begründung im Kommentar** (`lib/meals.ts:138–140`):

> *„Ballaststoffe verlangsamen und dämpfen die Glukoseresorption ähnlich wie Fett, aber ohne den Delayed-Rise-Effekt. Spike-Cutoff liegt bei 40 mg/dL (= HIGH_FAT-Niveau)."*

---

## Zusammenfassung

| Frage | Antwort |
|---|---|
| HIGH_FIBER verwendet? | Ja — in 8 Dateien (Typ, Klassifikation, Evaluierung, UI, KI) |
| Net-Carbs-Abzug vor Bolus? | **Nein** — Brutto-KH fließen in die ICR-Formel |
| `fiber_g` im Schema vorhanden? | **Ja** — AI-Parser liefert es, `classifyMeal` konsumiert es |
| Voice-Extractor füllt es? | **Ja** — System-Prompt schreibt `fiber` pro Item vor |
| Spike-Cutoff beeinflusst? | **Ja** — 40 mg/dL, identisch mit HIGH_FAT |
