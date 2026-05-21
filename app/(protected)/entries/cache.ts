// Pure cache helpers for the entries localStorage TTL cache.
//
// Extracted from entries/page.tsx so they can be imported by unit tests
// without pulling in the full Next.js client component tree.
//
// The two exported symbols that page.tsx (and tests) rely on:
//   ENTRIES_CACHE_KEY_PREFIX  — key namespace, must stay stable (migration would
//                               leave stale keys in existing users' localStorage)
//   ENTRIES_CACHE_TTL_MS      — 10-minute window; changing it is a user-visible
//                               behaviour change and must have a test update.
//   readEntriesCache          — pure function; no React, no Supabase dependency.

export const ENTRIES_CACHE_KEY_PREFIX = "glev:entries-cache";
export const ENTRIES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface CachedEntries {
  cachedAt: number;
  meals: unknown[];
  insulin: unknown[];
  exercise: unknown[];
  cycle: unknown[];
  symptoms: unknown[];
  influences: unknown[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/**
 * Reads the entries cache for `uid` from `storage`.
 *
 * Returns the parsed `CachedEntries` when the cache is fresh (age ≤ TTL),
 * returns `null` for every other case (miss, expired, or malformed), and
 * calls `storage.removeItem` when a stale/malformed entry is evicted.
 *
 * `now` defaults to `Date.now()` but is injectable for deterministic tests.
 */
export function readEntriesCache(
  uid: string,
  storage: StorageLike,
  now: number = Date.now(),
): CachedEntries | null {
  const cacheKey = `${ENTRIES_CACHE_KEY_PREFIX}:${uid}`;
  const raw = storage.getItem(cacheKey);
  if (!raw) return null;

  let cached: unknown;
  try {
    cached = JSON.parse(raw);
  } catch {
    storage.removeItem(cacheKey);
    return null;
  }

  if (
    !cached ||
    typeof cached !== "object" ||
    typeof (cached as Record<string, unknown>).cachedAt !== "number" ||
    now - ((cached as Record<string, unknown>).cachedAt as number) > ENTRIES_CACHE_TTL_MS
  ) {
    storage.removeItem(cacheKey);
    return null;
  }

  const c = cached as CachedEntries;
  if (!Array.isArray(c.meals)) return null;

  return c;
}
