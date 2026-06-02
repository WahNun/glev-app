/**
 * Module-level in-memory cache for the active AI system prompt.
 *
 * Why a shared module instead of a closure inside the route?
 * `saveAgentPrompt` / `resetAgentPrompt` live in a Server Action file and
 * need to be able to bust the cache on write. A shared module gives both
 * sides a stable reference to the same object within a given serverless
 * function instance.
 *
 * TTL is 60 seconds — prompt changes propagate within one minute, which is
 * fast enough for the admin use-case while eliminating the DB round-trip
 * on every chat message.
 */

const CACHE_TTL_MS = 60_000;

let _cachedPrompt: string | null = null;
let _cachedAt: number = 0;

/**
 * Returns a cached prompt text if the cache is still fresh (< 60 s old),
 * or `null` if the cache is stale / empty. The caller is responsible for
 * fetching from the DB and calling `setSystemPromptCache` to populate it.
 */
export function getSystemPromptCache(): string | null {
  if (_cachedPrompt !== null && Date.now() - _cachedAt < CACHE_TTL_MS) {
    return _cachedPrompt;
  }
  return null;
}

/**
 * Stores `prompt` in the cache together with the current timestamp.
 */
export function setSystemPromptCache(prompt: string): void {
  _cachedPrompt = prompt;
  _cachedAt = Date.now();
}

/**
 * Immediately invalidates the cache. Call this after every successful
 * `saveAgentPrompt` or `resetAgentPrompt` so the next chat request picks
 * up the new prompt without waiting for the TTL to expire.
 */
export function bustSystemPromptCache(): void {
  _cachedPrompt = null;
  _cachedAt = 0;
}
