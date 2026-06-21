# OFF/USDA Backend Lookup — Diagnose & Fix (2026-06-21)

## Symptom

„1 Banane" → Aggregator returns `nutritionSource = 'estimated'` (GPT fallback).
Open Food Facts and USDA were not queried effectively, even though banana is
high-frequency in both databases.

Reported: Lucas TestFlight 2026-06-21.

---

## Root Cause #1 — CRITICAL: Missing bilingual search terms in toolLogMealEntry

**File:** `lib/ai/glevTools.ts` → `runAggregator()`, lines ~1644–1661

When `toolLogMealEntry` builds `ParsedFoodItem[]` from Mistral's tool-call
`items[]`, it was setting `search_term_en = item.name` and
`search_term_de = item.name`. For a German user, Mistral returns
`{name: "banane", grams: 120}` — so both search terms were `"banane"`.

In `aggregate.ts`, USDA receives `search_term_en`:
```
const usdaTerm = item.search_term_en || item.name;  // "banane"
```

USDA's word-boundary scorer rejects `"banane"` against all English entries:
- `/\bbananes?\b/i.test("bananas, raw")` → **false** → `-Infinity` score
- Every USDA candidate scores `-Infinity` → `lookupUSDA` returns `null`

OFF receives `search_term_de = "banane"` which CAN work, but:
- The most-scanned German OFF products are named "Bananen" (plural), not "Banane"
- The word-boundary regex `/\bbananes?\b/i` does NOT match "bananen"
  (after "banane" comes "n", not a word boundary)
- All top-5 OFF candidates can be rejected → `lookupOpenFoodFacts` returns `null`

Result: both DB lookups return `null` → `Promise.any` rejects → GPT fallback →
`source: 'estimated'`.

**This bug was introduced when the aggregator path in `toolLogMealEntry` was
wired up (PR #30 era).** The standalone `/api/parse-food` endpoint correctly
calls `parseFoodText()` first, which produces proper bilingual terms
(`search_term_en: "banana"`, `search_term_de: "banane"`). The `toolLogMealEntry`
path bypassed `parseFoodText` entirely and constructed `ParsedFoodItem[]`
directly from tool-call args without bilingual terms.

---

## Root Cause #2 — SECONDARY: OFF word-boundary regex rejects German plurals

**File:** `lib/nutrition/openFoodFacts.ts`, lines ~95–99

The regex `new RegExp(\`\\b${escaped}s?\b\`, "i")` handles English `-s` plurals
(e.g. "banana" → "bananas") but not German `-n`/`-en` plurals:
- "banane" → `/\bbananes?\b/i`
- "bananen" → no match (n after "banane" is a word character, not a boundary)

Most popular German OFF product names for banana queries use "Bananen" (plural).

---

## Fix #1 — Call parseFoodText in runAggregator

`lib/ai/glevTools.ts`: added `parseFoodText` import and call inside
`runAggregator` when `rawItems` is not empty:

```typescript
const itemsText = rawItems.map((i) => `${i.grams}g ${i.name}`).join(", ");
parseResult = await parseFoodText(itemsText, "de");
// → items[0].search_term_en = "banana", search_term_de = "banane"
```

Each `ParsedFoodItem` now gets proper bilingual terms from Mistral Small.
Fallback: if `parseFoodText` throws, `item.name` is used for both terms (same
as before = USDA miss for non-English names, OFF may still succeed).

**Trace after fix for "1 Banane":**
1. `parseFoodText("120g banane")` → `search_term_en: "banana"`, `search_term_de: "banane"`
2. USDA with `"banana"` → `t.endsWith("s") = false`, `stem = "banana"`,
   `wordRe = /\bbananas?\b/i` → matches "Bananas, raw" → **HIT** ✓
3. OFF with `"banane"` → (now also improved by Fix #2) → **HIT** ✓
4. `Promise.any([usdaHit, offHit])` → first non-null wins → `source: "usda"` ✓
5. `nutritionSource = "usda"` ✓

Latency impact: +~1.5s for `parseFoodText` call (Mistral Small). Total
aggregator: ~2.1s. Well within the 18s endpoint timeout.

---

## Fix #2 — Extend OFF word-boundary regex for German -n plural

`lib/nutrition/openFoodFacts.ts`: for search terms ending in `-e`, use
`[sn]?` instead of `s?` so "bananen" also matches "banane":

```typescript
const pluralSuffix = stem.endsWith("e") ? "[sn]?" : "s?";
const wordRe = new RegExp(`\\b${escaped}${pluralSuffix}\\b`, "i");
```

This correctly matches "Bananen" and "Tomaten" while still rejecting
"Bananenchips" (the "n" is followed by more word chars, no boundary).

---

## What was NOT the cause

- `json_object` vs `json_schema strict` in `parseFoodText` — the parser always
  fell back gracefully (item.name as default). The real issue was parseFoodText
  was never called in the `toolLogMealEntry` path.
- OFF API downtime — not observed. The issue is reproducible when OFF is healthy.
- USDA API downtime — same.
- User food history — new users with < 3 occurrences of "banane" fall through
  to Phase 3 (DB lookup), where the bug manifested.

---

## Files changed

| File | Change |
|------|--------|
| `lib/ai/glevTools.ts` | Import `parseFoodText`; call it in `runAggregator` to generate bilingual terms |
| `lib/nutrition/openFoodFacts.ts` | Extend word-boundary regex to accept German `-n` plural suffix |
| `DECISIONS.md` | Append fix record |
