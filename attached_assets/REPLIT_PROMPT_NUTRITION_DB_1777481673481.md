# Feature: Zweistufige Nährwert-Lookup-Architektur — GPT Parse + Open Food Facts / USDA

## Medizinischer Kontext
- Glev ist eine T1D CGM-Companion-App, die Insulindosierungen (Bolus) unterstützt
- GPT schätzt Nährwerte aktuell direkt aus Freitext — Abweichungen von 20–30% sind für T1D inakzeptabel
- Lösung: GPT nur für Sprachverstehen (Lebensmittel + Mengen), Nährwerte kommen aus verifizierten Datenbanken

## Ziel
Zweistufige Architektur:
1. **GPT-4o-mini** → parst Freitext → strukturiertes JSON (nur Lebensmittel + Mengen, KEINE Nährwerte)
2. **Open Food Facts API** (primär) + **USDA FoodData Central** (Fallback) → verifizierte, reproduzierbare Nährwerte

---

=== BEGIN ===

Du arbeitest an **Glev** — einer T1D CGM-Companion-App (Next.js 15, TypeScript strict, Supabase, OpenAI, Vercel).

**Ziel dieses Prompts:** Ersetze die direkte GPT-Nährwertschätzung durch eine zweistufige Architektur: GPT parst nur Sprache → Nährwerte kommen aus Open Food Facts / USDA-Datenbanken.

---

## STEP 1 — Neue Server-Funktion: GPT Food Parser

Erstelle `lib/nutrition/parseFood.ts`:

```typescript
// lib/nutrition/parseFood.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedFoodItem {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'piece';
  search_term: string; // englischer Suchbegriff für API-Lookup
}

export async function parseFoodInput(input: string): Promise<ParsedFoodItem[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a food parser. Extract foods and quantities from user input.
Return ONLY a JSON array — no explanation, no markdown, no extra text.
Each item must have: name (original language), quantity (number), unit (g/ml/piece), search_term (English, for food database lookup).
Default quantities if not specified: piece of fruit ~120g, cup of coffee/cappuccino ~150ml, slice of bread ~30g.
Example output:
[
  { "name": "Banane", "quantity": 120, "unit": "g", "search_term": "banana" },
  { "name": "Haferflocken", "quantity": 200, "unit": "g", "search_term": "oats rolled" },
  { "name": "Cappuccino", "quantity": 150, "unit": "ml", "search_term": "cappuccino" }
]`
      },
      {
        role: 'user',
        content: input
      }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0]?.message?.content ?? '{"items":[]}';
  const parsed = JSON.parse(content);
  // Handle both { items: [...] } and direct array
  const items: ParsedFoodItem[] = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  return items;
}
```

---

## STEP 2 — Open Food Facts Lookup (primär)

Erstelle `lib/nutrition/openFoodFacts.ts`:

```typescript
// lib/nutrition/openFoodFacts.ts
import { ParsedFoodItem } from './parseFood';

export interface NutritionPer100 {
  kcal: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
}

export interface NutritionResult {
  item: ParsedFoodItem;
  kcal: number;
  carbs_g: number;
  protein_g: number;
  fat_g: number;
  source: 'open_food_facts' | 'usda' | 'fallback';
}

export async function lookupOpenFoodFacts(
  item: ParsedFoodItem
): Promise<NutritionPer100 | null> {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      item.search_term
    )}&search_simple=1&action=process&json=1&page_size=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Glev-App/1.0 (lucas@wahnon-connect.com)' },
      next: { revalidate: 86400 } // Cache 24h
    });

    if (!res.ok) return null;
    const data = await res.json();
    const product = data?.products?.[0];
    if (!product) return null;

    const n = product.nutriments;
    const kcal = n?.['energy-kcal_100g'] ?? n?.['energy_100g'] ? (n['energy_100g'] / 4.184) : null;

    if (kcal == null || n?.['carbohydrates_100g'] == null) return null;

    return {
      kcal: Math.round(kcal),
      carbs_g: Math.round(n['carbohydrates_100g'] * 10) / 10,
      protein_g: Math.round((n['proteins_100g'] ?? 0) * 10) / 10,
      fat_g: Math.round((n['fat_100g'] ?? 0) * 10) / 10
    };
  } catch {
    return null;
  }
}
```

---

## STEP 3 — USDA FoodData Central Fallback

Erstelle `lib/nutrition/usda.ts`:

```typescript
// lib/nutrition/usda.ts
import { NutritionPer100 } from './openFoodFacts';

const USDA_API_KEY = process.env.USDA_API_KEY ?? 'DEMO_KEY';

// USDA Nutrient IDs
const NUTRIENT_IDS = {
  kcal: 1008,
  carbs: 1005,
  protein: 1003,
  fat: 1004
};

export async function lookupUSDA(searchTerm: string): Promise<NutritionPer100 | null> {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(
      searchTerm
    )}&api_key=${USDA_API_KEY}&pageSize=1`;

    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;

    const data = await res.json();
    const food = data?.foods?.[0];
    if (!food) return null;

    const nutrients: Record<number, number> = {};
    for (const n of food.foodNutrients ?? []) {
      nutrients[n.nutrientId] = n.value ?? 0;
    }

    const kcal = nutrients[NUTRIENT_IDS.kcal];
    const carbs = nutrients[NUTRIENT_IDS.carbs];
    if (!kcal || !carbs) return null;

    return {
      kcal: Math.round(kcal),
      carbs_g: Math.round(carbs * 10) / 10,
      protein_g: Math.round((nutrients[NUTRIENT_IDS.protein] ?? 0) * 10) / 10,
      fat_g: Math.round((nutrients[NUTRIENT_IDS.fat] ?? 0) * 10) / 10
    };
  } catch {
    return null;
  }
}
```

---

## STEP 4 — Aggregations-Engine

Erstelle `lib/nutrition/aggregateNutrition.ts`:

```typescript
// lib/nutrition/aggregateNutrition.ts
import { ParsedFoodItem } from './parseFood';
import { NutritionResult, lookupOpenFoodFacts } from './openFoodFacts';
import { lookupUSDA } from './usda';

function scale(per100: { kcal: number; carbs_g: number; protein_g: number; fat_g: number }, item: ParsedFoodItem) {
  // quantity ist in g oder ml — beide skalieren linear per 100
  const factor = item.quantity / 100;
  return {
    kcal: Math.round(per100.kcal * factor),
    carbs_g: Math.round(per100.carbs_g * factor * 10) / 10,
    protein_g: Math.round(per100.protein_g * factor * 10) / 10,
    fat_g: Math.round(per100.fat_g * factor * 10) / 10
  };
}

export interface AggregatedNutrition {
  items: NutritionResult[];
  totals: {
    kcal: number;
    carbs_g: number;
    protein_g: number;
    fat_g: number;
  };
}

export async function aggregateNutrition(
  items: ParsedFoodItem[]
): Promise<AggregatedNutrition> {
  const results: NutritionResult[] = await Promise.all(
    items.map(async (item) => {
      // Primär: Open Food Facts
      const off = await lookupOpenFoodFacts(item);
      if (off) {
        return { item, ...scale(off, item), source: 'open_food_facts' as const };
      }

      // Fallback: USDA
      const usda = await lookupUSDA(item.search_term);
      if (usda) {
        return { item, ...scale(usda, item), source: 'usda' as const };
      }

      // Letzter Fallback: Nullwerte (kein stiller Fehler)
      console.warn(`[nutrition] No data found for: ${item.search_term}`);
      return { item, kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, source: 'fallback' as const };
    })
  );

  const totals = results.reduce(
    (acc, r) => ({
      kcal: acc.kcal + r.kcal,
      carbs_g: Math.round((acc.carbs_g + r.carbs_g) * 10) / 10,
      protein_g: Math.round((acc.protein_g + r.protein_g) * 10) / 10,
      fat_g: Math.round((acc.fat_g + r.fat_g) * 10) / 10
    }),
    { kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0 }
  );

  return { items: results, totals };
}
```

---

## STEP 5 — Integration in bestehenden Meal-Log-Flow

**Zuerst:** Grep nach der bestehenden Meal-Log-API-Route:

```bash
grep -r "meal" app/api/ --include="*.ts" -l
grep -r "carbs\|nutrition\|openai\|gpt" app/api/ --include="*.ts" -l
```

Finde die Route die:
- Freitext-Eingabe entgegennimmt
- OpenAI aufruft um Nährwerte zu schätzen
- In die `meals`-Tabelle in Supabase schreibt

**Dann:** Ersetze in dieser Route den OpenAI-Nährwert-Block durch den neuen zweistufigen Flow:

```typescript
// VORHER (entfernen):
// const nutrition = await estimateNutritionWithGPT(input);

// NACHHER (einbauen):
import { parseFoodInput } from '@/lib/nutrition/parseFood';
import { aggregateNutrition } from '@/lib/nutrition/aggregateNutrition';

// Im Route Handler:
const parsedItems = await parseFoodInput(userInput);
const { totals, items: nutritionItems } = await aggregateNutrition(parsedItems);

// totals.carbs_g → carbs_grams in DB
// totals.kcal → kcal in DB (falls Spalte existiert)
// nutritionItems → optionale Transparency-Daten (JSON-Spalte oder ignorieren)

// Supabase Insert bleibt EXAKT gleich — nur Werte kommen jetzt aus totals statt GPT
const { error } = await supabase.from('meals').insert({
  user_id: user.id,
  description: userInput,
  carbs_grams: totals.carbs_g,
  // ... restliche Felder unverändert
});
```

**Wichtig — was NICHT geändert wird:**
- Supabase Schema und `meals`-Tabelle
- Voice-Input-Komponente / Frontend
- Auth-Logik / Session-Handling
- Andere API-Routes
- Client-Response-Format (Frontend merkt nichts)

---

## STEP 6 — Environment Variable

Falls noch nicht vorhanden, in `.env.local` und Replit Secrets ergänzen:

```
USDA_API_KEY=DEMO_KEY
```

`DEMO_KEY` ist ausreichend für Development. Für Production: kostenlosen Key auf https://fdc.nal.usda.gov/api-guide.html registrieren.

Der `OPENAI_API_KEY` ist bereits vorhanden.

---

## VERIFY

1. **TypeScript:**
   ```bash
   npx tsc --noEmit
   ```
   → Darf keine Fehler ausgeben.

2. **Funktionstest — bekannte Nährwerte:**
   - Logge "100g Banane"
   - Erwarteter Wert laut Open Food Facts: ~89 kcal, ~23g KH, ~1.1g Protein, ~0.3g Fett
   - Vergleiche mit https://world.openfoodfacts.org/product/search?search_terms=banana
   - Abweichung < 5% ist akzeptabel

3. **Konsistenztest:**
   - Logge denselben Input ("100g Banane") 3× hintereinander
   - Alle drei Einträge müssen identische Nährwerte haben
   - Keine Schwankungen mehr wie vorher mit GPT-Schätzung

4. **Fallback-Test:**
   - Logge ein exotisches Lebensmittel ("Maracuja")
   - Überprüfe in den Logs: wurde USDA als Source verwendet?
   - Nährwerte sollten trotzdem plausibel sein

5. **Git Commit:**
   ```bash
   git add -A && git commit -m "feat: two-stage nutrition lookup — GPT parse + Open Food Facts/USDA DB" && git push origin main
   ```

=== END ===

---

## Reihenfolge
1. `lib/nutrition/parseFood.ts` anlegen
2. `lib/nutrition/openFoodFacts.ts` anlegen
3. `lib/nutrition/usda.ts` anlegen
4. `lib/nutrition/aggregateNutrition.ts` anlegen
5. Bestehende Meal-Log-Route finden (grep) und Integration einfügen
6. `USDA_API_KEY` in Replit Secrets setzen
7. `tsc --noEmit` — clean
8. Funktions- und Konsistenztest
9. Git commit & push
