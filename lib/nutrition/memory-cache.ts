import type { NutritionPer100, NutritionSource } from "./types";

/**
 * Higher-level resolved-item cache — sits above the OFF/USDA race in
 * resolveItem(). When a food name has been resolved on this Lambda
 * instance before, we return the winner immediately without firing any
 * HTTP calls. Complements lib/nutrition/cache.ts (which caches per-source
 * HTTP responses) by skipping even the Promise.any() setup.
 *
 * Key:   normalized item.name (trim + lowercase + collapse whitespace)
 * Value: the winning per100 + source pair
 * Capacity: 500 entries (LRU eviction by insertion order)
 * TTL:   24h (same as the positive HTTP cache — nutrient values are stable)
 *
 * Only DB hits (open_food_facts, usda) are cached. LLM estimates are NOT
 * stored — they are for rare items that vary by phrasing, and memoising
 * them risks serving a stale estimate when a better DB entry appears.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const CACHEABLE_SOURCES = new Set<NutritionSource>(["open_food_facts", "usda"]);

interface Entry {
  per100: NutritionPer100;
  source: NutritionSource;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function memCacheKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function memCacheGet(
  name: string,
): { per100: NutritionPer100; source: NutritionSource } | undefined {
  const key = memCacheKey(name);
  if (!key) return undefined;
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  store.delete(key);
  store.set(key, entry);
  return { per100: entry.per100, source: entry.source };
}

export function memCacheSet(
  name: string,
  per100: NutritionPer100,
  source: NutritionSource,
): void {
  if (!CACHEABLE_SOURCES.has(source)) return;
  const key = memCacheKey(name);
  if (!key) return;
  store.set(key, { per100, source, expiresAt: Date.now() + TTL_MS });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Test-only. */
export function __clearMemCacheForTests(): void {
  store.clear();
}
