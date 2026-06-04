---
name: Implicit Flow PASSWORD_RECOVERY
description: Supabase Implicit Flow password reset — hash fragment handling in /auth/confirm
---

## Rule

The self-service password reset route (`app/api/auth/password-reset/route.ts`) must use
`redirectTo: ${appUrl}/auth/confirm` — NOT `/auth/callback?next=/auth/confirm`.

`/auth/confirm` must have an `onAuthStateChange('PASSWORD_RECOVERY')` listener for the
`!hasParams` branch (when no `?code=` or `?token_hash=` query params are present).

## Why

This Supabase project uses **Implicit Flow** (no PKCE toggle in Email provider settings).
Supabase appends the session as a hash fragment:
`/auth/confirm#access_token=…&type=recovery`

Hash fragments are browser-only. The server never receives them. Therefore:
- Routing through `/auth/callback` (a server Route Handler) = hash is silently dropped = broken
- `useSearchParams()` in `/auth/confirm` = only reads query params, misses hash = shows "invalid"
- The SDK fires `PASSWORD_RECOVERY` event when it processes the hash = this is the correct hook

## How to apply

In `/auth/confirm/page.tsx`, the `!hasParams` branch of the `useEffect` subscribes:
```typescript
const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    setState({ kind: 'ready' });
  }
});
return () => subscription.unsubscribe();
```

## Admin panel is different

`app/glev-ops/users/actions.ts` uses `/auth/callback?next=/auth/confirm` — this is correct
for the admin flow which uses server-side code exchange. Do NOT unify the two URLs.
See DECISIONS.md § D-001.
