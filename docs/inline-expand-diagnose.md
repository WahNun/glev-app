# Diagnose: Inline-Expand 0g-Macros + Source-Tracking

**Branch:** hotfix/inline-expand-macros-sources  
**Date:** 2026-06-21  
**Symptom (TestFlight):** Tap "Details ⌄" → all macros show 0g ±0g; source always "KI-Schätzung"

---

## Bug A — 0g in Inline-Expand

### Data flow

```
Mistral parses "Banane 120g"
  → raw estimates: carbs=27, protein=1, fat=0, fiber=3
  → summary string built IMMEDIATELY:
    "Mahlzeit: Banane 120g (27g KH, 1g P, 0g F, 3g Bal) um ..."

runAggregator()
  → tries user_history → Open Food Facts → USDA → GPT estimate
  → if ALL fail, returns undefined

if runAggregator returns undefined:
  resolvedItems stays undefined
  mealParams.items = undefined      ← items NOT in SSE payload

SSE pending_action frame → useGlevAI.ts → PendingAction.payload
  payload.items = undefined

GlevAIChatSheet.tsx:
  initialItems = p?.items ?? []     ← []
  itemsForExpand = []               ← useState initial

MealChipExpanded render:
  itemsForExpand.length === 0
  → fallback: [{ name, grams:0, carbs:0, protein:0, fat:0, fiber:0 }]
  → computeItemConfidence({ carbs:0, ... }) → ciStr(0, 0.12) → "0 g"
```

**Root cause:** The chip header reads macro values from the `macroStr` summary (built from Mistral's raw estimates before the aggregator runs). The inline-expand reads `item.carbs` from `itemsForExpand`. When the aggregator fails or items are empty, `itemsForExpand` defaults to zero-filled placeholders. There is no link from `macroStr` to the expand render path.

### Why the aggregator frequently fails

- **Off (Open Food Facts):** `wordRe = /\bbananes?\b/i` — "Banane" (German singular) matches "Bananes" but the filter runs on `product_name`. German plurals like "Bananen" fail the regex. OFF also returns 5 candidates sorted by scan count; if the first match has an incomplete nutriments block the lookup returns null.
- **USDA:** `search_term_en` is set to `String(i.name)` — German name ("Banane") sent to the English USDA database. The scorer requires a word-boundary match against the USDA description ("Bananas, raw") using the German search term; this mostly fails because "Banane" is not found in English descriptions.
- **GPT estimate:** Requires `getMistralChatClient()` to be available and respond within 4 seconds. Any timeout or API error causes `estimateItemNutrition` to throw, and `runAggregator` catches all errors and returns `undefined`.

---

## Bug B — Source always "KI-Schätzung"

### Data flow

```
When aggregator fails:
  resolvedItems = undefined
  mealParams.nutritionSource = "estimated"   ← or whatever topLevelSource() yields
  mealParams.items = undefined

SSE payload → itemsForExpand = []

Fallback item: { source: undefined }
  → computeItemConfidence({ source: undefined })
  → lib/nutrition/confidence.ts:
    switch(item.source):
      case "open_food_facts" → "Open Food Facts"
      case "usda" → "USDA FoodData Central"
      default → "KI-Schätzung"   ← undefined falls here

Even when aggregator succeeds and returns items with source: "unknown"
(all lookups failed, GPT estimate failed too), confidence.ts maps
"unknown" → default → "KI-Schätzung".
```

**Root cause:** `computeItemConfidence` inspects `item.source` on the `ParsedFood` object. When items are absent (empty array), the synthesised fallback item has `source: undefined`, so confidence always shows "KI-Schätzung". Even when `mealParams.nutritionSource` carries a real value like `"open_food_facts"`, that top-level string is never forwarded to the per-item `source` field.

---

## Fix

**File:** `components/GlevAIChatSheet.tsx`

### Added `parseSummaryMacros()` (before `MealChipExpanded`)

Parses the `macroStr` summary string that is always present in the chip header. Regex extracts `(\d+(?:\.\d+)?)g KH/P/F/Bal` — identical to the values displayed in the header, so the expand will always match.

### Replaced the fallback item IIFE in the expanded section

```tsx
const hasMacros = itemsForExpand.some(
  it => (it.carbs ?? 0) > 0 || ...
);
const effectiveItems: ParsedFood[] = (() => {
  if (hasMacros) return itemsForExpand;          // real resolved items → use as-is
  const parsed = parseSummaryMacros(macroStr);   // parse header values
  if (parsed) {
    const src: ParsedFood["source"] =
      nutritionSource === "open_food_facts" ? "open_food_facts" :
      nutritionSource === "usda"            ? "usda" :
      (nutritionSource === "user_history" || nutritionSource === "user_confirmed") ? "user_history" :
      "estimated";
    return [{ name: mealName, grams: 0, ...parsed, source: src }];
  }
  return itemsForExpand.length > 0 ? itemsForExpand : [fallback];
})();
```

**Bug A fix:** `parseSummaryMacros` provides the same 27/1/0/3 values the header shows — expand is now always consistent with the header.

**Bug B fix:** `nutritionSource` (top-level `AggregateSource` from the payload) is mapped to a valid `ParsedFood["source"]` so `computeItemConfidence` shows the correct source label. When the aggregator truly failed, `nutritionSource` is `"estimated"` and the label correctly shows "KI-Schätzung".

---

## Bug C — Heuristik-Threshold falsch (Banane 300g → "komplex")

### Root cause

`lib/nutrition/confidence.ts`, `computeMacroConfidence()`, estimated/unknown branch:

```typescript
// before fix
const isComplex = grams > 200 || (macroName === "carbs" && value > 40);
```

Both conditions are gram-/carb-weight proxies. A single banana at 300g triggers `grams > 200 = true` → "komplexes Item ±25%". A large-carb item (>40g KH) is also incorrectly labelled complex. Neither condition reflects structural meal complexity.

### Fix

`lib/nutrition/confidence.ts` — added `isMultiComponent?: boolean` to `ComputeOpts`:

```typescript
const isComplex = opts.isMultiComponent === true;
```

`components/GlevAIChatSheet.tsx` — pass from caller:

```tsx
const conf = computeItemConfidence(item, expandLocale, { isMultiComponent: effectiveItems.length > 2 });
```

Rule: a meal is "complex" only when it has **3+ components** (effectiveItems.length > 2). Single-item and two-item meals always get ±15% regardless of gram weight or carb value.

---

## Acceptance criteria

`"Banane 120g"` →  
- Header: `27g KH, 1g P, 0g F, 3g Bal`  
- Tap "Details ⌄" → KH `27 ±3g`, Eiweiß `1 ±0.3g`, Fett `0g`, Ballaststoffe `3 ±1g`  
- Source line: reflects actual aggregator result (e.g. "Open Food Facts" when aggregator hit OFF, "KI-Schätzung" when it fell back)

`"Banane 300g"` →  
- Heuristic label: "einfaches Item ±15%" (not "komplexes Item ±25%")  
- Same for any single-item or two-item meal, regardless of gram count

`"Erdbeeren 50g + Bananen 300g"` →  
- Both items show real macros  
- Both classified as "einfaches Item ±15%" (2 items, not >2)

---

## Notes on aggregator lookup failures (not fixed in this hotfix)

The aggregator lookup failures for generic German food names are a separate quality issue:

- **OFF:** German plural forms (e.g. "Bananen") will fail the `wordRe` filter. Mitigation: pass `search_term_de` to OFF instead of `name` (already done in `glevTools.ts`), but the product-name filter still uses the raw German singular.
- **USDA:** Passing German `name` to USDA's English DB rarely matches. Fix: always use `search_term_en` (already in the schema; needs verified plumbing in `glevTools.ts`).

These are tracked as separate improvements and do not affect this hotfix (the fix above makes the expand resilient to aggregator failures by falling back to the Mistral estimate, which is already displayed in the header).
