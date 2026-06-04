/**
 * In-memory per-session user-food-history cache (Phase 3 — Deliverable 8).
 *
 * Motivation: lookupUserFoodHistory() hits the DB on every aggregateNutrition()
 * call. For a chat session where the user logs 3-4 meals, that's 3-4 redundant
 * identical SELECT queries. This module caches the result keyed by userId with a
 * 5-minute TTL so the aggregator can resolve history hits in <1ms.
 *
 * The cache lives in the server process (same instance / warm Lambda), so
 * cross-request reuse depends on Vercel keeping the instance warm. A cold
 * start still hits the DB exactly once; subsequent calls within the TTL
 * window are served from memory.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupUserFoodHistory } from "./userFoodHistory";
import type { UserFoodHistoryHit } from "./userFoodHistory";

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

interface CacheEntry {
  map: Map<string, UserFoodHistoryHit>;
  names: Set<string>;
  expiresAt: number;
}

// Keyed by userId.
const store = new Map<string, CacheEntry>();

/**
 * Returns a pre-loaded user-history Map for the given item names.
 * On the first call for a user (or after TTL expiry) it fetches from DB.
 * Subsequent calls within TTL are served from the in-memory cache.
 *
 * Cache is additive: if new names are requested that weren't in the
 * previous fetch, they are fetched incrementally and merged in.
 */
export async function getCachedUserHistory(
  sb: SupabaseClient,
  userId: string,
  names: string[],
): Promise<Map<string, UserFoodHistoryHit>> {
  if (!userId || names.length === 0) return new Map();

  const now = Date.now();
  const entry = store.get(userId);

  if (entry && entry.expiresAt > now) {
    // Check if any names are missing from the cached set.
    const missing = names.filter((n) => !entry.names.has(n.toLowerCase()));
    if (missing.length > 0) {
      // Incremental fetch for new names only.
      const fresh = await lookupUserFoodHistory(sb, userId, missing).catch(() => new Map());
      fresh.forEach((v, k) => { entry.map.set(k, v); });
      missing.forEach((n) => entry.names.add(n.toLowerCase()));
    }
    return entry.map;
  }

  // Cold or expired — fetch all requested names.
  const map = await lookupUserFoodHistory(sb, userId, names).catch(() => new Map());
  store.set(userId, {
    map,
    names: new Set(names.map((n) => n.toLowerCase())),
    expiresAt: now + CACHE_TTL_MS,
  });
  return map;
}

/** Invalidate a user's cache (call after saveMeal to pick up new history). */
export function invalidateUserHistory(userId: string): void {
  store.delete(userId);
}

/** Test-only: clear all entries. */
export function __clearUserHistoryCacheForTests(): void {
  store.clear();
}
