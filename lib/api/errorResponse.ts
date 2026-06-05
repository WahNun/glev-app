/**
 * `errorResponse` — standardised server-side error response helper.
 *
 * All AI chat error paths in `app/api/ai/chat/route.ts` use this helper
 * so every error response has the same shape:
 *
 *   {
 *     error_code:   AppErrorCode   — machine-readable code for the client
 *     user_message: string         — friendly sentence in the default locale (de)
 *     retry_allowed: boolean       — true = transient, client may offer a retry
 *     ...extra                     — optional metadata (e.g. retry_after_sec, attempts)
 *   }
 *
 * Tech details (raw error messages, stack traces, DB errors) are NOT
 * included in the response body — they go to `console.error` only.
 */

import { NextResponse } from "next/server";
import type { AppErrorCode } from "@/lib/ai/errors";
import { getUserFriendlyMessage, isRetryAllowed } from "@/lib/ai/errorMessages";

export type ErrorResponseBody = {
  error_code: AppErrorCode;
  user_message: string;
  retry_allowed: boolean;
  [key: string]: unknown;
};

/**
 * Creates a `NextResponse` with the standard error envelope.
 *
 * @param code   - One of the 9 `AppErrorCode` values.
 * @param status - HTTP status code (401, 403, 429, 400, 500, 503, …).
 * @param extra  - Optional extra fields merged into the response body.
 *                 Used for metadata the client needs (e.g. `retry_after_sec`,
 *                 `attempts`) — never for raw internal error strings.
 */
export function errorResponse(
  code: AppErrorCode,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse<ErrorResponseBody> {
  const body: ErrorResponseBody = {
    error_code: code,
    user_message: getUserFriendlyMessage(code, "de"),
    retry_allowed: isRetryAllowed(code),
    ...extra,
  };
  return NextResponse.json(body, { status });
}
