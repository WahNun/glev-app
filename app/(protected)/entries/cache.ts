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

export interface WritableStorageLike extends StorageLike {
  setItem(key: string, value: string): void;
}

/** Maximum serialised byte size before oldest meals are trimmed. */
const CACHE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MB

/**
 * Writes the entries cache for `uid` to `storage`.
 *
 * Assembles the payload with `cachedAt` set to `now` (injectable for
 * deterministic tests, defaults to `Date.now()`), trims the oldest meals
 * when the serialised size would exceed 2 MB, and swallows any
 * `setItem` error (e.g. QuotaExceededError) so a write failure never
 * crashes the page.
 */
export function writeEntriesCache(
  uid: string,
  storage: WritableStorageLike,
  data: Omit<CachedEntries, "cachedAt">,
  now: number = Date.now(),
): void {
  const cacheKey = `${ENTRIES_CACHE_KEY_PREFIX}:${uid}`;
  let payload: CachedEntries = { cachedAt: now, ...data };
  let serialized = JSON.stringify(payload);

  // meals are ordered newest-first; trim from the tail to drop the oldest
  // entries until the payload fits within the 2 MB quota limit.
  const byteLength = (s: string) => new TextEncoder().encode(s).length;
  while (byteLength(serialized) > CACHE_SIZE_LIMIT && payload.meals.length > 0) {
    payload = { ...payload, meals: payload.meals.slice(0, -1) };
    serialized = JSON.stringify(payload);
  }

  try {
    storage.setItem(cacheKey, serialized);
  } catch {
    // Storage quota exceeded — cache write is best-effort; do not crash.
  }
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
