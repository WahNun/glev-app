# Fix: Stripe Checkout — Name-Feld ergänzen

## Kontext
In der Glev Stripe Checkout Session wird aktuell nur die E-Mail erfasst.
Der Name des Käufers fehlt. Fix: `custom_fields` in der Session-Erstellung ergänzen.

## Betroffene Dateien
Alle Stellen in denen `stripe.checkout.sessions.create({...})` aufgerufen wird:
- `app/actions/stripe.ts` (Funktionen `checkoutPro()` und `checkoutBeta()`)
- `app/api/pro/checkout/route.ts` (falls dort ebenfalls eine Session erstellt wird)

## Was zu tun ist

**Lies zuerst die betroffenen Dateien vollständig.**

In jedem `stripe.checkout.sessions.create({...})`-Aufruf folgenden Block ergänzen:

```ts
custom_fields: [
  {
    key: 'full_name',
    label: { type: 'custom', custom: 'Vollständiger Name' },
    type: 'text',
    optional: false,
  },
],
```

### Beispiel — vorher:
```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: email,
  line_items: [...],
  success_url: `${baseUrl}/success`,
  cancel_url: `${baseUrl}/pro`,
});
```

### Beispiel — nachher:
```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: email,
  line_items: [...],
  custom_fields: [
    {
      key: 'full_name',
      label: { type: 'custom', custom: 'Vollständiger Name' },
      type: 'text',
      optional: false,
    },
  ],
  success_url: `${baseUrl}/success`,
  cancel_url: `${baseUrl}/pro`,
});
```

## Was NICHT geändert wird
- Keine anderen Parameter der Session
- Kein Webhook-Handler (der Name ist im `checkout.session.completed` Event unter `session.custom_fields` abrufbar — aber das ist ein separater Schritt)
- Keine anderen Dateien

## Commit
```
git add -A && git commit -m "fix: add name field to Stripe checkout" && git push origin main
```
