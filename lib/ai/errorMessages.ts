/**
 * `getUserFriendlyMessage` — maps an AppErrorCode (or any unknown string)
 * to a user-visible sentence in the requested locale.
 *
 * This is the primary helper for both server-side error responses and
 * client-side display. It is kept as a thin wrapper over the ERROR_MESSAGES
 * map so callers don't need to import the map directly.
 *
 * Falls back to the UNKNOWN message for any unrecognised code so that
 * legacy API paths (which return neither `error_code` nor a known string)
 * never leak raw technical strings into the UI.
 */

import type { AppErrorCode } from "./errors";
import { ERROR_MESSAGES } from "./errors";

export type { AppErrorCode };

/**
 * Returns a human-readable, locale-correct error message.
 *
 * @param code    - An `AppErrorCode` value. Unknown strings map to UNKNOWN.
 * @param locale  - "de" (default) or "en".
 */
export function getUserFriendlyMessage(
  code: AppErrorCode | string | null | undefined,
  locale: "de" | "en" = "de",
): string {
  if (code && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) {
    return ERROR_MESSAGES[code as AppErrorCode][locale];
  }
  return ERROR_MESSAGES.UNKNOWN[locale];
}

/**
 * Returns `true` for error codes where retrying the same request is
 * expected to help (transient server / network errors).
 */
export function isRetryAllowed(code: AppErrorCode | string | null | undefined): boolean {
  if (!code) return false;
  const retryable: string[] = [
    "CHAT_TIMEOUT",
    "MISTRAL_RATE_LIMITED",
    "NETWORK_ERROR",
    "UPSTREAM_ERROR",
  ];
  return retryable.includes(code);
}
