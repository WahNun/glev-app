/**
 * Unit tests for the centralised error-message layer.
 *
 * Covers:
 *   - `getUserFriendlyMessage` for all 9 AppErrorCodes × 2 locales
 *   - `isRetryAllowed` — true for transient codes, false for permanent ones
 *   - `AppError` constructor and `toUserMessage`
 *   - `errorResponse` HTTP helper — shape, status, retry_allowed
 */

import { test, expect } from "@playwright/test";
import { getUserFriendlyMessage, isRetryAllowed } from "@/lib/ai/errorMessages";
import type { AppErrorCode } from "@/lib/ai/errors";
import { AppError, ALL_ERROR_CODES, ERROR_MESSAGES } from "@/lib/ai/errors";

// ---------------------------------------------------------------------------
// getUserFriendlyMessage — all codes × both locales
// ---------------------------------------------------------------------------

const CODES: AppErrorCode[] = [...ALL_ERROR_CODES];

for (const code of CODES) {
  test(`getUserFriendlyMessage("${code}", "de") returns non-empty German string`, () => {
    const msg = getUserFriendlyMessage(code, "de");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(5);
    expect(msg).toBe(ERROR_MESSAGES[code].de);
  });

  test(`getUserFriendlyMessage("${code}", "en") returns non-empty English string`, () => {
    const msg = getUserFriendlyMessage(code, "en");
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(5);
    expect(msg).toBe(ERROR_MESSAGES[code].en);
  });
}

test("getUserFriendlyMessage — unknown code falls back to UNKNOWN message (de)", () => {
  const msg = getUserFriendlyMessage("TOTALLY_UNKNOWN_CODE", "de");
  expect(msg).toBe(ERROR_MESSAGES.UNKNOWN.de);
});

test("getUserFriendlyMessage — null falls back to UNKNOWN message (en)", () => {
  const msg = getUserFriendlyMessage(null, "en");
  expect(msg).toBe(ERROR_MESSAGES.UNKNOWN.en);
});

test("getUserFriendlyMessage — undefined falls back to UNKNOWN message (de)", () => {
  const msg = getUserFriendlyMessage(undefined, "de");
  expect(msg).toBe(ERROR_MESSAGES.UNKNOWN.de);
});

test("getUserFriendlyMessage — defaults to de when locale omitted", () => {
  const msg = getUserFriendlyMessage("AUTH_ERROR");
  expect(msg).toBe(ERROR_MESSAGES.AUTH_ERROR.de);
});

// ---------------------------------------------------------------------------
// isRetryAllowed
// ---------------------------------------------------------------------------

const RETRYABLE: AppErrorCode[] = [
  "CHAT_TIMEOUT",
  "MISTRAL_RATE_LIMITED",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
];

const NOT_RETRYABLE: AppErrorCode[] = [
  "AUTH_ERROR",
  "PERMISSION_DENIED",
  "PARSE_FAILED",
  "VOICE_ERROR",
  "UNKNOWN",
];

for (const code of RETRYABLE) {
  test(`isRetryAllowed("${code}") → true`, () => {
    expect(isRetryAllowed(code)).toBe(true);
  });
}

for (const code of NOT_RETRYABLE) {
  test(`isRetryAllowed("${code}") → false`, () => {
    expect(isRetryAllowed(code)).toBe(false);
  });
}

test("isRetryAllowed — unknown string → false", () => {
  expect(isRetryAllowed("NOT_A_REAL_CODE")).toBe(false);
});

test("isRetryAllowed — null → false", () => {
  expect(isRetryAllowed(null)).toBe(false);
});

// ---------------------------------------------------------------------------
// AppError — constructor and toUserMessage
// ---------------------------------------------------------------------------

test("AppError — code is stored and name is 'AppError'", () => {
  const e = new AppError("AUTH_ERROR");
  expect(e.code).toBe("AUTH_ERROR");
  expect(e.name).toBe("AppError");
  expect(e instanceof Error).toBe(true);
});

test("AppError — toUserMessage defaults to de", () => {
  const e = new AppError("CHAT_TIMEOUT");
  expect(e.toUserMessage()).toBe(ERROR_MESSAGES.CHAT_TIMEOUT.de);
});

test("AppError — toUserMessage(en) returns English message", () => {
  const e = new AppError("UPSTREAM_ERROR");
  expect(e.toUserMessage("en")).toBe(ERROR_MESSAGES.UPSTREAM_ERROR.en);
});

test("AppError — custom message does not override code", () => {
  const e = new AppError("PARSE_FAILED", "raw technical detail");
  expect(e.message).toBe("raw technical detail");
  expect(e.code).toBe("PARSE_FAILED");
  expect(e.toUserMessage("de")).toBe(ERROR_MESSAGES.PARSE_FAILED.de);
});

test("AppError — cause and meta are stored", () => {
  const cause = new Error("upstream 500");
  const meta = { requestId: "abc123" };
  const e = new AppError("UPSTREAM_ERROR", undefined, { cause, meta });
  expect(e.cause).toBe(cause);
  expect(e.meta).toEqual(meta);
});

// ---------------------------------------------------------------------------
// errorResponse — response shape via HTTP round-trip (simulated via json())
// ---------------------------------------------------------------------------

test("errorResponse — PERMISSION_DENIED produces 403 with correct shape", async () => {
  const { errorResponse } = await import("@/lib/api/errorResponse");
  const res = errorResponse("PERMISSION_DENIED", 403);

  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error_code).toBe("PERMISSION_DENIED");
  expect(body.retry_allowed).toBe(false);
  expect(typeof body.user_message).toBe("string");
  expect(body.user_message.length).toBeGreaterThan(5);
});

test("errorResponse — UPSTREAM_ERROR produces 500 with retry_allowed=true", async () => {
  const { errorResponse } = await import("@/lib/api/errorResponse");
  const res = errorResponse("UPSTREAM_ERROR", 500);

  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body.error_code).toBe("UPSTREAM_ERROR");
  expect(body.retry_allowed).toBe(true);
  expect(body.user_message).toBe(ERROR_MESSAGES.UPSTREAM_ERROR.de);
});

test("errorResponse — AUTH_ERROR produces 401 with retry_allowed=false", async () => {
  const { errorResponse } = await import("@/lib/api/errorResponse");
  const res = errorResponse("AUTH_ERROR", 401);

  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.error_code).toBe("AUTH_ERROR");
  expect(body.retry_allowed).toBe(false);
});

test("errorResponse — MISTRAL_RATE_LIMITED produces 429 with retry_allowed=true", async () => {
  const { errorResponse } = await import("@/lib/api/errorResponse");
  const res = errorResponse("MISTRAL_RATE_LIMITED", 429);

  expect(res.status).toBe(429);
  const body = await res.json();
  expect(body.error_code).toBe("MISTRAL_RATE_LIMITED");
  expect(body.retry_allowed).toBe(true);
});

test("errorResponse — response body has no raw technical details", async () => {
  const { errorResponse } = await import("@/lib/api/errorResponse");
  const res = errorResponse("UNKNOWN", 500);

  const body = await res.json() as Record<string, unknown>;
  const keys = Object.keys(body);
  expect(keys).toContain("error_code");
  expect(keys).toContain("user_message");
  expect(keys).toContain("retry_allowed");
  expect(keys).not.toContain("stack");
  expect(keys).not.toContain("cause");
  expect(keys).not.toContain("error");
});
