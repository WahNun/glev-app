---
name: AI Error Response Contract
description: All AI routes must use errorResponse() from lib/api/errorResponse.ts; never return raw error strings to clients.
---

## Rule

Any server route (Next.js Route Handler) that returns an error response MUST use `errorResponse(code, status)` from `lib/api/errorResponse.ts`.

Never do: `NextResponse.json({ error: "some raw string" }, { status: 403 })`

Always do: `errorResponse("PERMISSION_DENIED", 403)`

## Response Shape

```ts
{
  error_code: AppErrorCode,   // machine-readable
  user_message: string,        // friendly DE sentence (default locale)
  retry_allowed: boolean       // true = transient error, client may offer retry
}
```

## Retry-Allowed Codes (transient — true)
- CHAT_TIMEOUT, MISTRAL_RATE_LIMITED, NETWORK_ERROR, UPSTREAM_ERROR

## Not-Retry Codes (permanent — false)
- AUTH_ERROR, PERMISSION_DENIED, PARSE_FAILED, VOICE_ERROR, UNKNOWN

## Client Side

Clients read `error_code` and call `getUserFriendlyMessage(code, locale)` from `lib/ai/errorMessages.ts`.
The `user_message` field in the response is a DE fallback for clients that can't call the helper.

**Why:** Raw strings like "not available" or "ai consent required" leaked technical implementation details to the UI and broke when copy changed. Structured codes let the client render locale-correct, UX-safe messages independently.

**How to apply:** Every new AI-related route or error path should import `errorResponse` and use one of the 9 `AppErrorCode` values. Stream-internal errors emit `{ error_code, user_message, retry_allowed }` as a JSON SSE frame before `[DONE]`.
