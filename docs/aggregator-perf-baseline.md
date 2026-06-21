# Aggregator Performance Baseline

Measured: 2026-06-21 · window: last 24h · n=3 traces (early data, low volume)

## Before Optimizations

| final_nutrition_source | n | avg_ms | p50_ms | p95_ms | max_ms |
|------------------------|---|--------|--------|--------|--------|
| mixed                  | 1 | 1125   | 1125   | 1125   | 1125   |
| usda                   | 1 | 901    | 901    | 901    | 901    |
| user_history           | 1 | 1      | 1      | 1      | 1      |

**Observations:**
- Cache hit (user_history): 1ms ✓
- USDA-only: 901ms — single HTTP call, already hitting the 1.5s timeout ceiling
- Mixed (multi-source): 1125ms — sequential lookups compound latency

## What was already implemented (discovered during this sprint)

Reviewing `lib/nutrition/aggregate.ts` before making changes:

- `Promise.any(raceOrder)` — OFF and USDA already fire in parallel (Phase 2 of the sprint was pre-done)
- `Promise.all(items.map(...))` — all items in a meal resolve concurrently (Phase 5 pre-done)
- LLM only called if both OFF and USDA miss (Phase 4 pre-done)
- `lib/nutrition/cache.ts` — per-process LRU at the HTTP layer (1000 entries, 24h/1h TTL, Phase 3 partially pre-done)

## What this sprint adds

- `lib/nutrition/memory-cache.ts` — higher-level LRU (500 entries, 24h TTL) that caches the **winning resolved result** above the race. A hit skips both `lookupOpenFoodFacts` and `lookupUSDA` calls entirely and records `source: "memory_cache"` in the trace for visibility.

## After (target)

| path                  | target p50 | target p95 |
|-----------------------|-----------|-----------|
| user_history hit      | <5ms      | <5ms      |
| memory_cache hit      | <2ms      | <5ms      |
| USDA / OFF live hit   | <600ms    | <900ms    |
| LLM fallback          | <3000ms   | <4000ms   |

*Measure again after 1 week of traffic. Cache-hit-rate (user_history + memory_cache combined) target: >70% for repeated items.*
