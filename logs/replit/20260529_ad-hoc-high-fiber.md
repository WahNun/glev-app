# HIGH_FIBER Meal Classification

**Date:** 2026-05-29  
**Type:** ad-hoc

## Summary
Introduced a fifth meal classification class `HIGH_FIBER` (fiber ≥ 7g AND fiber/carbs ≥ 0.20). Updated all related surfaces: classification logic, engine evaluation, GPT prompt, translations (de + en), Insights page, Entries filter.

## Files changed
- `lib/meals.ts` — classifyMeal() new HIGH_FIBER rule
- `lib/mealTypes.ts` — MealType union, TYPE_COLORS/LABELS/SHORT/EXPLAIN
- `lib/engine/evaluation.ts` — SPIKE_CUTOFF_HIGH_FIBER=40, Classification type, classKey(), spike switch
- `lib/ai/systemPrompt.ts` — mealType union + HIGH_FIBER rule
- `messages/de.json` — engine_class, type/explain (2 namespaces), meal_type_back_p1
- `messages/en.json` — same
- `app/(protected)/insights/page.tsx` — types object, both TYPE_ORDER arrays, best/worst label
- `app/(protected)/entries/page.tsx` — MealKindKey union, MEAL_KIND_OPTIONS
