# REPLIT PROMPT — Stripe Checkout Fix V2

## Codebase-Kontext (vor Ausführung lesen)

Verifiziert in diesem Repo am 2026-04-28 (kann beim Ausführen kurz bestätigt werden):

- Stripe Server Actions liegen in **`app/beta/actions.ts`** und **`app/pro/actions.ts`** — **NICHT** in `app/actions/stripe.ts` oder `app/api/checkout/route.ts`.
- Beide nutzen `redirect()` als Server Action (kein `NextResponse.json`). `redirect()`-Calls liegen bereits **außerhalb** der try/catch-Blöcke (kein Redirect-in-Catch-Bug).
- Ein API-Route-Variante (`route.ts`) existiert nach aktuellem Stand nicht für Stripe-Checkout — Frontend submitted direkt via Form-Action an die Server Action.
- Env Vars laut User-Screenshot in Vercel gesetzt: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BETA_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`. **`STRIPE_BETA_PRICE_ID` ist im Screenshot NICHT erwähnt** — das könnte selbst die Wurzel sein, falls /beta eine eigene Price ID braucht.
- Symptom: Auf /pro wird Preis €24,90/Monat korrekt geladen → SDK funktioniert. Checkout-Submit zeigt aber "Zahlung gerade nicht verfügbar" → Fehler im `submitProCheckout()` catch-Block, generischer Text statt echter Stripe-Message.
- Push-Hinweis: `git push origin main` ist auf Replit Main-Agent aktuell plattformseitig blockiert. Push muss manuell aus Shell oder via Background-Task.

---

## SCHRITT 1 — Checkout-Route finden und Price ID prüfen

Suche in der Checkout-Route nach der Price ID. Stelle sicher dass sie `process.env.STRIPE_PRO_PRICE_ID` verwendet (nicht hardcodiert).

```bash
grep -rn "checkout.sessions.create\|STRIPE_PRO_PRICE_ID\|STRIPE_BETA_PRICE_ID\|price_" app/ lib/ --include="*.ts" --include="*.tsx"
```

Erwartete Files: `app/pro/actions.ts`, `app/beta/actions.ts`. Prüfe ob jeweils die richtige `process.env.STRIPE_*_PRICE_ID` verwendet wird oder eine hardcodierte `price_xxx`-ID drinsteht.

## SCHRITT 2 — Mode-Check einbauen

Direkt nach der Stripe-Instanziierung in beiden Action-Files:

```ts
const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
console.log('Stripe mode:', isTestMode ? 'TEST' : 'LIVE')
console.log('Price ID:', process.env.STRIPE_PRO_PRICE_ID)
```

## SCHRITT 3 — Fehler aus catch-Block zurückgeben

Im catch-Block den echten Fehler ans Frontend durchreichen (nur temporär für Debug). Da es Server Actions sind (nicht NextResponse), die Variante mit `redirect()` und `?error=` Query-Param nutzen:

```ts
} catch (e: any) {
  if (isRedirectError(e)) throw e
  console.error('Stripe error:', e.message, e.type, e.code)
  redirect(`/pro?error=${encodeURIComponent(e.message ?? 'Stripe-Fehler')}`)
}
```

(Import: `import { isRedirectError } from "next/dist/client/components/redirect"` oder per `e.digest?.startsWith("NEXT_REDIRECT")` Check.)

Auf der `/pro`- und `/beta`-Page den `?error=` Query-Param als sichtbare Fehlermeldung rendern statt dem generischen Text — z.B. via `useSearchParams()` (Client) oder `searchParams` prop (Server Component).

## SCHRITT 4 — /beta Checkout separat prüfen

`/beta` hat eigene Action `app/beta/actions.ts` mit `submitBetaCheckout`. Prüfen ob sie `STRIPE_BETA_PRICE_ID` (oder einen anderen Env Var) verwendet. **Falls Env Var im Vercel-Setup fehlt, hinzufügen.**

```bash
grep -n "STRIPE_BETA_PRICE_ID\|process.env.STRIPE" app/beta/actions.ts
```

---

## NACH dem Debug

1. Vercel Logs auslesen → echte Stripe-Fehler-Message identifizieren.
2. Mögliche Befunde + Fix:
   | Log | Diagnose |
   |---|---|
   | `mode: TEST, price_live_xxx` | Mismatch — `sk_live_…` in Vercel setzen |
   | `mode: LIVE, price_test_xxx` | Mismatch — Live Price ID setzen |
   | `No such price` | Price ID existiert nicht in dem Account/Mode |
   | `Your account cannot currently make live charges` | Stripe Business Verification fehlt |
   | `Invalid API Key` | `STRIPE_SECRET_KEY` falsch/abgelaufen |
3. Debug-Logs entfernen.
4. Commit + Push.

## DO NOT CHANGE

- Auth-Logik
- Supabase
- Andere Seiten/Routes
- Nightscout / LibreLinkUp
- `NEXT_PUBLIC_APP_URL`
