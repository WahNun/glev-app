# Agent Status

## Last completed task
**Beta-Page CTA: Stripe Server-Action → direkter Stripe Payment Link** (this turn)

`app/beta/page.tsx` — komplett umgestellt:
- **Form weg**: `<form action={submitBetaCheckout}>` mit Email-Input + `BetaSubmitButton` entfernt (38 Zeilen)
- **Direktlink rein**: neue `BetaCTALink`-Komponente — `<a href="https://buy.stripe.com/14AeVdgPO65abnv3QwbfO00" target="_blank">` mit identischem CTAButton-Styling (Hover, Box-Shadow, Padding, Font)
- **Capacity-Fallback**: bei `isFull=true` zeigt der Link auf `mailto:hello@glev.app?subject=Glev%20Beta%20Warteliste` mit Label "Auf die Warteliste"
- **Aufgeräumt**:
  - Imports raus: `Image`, `useRef`, `useFormStatus`, `useSearchParams`, `submitBetaCheckout`, `CTAButton`, `BORDER`, `PINK`, `SURFACE`, `ACCENT` (ACCENT_HOVER stattdessen rein)
  - State raus: `email`, `ctaRef`, `searchParams`, `error`, `isFullFromUrl`, mailto-redirect-useEffect
  - `BetaSubmitButton` Component gelöscht
  - Unused `isLow` raus
- **Bleibt unverändert**: Hero-Copy, Mint-Early-Access-Zeile (★), Rückerstattung-Zeile, "Limitiert auf 500 Beta-Plätze.", PricingCard, Steps, FAQ, Founder, Footer, Suspense-Wrapper, count-poll via `/api/beta/count`
- **`app/beta/actions.ts` bleibt unverändert** — wird jetzt nirgendwo mehr aufgerufen, kann später entfernt werden falls keine andere Verwendung gefunden

`tsc --noEmit --skipLibCheck` → clean.

## Stripe-Side-Effects der Umstellung
- **Email-Tracking weg**: vorher hat Server Action Email vor Stripe-Redirect in `beta_signups` (oder ähnlicher Table) gespeichert. Stripe Payment Link sammelt Email selbst, aber unsere DB bekommt sie nur via Webhook (falls konfiguriert)
- **Capacity-Check weg**: vorher hat Server Action 409 zurückgegeben wenn 500 Plätze voll. Jetzt: nur Frontend-`/api/beta/count` Polling — Race-Condition möglich (User klickt während noch ein Platz da ist, aber während Checkout wird's voll). Stripe Payment Link verkauft trotzdem.
- **Webhook**: `STRIPE_BETA_WEBHOOK_SECRET` ist gesetzt — vermutlich gibt's `/api/webhooks/stripe` der Beta-Verkäufe trackt. Sollte mit Payment Link weiterhin funktionieren (Stripe sendet `checkout.session.completed` event genauso).
- **Discount/Pricing**: Payment Link muss in Stripe Dashboard auf €19 / one-time konfiguriert sein. Falls Coupon/Discount via App-spezifischer Logik gegeben wurde, wird das nicht mehr funktionieren.

## Pending push (UNVERÄNDERT)
**Plattformseitig blockiert.** `git push origin main` returns "Destructive git operations are not allowed in the main agent."

Lokal/`gitsafe-backup/main` hat:
- `ddd063d` Pro-page grid 2x2
- `54abbc7` /log Wizard layout
- `f849fc8` Beta-Page Early-Access perk
- (jetzt) Beta-Page Stripe Payment Link

User muss selbst pushen oder Hintergrund-Task anfordern.

## Pending follow-ups
- **Pro-Page hat denselben Bug**: `app/pro/page.tsx` nutzt vermutlich auch `submitProCheckout` Server Action. Bei Bedarf gleiche Umstellung — dann brauchen wir aber eine separate Pro Payment Link URL (€24,90/Monat subscription). User hat NUR Beta gemeint diese Runde.
- **Task B — i18n DE/EN ausbauen** (next-intl infra existiert)
- **Task C — Broteinheiten-Engine UI wiring**
- **Locale-aware date pattern** (verbleibende Files)

## Key files
- `app/beta/page.tsx` — 339 lines (war 380, -41 nach Cleanup), CTA jetzt `<a>` zu Stripe Payment Link
- `app/beta/actions.ts` — 104 lines, nicht mehr aufgerufen, intakt
- `app/pro/page.tsx` — gleicher Action-Pattern, noch nicht umgestellt
- `REPLIT_PROMPT_STRIPE_FIX_V2.md` — letzte Runde erstellt, jetzt teilweise obsolet (User hat sich für Payment-Link-Lösung entschieden statt für Debug)
