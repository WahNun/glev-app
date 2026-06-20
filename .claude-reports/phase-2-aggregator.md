# Phase 2 — Smart Aggregator

Branch: `feat/macros-aggregator-phase-2`
Commits: `12ee2b13` (core) + `47582e77` (UI + tests)
Date: 2026-06-04

## Geänderte Files

| File | Art | Beschreibung |
|---|---|---|
| `lib/meals.ts` | geändert | `ParsedFood.source` auf vollen `NutritionSource` Typ erweitert (+ `user_history`, `user_confirmed`) |
| `lib/useGlevAI.ts` | geändert | `MealPendingPayload` Type mit `items?: ParsedFood[]`; Import `ParsedFood` |
| `lib/ai/glevTools.ts` | geändert | Mistral-Schema: `items[]`-Parameter; Aggregator-Integration in `toolLogMealEntry`; Imports für `aggregateNutrition`, `lookupUserFoodHistory`, `ParsedFoodItem` |
| `components/GlevAIChatSheet.tsx` | geändert | Chip liest `MealPendingPayload.items[]` mit echten Sources; `aggregateBadge()` für Header-Badge; Phase-2-Quell-Typen |
| `app/(protected)/engine/page.tsx` | geändert | `parsedItems`-State-Typ auf volle NutritionSource; AI-Estimate-Infobanner |
| `app/(protected)/settings/data-sources/page.tsx` | geändert | `SourceStats`-Komponente: Query auf `meals.parsed_json`, Balkendiagramm |
| `.env.example` | geändert | `MACRO_AGGREGATOR_V2` Feature-Flag dokumentiert |
| `tests/unit/macrosTransparencyPhase2.test.ts` | neu | 11 Tests |

## Migration-Pfad

**Keine DB-Migration nötig.** Die Sources werden in `meals.parsed_json` (JSONB) gespeichert, das bereits existiert. `ParsedFood.source` war schon optional. Historische Rows ohne `source` bleiben unverändert.

## Feature-Flag

```
MACRO_AGGREGATOR_V2=true
```
In Vercel setzen: Settings → Environment Variables → add `MACRO_AGGREGATOR_V2 = true`.

**Flag aus (default):** Identisches Verhalten zu Phase 1 — Mistral-only Macros, kein `items[]`.

**Flag an:** Bei jedem `log_meal_entry`-Tool-Call (wenn Mistral `items[]` mitliefert) läuft der Aggregator:
1. Lädt User-History (`lookupUserFoodHistory`)
2. Löst jedes Item über OFF/USDA/GPT auf (`aggregateNutrition`)
3. Schreibt resolved `items[]` in `payload` + ersetzt Totals

## Beispiel Aggregator-Log

```
[meal_prep] aggregator: 3 items, 2 db-hits, 1 estimates, 342ms total
```
(Hähnchen → usda ✅, Basmatireis → open_food_facts ✅, Ketchup → estimated ✨)

## Test-Output

```
28 passed (4.2s)
  ├── macrosTransparencyPhase1.test.ts: 17 tests
  └── macrosTransparencyPhase2.test.ts: 11 tests
```

## Rollout-Hinweise

1. **Kein Breaking Change:** Flag off = Phase 1 Verhalten. Sanfter Rollout möglich.
2. **Performance:** Aggregator läuft parallel (Promise.all); 3-4s Timeout je OFF/USDA-Call. Bei 5 Items worst-case ~4s Latenz — acceptable da der User ohnehin den Chat-Chip bestätigt.
3. **Mistral muss items[] liefern:** Das neue Schema listet `items[]` als optionalen Parameter. Mistral liefert ihn, wenn es die Mahlzeit strukturieren kann. Bei "60g KH gesamt" ohne Items-Zerlegung bleibt `items` leer → Flag on bringt dann nichts.
4. **Statistik in Settings:** Query auf `meals.parsed_json`, limitiert auf 500 Rows / 30 Tage. Graceful-absent wenn Supabase nicht erreichbar.

## Offene Fragen / Phase 3

- **System-Prompt-Update** für Mistral: Im aktuellen System-Prompt steht kein expliziter Hinweis, `items[]` zu liefern. Die Schreibung in der Tool-Description (`"Wenn du die Mahlzeit in sinnvolle Komponenten aufteilen kannst..."`) reicht für erste Tests, sollte aber in einem dedizierten Prompt-Update verfestigt werden.
- **Aggregator-Cache:** Bei wiederholten Anfragen für dieselbe Mahlzeit (z. B. tägliches Oatmeal) würde OFF/USDA immer wieder abgefragt. Phase 3 könnte einen Tool-Level-Cache (Redis/Edge-KV) einziehen.
- **item_breakdown in saveMeal:** Die `parsedItems[]` (Engine-State) werden bereits in `parsed_json` gespeichert — das schließt die Sources automatisch ein wenn der User über den Engine-Flow speichert. Der direkte Chat-Speicher-Pfad (`toolLogMealEntry` → `createPendingAction`) schreibt noch kein `parsed_json` — das passiert erst wenn der User im Engine bestätigt.
