# REPLIT PROMPT — Resend Email Debug & Fix

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## CONTEXT

Welcome emails (`sendBetaWelcomeEmail`, `sendProWelcomeEmail`) exist in `lib/email.ts` and are called from the Stripe webhook at `app/api/webhooks/stripe/route.ts`. During an end-to-end Stripe test, only Supabase auth emails arrived — no Resend emails fired. The Stripe webhook itself completed successfully (Supabase data was written).

Most likely cause: `RESEND_API_KEY` is set in Replit's environment but **not** in Vercel's environment variables. Vercel runs the production webhook — if the key is missing there, Resend silently fails or throws an uncaught error.

---

## GOAL

1. Confirm whether `RESEND_API_KEY` is present and valid in the deployed environment
2. Add proper error logging to email sends so failures are visible in Vercel logs
3. Add a test endpoint to manually trigger a welcome email without a real Stripe purchase
4. Verify the fix end-to-end

---

## STEP 1 — Check environment variable wiring

Open `lib/email.ts`.

At the top of the file, confirm the Resend client is initialized like this:

```ts
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)
```

If `RESEND_API_KEY` is undefined at runtime, the Resend client will be initialized with `undefined` — and every send call will fail silently or throw.

Add a startup guard:

```ts
const resend = new Resend(process.env.RESEND_API_KEY)

if (!process.env.RESEND_API_KEY) {
  console.error('[email] RESEND_API_KEY is not set — emails will not be sent')
}
```

---

## STEP 2 — Add error logging to send functions

Find `sendBetaWelcomeEmail` and `sendProWelcomeEmail`. Both likely have a `resend.emails.send(...)` call.

Wrap each in try/catch and log the outcome:

```ts
export async function sendBetaWelcomeEmail(to: string, name?: string) {
  try {
    const result = await resend.emails.send({
      from: 'Lucas von Glev <lucas@glev.app>',
      to,
      subject: '...',
      html: `...`,
    })
    console.log('[email] Beta welcome sent to', to, result)
    return result
  } catch (err) {
    console.error('[email] Failed to send beta welcome to', to, err)
    throw err
  }
}
```

Apply the same pattern to `sendProWelcomeEmail`.

---

## STEP 3 — Add error logging in the Stripe webhook

Open `app/api/webhooks/stripe/route.ts`.

Find where `sendBetaWelcomeEmail` / `sendProWelcomeEmail` is called. Make sure the call is awaited and errors are caught — not swallowed:

```ts
try {
  await sendBetaWelcomeEmail(customerEmail, customerName)
} catch (err) {
  // Log but don't fail the webhook — Stripe would retry if we return non-200
  console.error('[webhook] Email send failed:', err)
}
```

If the email call was fire-and-forget (not awaited), that's the bug — add `await`.

---

## STEP 4 — Add a manual test endpoint

Create `app/api/email/test/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { sendBetaWelcomeEmail, sendProWelcomeEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  // Protect with CRON_SECRET so it can't be called publicly
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, type } = await req.json()
  if (!email || !type) {
    return NextResponse.json({ error: 'email and type required' }, { status: 400 })
  }

  try {
    if (type === 'beta') {
      await sendBetaWelcomeEmail(email)
    } else if (type === 'pro') {
      await sendProWelcomeEmail(email)
    } else {
      return NextResponse.json({ error: 'type must be beta or pro' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

---

## STEP 5 — Set RESEND_API_KEY in Vercel

**This step happens outside Replit** — in the Vercel dashboard:

1. Go to vercel.com → Glev project → Settings → Environment Variables
2. Add `RESEND_API_KEY` with the same value that's in Replit
3. Also confirm `CRON_SECRET` is set (needed for Step 4 and the drip cron)
4. Redeploy (or trigger a new deploy from git push)

---

## STEP 6 — Verify

After deploying, test the endpoint:

```bash
curl -X POST https://glev.app/api/email/test \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"email":"lucas@wahnon-connect.com","type":"beta"}'
```

Expected: `{"ok":true}` and an email in your inbox within 30 seconds.

Check Vercel logs (Functions tab) for `[email] Beta welcome sent to ...` confirmation.

---

## STEP 7 — Commit

```bash
tsc --noEmit
git add -A && git commit -m "fix(email): add RESEND_API_KEY guard, error logging, and manual test endpoint" && git push origin main
```

---

## DO NOT change

- Stripe webhook signature verification logic
- Supabase write logic in the webhook
- `lib/cgm/index.ts` or any CGM-related files
- Any other API routes

=== END ===
