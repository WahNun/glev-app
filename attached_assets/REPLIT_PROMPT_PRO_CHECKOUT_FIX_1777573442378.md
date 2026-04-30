=== BEGIN REPLIT PROMPT ===

# Fix: Pro Checkout — fester trial_end statt 62 Tage rolling

## Kontext

Glev hat einen Pro Founder-Tier: "kostenlos bis Launch (1. Juli 2026), dann €24.90/Monat".
Aktuell läuft der Checkout über einen Stripe Payment Link mit 62 Tagen Trial.
**Problem:** Wer sich am 15. Mai anmeldet, bekommt 62 Tage ab da → Abo startet 16. Juli statt 1. Juli.
**Fix:** Pro-Checkout von Payment Link auf die bereits existierende API-Route umstellen mit festem `trial_end: 1751328000` (Unix Timestamp für 1. Juli 2026 00:00:00 UTC) — exakt wie beim Beta-Checkout.

---

## NICHT ÄNDERN

- Stripe Produkt / Price ID (`STRIPE_PRO_PRICE_ID`)
- Pro Webhook (`/api/pro/webhook`) und `STRIPE_PRO_WEBHOOK_SECRET`
- `lib/proPlan.ts`
- Alle anderen Routes und Seiten

---

## STEP 1 — `app/api/pro/checkout/route.ts` anpassen

Öffne zuerst die Datei und lies die aktuelle Implementierung komplett.

Füge oben in der Datei (nach den Imports) folgende Konstante hinzu:

```ts
const PRO_TRIAL_END = 1751328000; // 1. Juli 2026 00:00:00 UTC — fix für ALLE Pro-Tester
```

Suche in der Stripe Checkout Session-Erstellung nach `subscription_data`.

**Fall A — `subscription_data` existiert noch nicht:**
Füge es hinzu:

```ts
subscription_data: {
  trial_end: PRO_TRIAL_END,
},
```

**Fall B — `subscription_data` existiert mit `trial_period_days` oder ähnlichem:**
Ersetze den variablen Trial durch den festen Timestamp:

```ts
// VORHER (Beispiel):
subscription_data: {
  trial_period_days: 62,
},

// NACHHER:
subscription_data: {
  trial_end: PRO_TRIAL_END,
},
```

Sonst nichts an der Route ändern — nur `trial_end` ergänzen oder ersetzen.

---

## STEP 2 — Stripe Dashboard (manueller Schritt, kein Code)

> Dieser Schritt muss manuell im Stripe Dashboard erledigt werden — kein Replit-Eingriff nötig:
>
> 1. Stripe Dashboard → **Payment Links** → alten Pro-Link suchen → **Archivieren / Deaktivieren**
> 2. Ab sofort läuft der Checkout ausschließlich über `/api/pro/checkout`

Hinterlasse in `app/api/pro/checkout/route.ts` einen kurzen Kommentar ganz oben:

```ts
// Pro Checkout — läuft über diese API-Route (kein Stripe Payment Link mehr)
// trial_end ist fest auf 1. Juli 2026 gesetzt, unabhängig vom Anmeldedatum
```

---

## STEP 3 — Pro CTA-Button updaten

Suche die `/pro` Landingpage (wahrscheinlich `app/pro/page.tsx` oder `components/ProPage.tsx` o.ä.).

Finde den "Jetzt anmelden" / "Pro starten" CTA-Button. Aktuell zeigt er vermutlich auf einen direkten `buy.stripe.com/...` Link.

Ändere ihn so, dass er einen POST an `/api/pro/checkout` macht — analog zum Beta-CTA:

```tsx
// VORHER (Beispiel):
<a href="https://buy.stripe.com/XXXX">Jetzt anmelden</a>

// NACHHER:
<button
  onClick={async () => {
    const res = await fetch("/api/pro/checkout", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }}
>
  Jetzt anmelden
</button>
```

Passe Styling, Loading-State und Auth-Guard analog zum bestehenden Beta-CTA-Button an — kopiere das Muster nicht blind, sondern schau dir den Beta-CTA an und übertrage die gleiche Logik.

---

## VERIFY

1. **TypeScript-Check:**
   ```bash
   npx tsc --noEmit
   ```
   → Kein Fehler.

2. **API-Route testen:**
   ```bash
   curl -X POST http://localhost:3000/api/pro/checkout \
     -H "Content-Type: application/json"
   ```
   → Antwort enthält `{ "url": "https://checkout.stripe.com/..." }`

3. **Checkout-URL öffnen:**
   → Stripe Checkout zeigt **"Kostenlos bis 1. Juli 2026"** (nicht "62 Tage kostenlos")

4. **Commit & Push:**
   ```bash
   git add -A && git commit -m "fix: pro checkout fixed trial_end july 1 2026" && git push origin main
   ```

=== END REPLIT PROMPT ===
