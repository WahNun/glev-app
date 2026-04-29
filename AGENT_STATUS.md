# Glev — Agent Status

## Last completed task
**`/pro` CTA verdrahtet auf eigenen Stripe-Checkout (€24,90 / Monat)**

### Was geändert wurde
- `app/pro/page.tsx`:
  - Alter `ProCTALink` (statisches `<a href="/beta">`) → entfernt.
  - Neuer `ProCheckoutForm` (Email-Input + Submit-Button) als
    `<form action={submitProCheckout}>` — nutzt die existierende
    Server-Action aus `app/pro/actions.ts`.
  - Server-Action ruft `/api/pro/checkout` (verwendet
    `STRIPE_PRO_PRICE_ID`) → erstellt Stripe Subscription Checkout
    Session mit Trial bis 1.7.2026 → server-redirect zu
    `checkout.stripe.com`.
  - Pending-State: Button → „Weiterleitung zu Stripe…", opacity
    0.75, cursor wait.
  - Error-Display: Rotes Banner unter dem Button wenn `?error=`
    (z.B. ungültige Email, 409 für bereits aktive Mitgliedschaft).
  - `useSearchParams()` jetzt aktiv genutzt für Error-Anzeige —
    der bereits vorhandene Suspense-Wrapper am File-Ende macht
    das safe.
  - Meta-Copy unter dem Button von Beta-Wording („€19
    Reservierung…") → Pro-Wording: „Karte heute hinterlegen ·
    keine Buchung bis 1. Juli 2026 · jederzeit kündbar".

### Verifiziert
- Workflow restart durchgelaufen.
- `curl http://localhost:5000/pro` → HTTP 200 in 127ms.
- Browser-Console: nur „[HMR] connected" — keine Fehler.

### Voraussetzungen (sollten bereits konfiguriert sein)
- `STRIPE_SECRET_KEY` + `STRIPE_PRO_PRICE_ID` müssen in den Secrets
  gesetzt sein. Ohne sie liefert die API 503 mit Generic-Error.
  (`.env.example` listet beide.)

## Vorheriger Task
- GlevActionSheet ersetzt durch Header-`+` (`QuickAddMenu`) + Glev-Tap
  → direkt zu `/log`. Sheet komplett gelöscht.

## Offen / Diskutiert (noch nicht gestartet)
- **Performance Dashboard/History** — A+D+E erste Welle
  (90-Tage-Limit auf `fetchMeals`, Suspense-Boundary, `useMemo` für
  teure Reductions in `OutcomeChart`/`TrendChart`).
- **`lib/meals.ts`** — kein Limit auf `fetchMeals` aktuell, lädt
  alle Meals des Users → Bottleneck bei Power-Usern.
