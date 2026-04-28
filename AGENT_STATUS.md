# Agent Status

## Last completed task
**Pro-Page CTA: Stripe Server-Action → direkter Stripe Payment Link** (this turn)

`app/pro/page.tsx` — gleiches Pattern wie Beta letzte Runde:
- **Form weg**: `<form action={submitProCheckout}>` mit Email-Input + `ProSubmitButton` entfernt
- **Direktlink rein**: neue `ProCTALink`-Komponente — `<a href="https://buy.stripe.com/bJe4gzfLK1OUezHfzebfO01" target="_blank" rel="noopener noreferrer">` mit identischem CTAButton-Styling
- **Label**: "Mitgliedschaft starten — €24,90/Monat" (unverändert)
- **Aufgeräumt**:
  - Imports raus: `Image`, `Link`, `useRef`, `useFormStatus`, `useSearchParams`, `submitProCheckout`, `CTAButton`, `BORDER`, `PINK`, `SURFACE`, `ACCENT` (ACCENT_HOVER stattdessen rein)
  - State raus: `email`, `ctaRef`, `searchParams`, `error`
  - `ProSubmitButton` Component gelöscht
- **Bleibt unverändert**: Hero-Copy, MINT-Meta-Zeile "Erste Abbuchung am 1. Juli 2026 · jederzeit kündbar", PricingCard, Steps, FeatureTrio (2x2 grid), FAQ, Founder, Footer, Suspense-Wrapper
- **`app/pro/actions.ts` bleibt unverändert** — wird jetzt nicht mehr aufgerufen, kann später entfernt werden

`tsc --noEmit --skipLibCheck` → clean.

## Both /beta and /pro now use direct Stripe Payment Links
| Page | Payment Link | Button-Label |
|---|---|---|
| /beta | https://buy.stripe.com/14AeVdgPO65abnv3QwbfO00 | "Platz sichern — €19" (oder "Auf die Warteliste" bei full) |
| /pro | https://buy.stripe.com/bJe4gzfLK1OUezHfzebfO01 | "Mitgliedschaft starten — €24,90/Monat" |

Beide Server Actions (`app/beta/actions.ts`, `app/pro/actions.ts`) sind tot-Code, intakt, kein Aufrufer.

## Side-Effects beider Umstellungen
- Email-Sammeln nur noch via Stripe Webhook (`STRIPE_BETA_WEBHOOK_SECRET` gesetzt — vermutlich existiert `app/api/webhooks/stripe/route.ts`)
- Capacity-Check (/beta) nur noch Frontend-Polling — Race möglich
- Stripe-Account muss für Payment Links aktiviert sein + Pro-Link auf Subscription-Mode €24,90/Monat konfiguriert

## Pending push (UNVERÄNDERT)
**Plattformseitig blockiert.** Lokal/`gitsafe-backup/main` hat:
- `ddd063d` Pro-page grid 2x2
- `54abbc7` /log Wizard layout
- `f849fc8` Beta-Page Early-Access perk
- `e909009` Beta-Page Stripe Payment Link
- (jetzt) Pro-Page Stripe Payment Link

User muss selbst pushen oder Hintergrund-Task anfordern.

## Pending follow-ups
- **Task B — i18n DE/EN ausbauen** (next-intl infra existiert)
- **Task C — Broteinheiten-Engine UI wiring**
- **Locale-aware date pattern** (verbleibende Files)
- **Tot-Code optional aufräumen**: `app/beta/actions.ts`, `app/pro/actions.ts`, `components/landing/CTAButton.tsx` falls nirgendwo sonst verwendet, evtl. `/api/beta/count` falls die Frontend-Polls nicht mehr gebraucht werden (werden aber noch für "Limitiert auf 500 Beta-Plätze." Fallback-Text genutzt → behalten)

## Key files
- `app/beta/page.tsx` — 339 lines, CTA jetzt `<a>` zu Beta Payment Link
- `app/pro/page.tsx` — ~295 lines (war 330), CTA jetzt `<a>` zu Pro Payment Link
- `app/beta/actions.ts` + `app/pro/actions.ts` — intakt aber tot
