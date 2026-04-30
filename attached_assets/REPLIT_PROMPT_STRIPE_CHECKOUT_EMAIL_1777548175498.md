=== BEGIN ===

## PROBLEM

Glev braucht einen vollständigen Stripe-Checkout-Flow für Beta-Tester: einmalige €19 Setup-Fee + automatische €4.50/Monat Subscription ab 1. Juli 2026 — egal wann sie sich anmelden. Nach erfolgreichem Checkout soll eine persönliche Welcome Email via Resend verschickt und der Supabase-Profil-Eintrag aktualisiert werden.

**Keine bestehende Auth-Logik, kein Supabase-Schema und keine anderen API Routes anfassen.**

---

## STEP 1 — Pakete installieren

```bash
npm install stripe resend
```

---

## STEP 2 — Stripe Helper erstellen

Erstelle `lib/stripe.ts`:

```ts
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  typescript: true,
});
```

---

## STEP 3 — Checkout Session Route erstellen

Erstelle `app/api/checkout/beta/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

// 1. Juli 2026 00:00:00 UTC — fix für ALLE Beta-Tester
const BETA_TRIAL_END = 1751328000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email: string | undefined = body.email;

    if (!process.env.STRIPE_PRICE_SUBSCRIPTION_ID) {
      throw new Error('Missing STRIPE_PRICE_SUBSCRIPTION_ID');
    }
    if (!process.env.STRIPE_PRICE_SETUP_FEE_ID) {
      throw new Error('Missing STRIPE_PRICE_SETUP_FEE_ID');
    }
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('Missing NEXT_PUBLIC_APP_URL');
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_SUBSCRIPTION_ID, // €4.50/Monat
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_end: BETA_TRIAL_END, // 1. Juli 2026 — erste echte Abbuchung
        add_invoice_items: [
          {
            price: process.env.STRIPE_PRICE_SETUP_FEE_ID, // €19 einmalig, sofort
          },
        ],
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/beta`,
    };

    // E-Mail vorausfüllen wenn übergeben
    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[checkout/beta]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

---

## STEP 4 — Welcome Email Template erstellen

Erstelle `lib/emails/beta-welcome.ts`:

```ts
export function betaWelcomeHtml(name?: string | null): string {
  const greeting = name ? `Hallo ${name}` : 'Hallo';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Willkommen bei Glev</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:#0f172a;padding:32px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Glev</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#0f172a;">
                ${greeting} 👋
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                herzlichen Glückwunsch — du bist jetzt offiziell ein Beta-Tester von Glev!
                Deine einmalige Setup-Gebühr von <strong>€19</strong> wurde erfolgreich verarbeitet
                und dein Zugang ist <strong>sofort aktiv</strong>.
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Du kannst Glev ab sofort nutzen — komplett kostenlos bis zum
                <strong>1. Juli 2026</strong>. Ab dann läuft dein Abo automatisch weiter
                für nur <strong>€4.50 pro Monat</strong>. Du musst dafür nichts weiter tun,
                keine Kreditkarte erneut eingeben — alles läuft im Hintergrund.
              </p>

              <p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#374151;">
                Ich freue mich wirklich, dass du dabei bist. Dein Feedback als einer der
                ersten Nutzer ist für mich Gold wert — meld dich einfach direkt bei mir,
                wenn du Fragen hast oder etwas nicht stimmt.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;">
                    <a href="https://app.glev.app"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.2px;">
                      App öffnen →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
                Bis bald,<br />
                <strong>Lucas</strong><br />
                <span style="color:#6b7280;">Glev Team</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Glev · info@glev.app · Diese E-Mail wurde an dich geschickt, weil du dich als Beta-Tester angemeldet hast.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
```

---

## STEP 5 — Stripe Webhook Handler erstellen

Erstelle `app/api/webhooks/stripe/route.ts`:

```ts
// KRITISCH: Edge Runtime bricht Stripe Signaturprüfung — Node.js zwingend!
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { betaWelcomeHtml } from '@/lib/emails/beta-welcome';

// Supabase Admin Client (Service Role, bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  // Env Var heißt in Vercel/Replit: STRIPE_BETA_WEBHOOK_SECRET
  if (!sig || !process.env.STRIPE_BETA_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_BETA_WEBHOOK_SECRET);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook verification failed';
    console.error('[webhook] Signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const email = session.customer_email ?? session.customer_details?.email;
    const name = session.customer_details?.name ?? null;

    if (!email) {
      console.warn('[webhook] checkout.session.completed — no email found, skipping');
      return NextResponse.json({ received: true });
    }

    // 1. Welcome Email via Resend
    try {
      await resend.emails.send({
        from: 'Glev <info@glev.app>',
        to: email,
        subject: 'Willkommen bei Glev — dein Beta-Zugang ist aktiv 🎉',
        html: betaWelcomeHtml(name),
      });
      console.log(`[webhook] Welcome email sent to ${email}`);
    } catch (err) {
      console.error('[webhook] Failed to send welcome email:', err);
      // Nicht abbrechen — Supabase-Update trotzdem versuchen
    }

    // 2. Supabase Profile updaten
    try {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_status: 'beta',
          plan: 'beta',
        })
        .eq('email', email);

      if (error) {
        console.error('[webhook] Supabase update failed:', error.message);
      } else {
        console.log(`[webhook] Supabase profile updated for ${email}`);
      }
    } catch (err) {
      console.error('[webhook] Supabase update error:', err);
    }
  }

  return NextResponse.json({ received: true });
}
```

---

## STEP 6 — Env Vars in `.env.local` eintragen

Stelle sicher, dass folgende Variablen gesetzt sind (in Vercel und lokal):

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_BETA_WEBHOOK_SECRET=whsec_...   # heißt STRIPE_BETA_WEBHOOK_SECRET — bereits in Vercel!
STRIPE_PRICE_SUBSCRIPTION_ID=price_...     # €4.50/Monat Preis-ID aus Stripe Dashboard
STRIPE_PRICE_SETUP_FEE_ID=price_...        # €19 einmalig Preis-ID aus Stripe Dashboard
RESEND_API_KEY=re_...
NEXT_PUBLIC_APP_URL=https://glev.app
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...           # Service Role Key (nicht anon key!)
```

> **Wichtig:** In Stripe müssen beide Preise als **einmalig** (€19, `one_time`) bzw. **wiederkehrend** (€4.50, `recurring: monthly`) angelegt sein, bevor die Preis-IDs eingetragen werden.

---

## NICHT ÄNDERN

- Supabase-Datenbankschema (keine Migrations ausführen)
- Bestehende Auth-Logik (`app/api/auth/`, `lib/auth.ts`, `middleware.ts`)
- Andere bestehende API Routes
- `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`

---

## VERIFY

**1. TypeScript-Check:**
```bash
npx tsc --noEmit
```
→ Kein Fehler, keine Warnings.

**2. Lokal testen mit Stripe CLI:**
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
In einem zweiten Terminal:
```bash
stripe trigger checkout.session.completed
```

**3. Echten Checkout testen:**
- POST an `http://localhost:3000/api/checkout/beta` mit Body `{ "email": "test@example.com" }`
- Zurückgegebene `url` im Browser öffnen
- Stripe Test-Kreditkarte `4242 4242 4242 4242` verwenden
- Welcome Email muss in der Inbox ankommen (Resend Dashboard prüfen)

**4. Supabase prüfen:**
```sql
SELECT email, subscription_status, plan
FROM profiles
WHERE email = 'test@example.com';
```
→ `subscription_status = 'beta'`, `plan = 'beta'`

**5. Commit & Push:**
```bash
git add -A && git commit -m "feat: stripe checkout beta + webhook + welcome email" && git push origin main
```

=== END ===
