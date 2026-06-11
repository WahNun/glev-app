/**
 * Generic server-side retry helper for AI provider 429 rate-limit responses.
 *
 * Both the Mistral chat route and the OpenAI transcribe route share the same
 * back-off logic: detect a 429, read `Retry-After`, sleep, retry up to
 * `maxRetries` times — but bail out early when the wait would exceed
 * `maxRetryWaitMs` (prefer surfacing a client-side retry over burning
 * serverless function time).
 *
 * This module extracts that shared core so future AI routes don't need to
 * copy-paste it. Provider-specific quirks (how to detect 429, which Error
 * subclass to throw) are injected via `RetryOpts`.
 */

export interface RetryOpts<E extends Error> {
  /** Returns true when the caught error is a 429 rate-limit from this provider. */
  is429: (e: unknown) => boolean;
  /**
   * Reads the Retry-After delay in seconds from the error object.
   * Omit to use `defaultGetRetryAfterSec` which handles both integer-seconds
   * and HTTP-date formats and defaults to 5 s.
   */
  getRetryAfterSec?: (e: unknown) => number;
  /** Maximum number of retries before giving up. */
  maxRetries: number;
  /**
   * Maximum acceptable wait in ms. When `Retry-After` would require waiting
   * longer than this we throw immediately rather than sleeping (the client
   * will handle the retry instead).
   */
  maxRetryWaitMs: number;
  /** Constructs the typed error thrown when all retries are exhausted. */
  makeRateLimitError: (retryAfterSec: number, attempts: number) => E;
  /** Prefix for `console.warn` messages, e.g. `"[chat]"` or `"[transcribe]"`. */
  logPrefix: string;
  /**
   * Optional: returns true when the caught error is a 5xx server error
   * (overloaded, gateway timeout, etc.). When provided, the call is retried
   * up to `max5xxRetries` times with a fixed `retry5xxDelayMs` delay before
   * the error is re-thrown. This silently recovers transient provider outages
   * without surfacing UPSTREAM_ERROR to the user.
   */
  is5xx?: (e: unknown) => boolean;
  /** How many times to retry 5xx errors. Defaults to 1. */
  max5xxRetries?: number;
  /** Fixed delay in ms between 5xx retries. Defaults to 1 500. */
  retry5xxDelayMs?: number;
}

/**
 * Parses the `Retry-After` value from a provider SDK error.
 * Supports both the integer-seconds format and the HTTP-date format.
 * Defaults to 5 s when the header is absent or unparseable.
 */
export function defaultGetRetryAfterSec(e: unknown): number {
  if (!e || typeof e !== "object") return 5;
  const err = e as Record<string, unknown>;
  const headers = err.headers as Record<string, string> | undefined;
  if (headers) {
    const ra = headers["retry-after"] ?? headers["Retry-After"];
    if (ra) {
      const n = Number(ra);
      if (!isNaN(n) && n > 0) return Math.ceil(n);
      const date = Date.parse(ra);
      if (!isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
    }
  }
  return 5;
}

/**
 * Wraps an AI provider API call with server-side 429 retry logic.
 *
 * - Retries up to `opts.maxRetries` times on 429 responses.
 * - Sleeps for the `Retry-After` duration between attempts (defaults to 5 s).
 * - Throws `opts.makeRateLimitError(retryAfterSec, attempts)` when:
 *   - all retries are exhausted, OR
 *   - the Retry-After delay would exceed `opts.maxRetryWaitMs`.
 * - All non-429 errors propagate as-is.
 *
 * @param fn     - Factory that performs one API call.
 * @param opts   - Provider-specific configuration (see `RetryOpts`).
 * @param _sleep - Injectable sleep for unit tests. Defaults to `setTimeout`.
 */
export async function callWithRetry<T, E extends Error>(
  fn: () => Promise<T>,
  opts: RetryOpts<E>,
  _sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  const getRetryAfterSec = opts.getRetryAfterSec ?? defaultGetRetryAfterSec;
  const max5xx = opts.max5xxRetries ?? 1;
  const delay5xx = opts.retry5xxDelayMs ?? 1_500;
  let attempt429 = 0;
  let attempt5xx = 0;

  while (true) {
    try {
      return await fn();
    } catch (e) {
      // ── 5xx server error (overloaded, gateway timeout, etc.) ──────
      if (opts.is5xx && opts.is5xx(e)) {
        if (attempt5xx < max5xx) {
          attempt5xx++;
          const errCode = (() => {
            if (!e || typeof e !== "object") return "?";
            const err = e as Record<string, unknown>;
            return String(err.statusCode ?? err.status ?? "5xx");
          })();
          console.warn(`${opts.logPrefix} server error ${errCode} — retry ${attempt5xx}/${max5xx} in ${delay5xx}ms`);
          await _sleep(delay5xx);
          continue;
        }
        // All 5xx retries exhausted — re-throw as-is (becomes UPSTREAM_ERROR).
        throw e;
      }

      // ── 429 rate limit ────────────────────────────────────────────
      if (!opts.is429(e)) throw e;

      const retryAfterSec = getRetryAfterSec(e);
      attempt429++;

      console.warn(`${opts.logPrefix} rate limit 429`, {
        attempt: attempt429,
        retry_after_sec: retryAfterSec,
      });

      if (attempt429 > opts.maxRetries || retryAfterSec * 1000 > opts.maxRetryWaitMs) {
        throw opts.makeRateLimitError(retryAfterSec, attempt429);
      }

      await _sleep(retryAfterSec * 1000);
    }
  }
}
