---
name: Supabase Edge Function verify_jwt
description: Cron-triggered Edge Functions must have verify_jwt=false in config.toml or Supabase silently rejects requests with 401 after a redeploy.
---

## Rule

Every Supabase Edge Function called from GitHub Actions (or any cron without an auth header) **must** have `verify_jwt = false` explicitly set in its `config.toml`:

```toml
[functions.my-function]
verify_jwt = false
```

## Why

Supabase defaults to `verify_jwt = true`. When you deploy a function via `supabase functions deploy`, the config.toml setting is applied to the deployed function. If the setting is absent, Supabase uses the default (`true`). Any HTTP request without a valid JWT header will receive a 401 and the function body never runs — Supabase doesn't log 401 responses as invocations in the Dashboard, so the function appears to not be called at all.

## How to apply

- All three alarm functions (`hypo-check`, `elevated-check`, `hyper-check`) already have `verify_jwt = false` set after the 2026-06-05 fix.
- Any new cron-triggered Edge Function must include `verify_jwt = false` in its config.toml from the start.
- After adding or changing this value, run `supabase functions deploy <name>` from Lucas's Mac (Replit has no Supabase CLI auth).
- Dashboard toggle (`Edge Functions → Settings → Enforce JWT Verification`) is a temporary workaround only — it gets overwritten on the next deploy if config.toml doesn't have the explicit value.
