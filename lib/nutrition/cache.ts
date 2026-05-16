import type { NutritionPer100 } from "./types";

/**
 * Per-process LRU cache for Open Food Facts and USDA lookups.
 *
 * Why a process-local cache and not Redis / a DB table?
 *   * Vercel serverless functions stay warm for several minutes between
 *     invocations on the same instance, so even a humble in-memory
 *     cache absorbs most of the repeat hits from a single chat /
 *     voice-parse session and the burst of multi-user activity that
 *     sits on the same warm instance.
 *   * Zero infrastructure cost, zero new failure mode, zero auth
 *     handshake added to the request critical path.
 *   * If the cache is cold, the system behaves exactly as before:
 *     fall through to the live HTTP call, same timeout, same null
 *     semantics. No accuracy trade-off.
 *
 * Cache key: `<source>:<normalized search term>`
 *   normalized = trim + lowercase + collapse whitespace. We do NOT
 *   strip diacritics — "Apfel" and "apfel" should hit, but "Apfel"
 *   and "Aepfel" must not (they yield different OFF/USDA results).
 *
 * TTL:
 *   * Positive hits: 24h. Nutriment values for a given product change
 *     extremely rarely (recipe reformulations are months/years apart).
 *   * Negative hits: 1h. Shorter so a typo today doesn't suppress a
 *     real miss tomorrow when OFF / USDA might have added the item.
 *
 * Capacity: 1000 entries per source (~hundreds of KB total). At eviction
 * the OLDEST entry by insertion order is dropped — Map preserves
 * insertion order, and on every `get(key)` for an existing entry we
 * delete-and-reinsert so frequently-accessed keys stay fresh. That's
 * the classic Map-based LRU.
 *
 * NOT cached:
 *   * Errors mid-fetch (timeouts, network failures). They throw / return
 *     null in the underlying client; we don't memoize transient noise.
 */

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

interface Entry {
  value: NutritionPer100 | null;
  expiresAt: number;
}

const caches = new Map<string, Map<string, Entry>>();

function bucket(source: string): Map<string, Entry> {
  let m = caches.get(source);
  if (!m) {
    m = new Map<string, Entry>();
    caches.set(source, m);
  }
  return m;
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Look up a previously cached result. Returns:
 *   * { value: NutritionPer100 } — fresh positive hit
 *   * { value: null }            — fresh negative hit (don't re-fetch)
 *   * undefined                  — no entry or entry expired
 */
export function cacheGet(
  source: "off" | "usda",
  term: string,
): { value: NutritionPer100 | null } | undefined {
  const key = normalizeTerm(term);
  if (!key) return undefined;
  const m = bucket(source);
  const entry = m.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    m.delete(key);
    return undefined;
  }
  m.delete(key);
  m.set(key, entry);
  return { value: entry.value };
}

export function cacheSet(
  source: "off" | "usda",
  term: string,
  value: NutritionPer100 | null,
): void {
  const key = normalizeTerm(term);
  if (!key) return;
  const m = bucket(source);
  const ttl = value === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
  m.set(key, { value, expiresAt: Date.now() + ttl });
  while (m.size > MAX_ENTRIES) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

/** Test-only helper. Wipes every bucket. */
export function __clearNutritionCacheForTests(): void {
  caches.clear();
}
