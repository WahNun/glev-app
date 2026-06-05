import { NextRequest } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";
import { errorResponse } from "@/lib/api/errorResponse";
import { callWithRetry, defaultGetRetryAfterSec } from "@/lib/ai/retryWithRateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RETRY_WAIT_MS = 8_000;
const MAX_OPENAI_RETRIES = 2;

/**
 * Thrown by `callOpenAIWithRetry` when all server-side retry attempts
 * are exhausted or the Retry-After delay exceeds MAX_RETRY_WAIT_MS.
 */
export class OpenAIRateLimitError extends Error {
  readonly retry_after_sec: number;
  readonly attempts: number;

  constructor(retry_after_sec: number, attempts: number) {
    super("OPENAI_RATE_LIMITED");
    this.name = "OpenAIRateLimitError";
    this.retry_after_sec = retry_after_sec;
    this.attempts = attempts;
  }
}

/**
 * Returns `true` when the caught error represents an OpenAI HTTP 429.
 * The OpenAI SDK surfaces rate-limits as thrown errors with a `status`
 * field (SDK v4 uses `status`; older SDKs may use `statusCode`).
 */
function isOpenAI429Error(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.status === 429 ||
    err.statusCode === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

/**
 * Wraps an OpenAI API call with up to `MAX_OPENAI_RETRIES` server-side
 * retries on 429 responses. Backs off for the `Retry-After` duration
 * (default 5 s) between attempts.
 *
 * Throws `OpenAIRateLimitError` when:
 * - All retries are exhausted, OR
 * - The Retry-After delay would exceed `MAX_RETRY_WAIT_MS` (prefer
 *   surfacing a client-side retry over burning Vercel function time).
 *
 * All other errors propagate as-is.
 *
 * Delegates to the shared `callWithRetry` helper in
 * `lib/ai/retryWithRateLimit.ts`; OpenAI-specific quirks (status vs
 * statusCode field) stay isolated here via `isOpenAI429Error`.
 *
 * @param fn     - Factory that performs one OpenAI API call.
 * @param _sleep - Injectable sleep function for unit tests.
 */
export async function callOpenAIWithRetry<T>(
  fn: () => Promise<T>,
  _sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  return callWithRetry(fn, {
    is429: isOpenAI429Error,
    getRetryAfterSec: defaultGetRetryAfterSec,
    maxRetries: MAX_OPENAI_RETRIES,
    maxRetryWaitMs: MAX_RETRY_WAIT_MS,
    makeRateLimitError: (retryAfterSec, attempts) =>
      new OpenAIRateLimitError(retryAfterSec, attempts),
    logPrefix: "[transcribe] OpenAI",
  }, _sleep);
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return errorResponse("UPSTREAM_ERROR", 400);
    }
    const tForm = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] formData parse:", tForm - t0, "ms · audio:", Math.round(file.size / 1024), "KB ·", file.type);

    let openai;
    try { openai = getOpenAIClient(); }
    catch { return errorResponse("UPSTREAM_ERROR", 503); }

    const tInit = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] openai init:", tInit - tForm, "ms");

    let transcription;
    try {
      transcription = await callOpenAIWithRetry(() =>
        openai.audio.transcriptions.create({
          file,
          model: "gpt-4o-mini-transcribe",
        }),
      );
    } catch (e) {
      if (e instanceof OpenAIRateLimitError) {
        // eslint-disable-next-line no-console
        console.warn("[transcribe] OpenAI rate limit exhausted after", e.attempts, "attempts");
        return errorResponse("OPENAI_RATE_LIMITED", 429, {
          retry_after_sec: e.retry_after_sec,
          attempts: e.attempts,
        });
      }
      throw e;
    }

    const tDone = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] Whisper call:", tDone - tInit, "ms · text len:", (transcription.text ?? "").length, "chars · total:", tDone - t0, "ms");

    return Response.json({ text: transcription.text ?? "" });
  } catch (err: unknown) {
    const tErr = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] FAILED after:", tErr - t0, "ms");
    const msg = err instanceof Error ? err.message : "Transcription failed";
    // eslint-disable-next-line no-console
    console.error("[transcribe] unexpected error:", msg);
    return errorResponse("UPSTREAM_ERROR", 500);
  }
}
