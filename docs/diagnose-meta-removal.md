# Diagnose: Meta Pixel + CAPI Removal

**Erstellt:** 2026-06-22  
**Branch:** hotfix/meta-removal  
**Status:** Phase 1 — Report (keine Code-Änderungen)

---

## 1. Vollständige File-Liste

### Browser-Pixel (Client-Side → direkt an Meta)

| File | Was wird gesendet |
|------|-------------------|
| `components/WebOnlyTracking.tsx` | Lädt `fbevents.js` von `connect.facebook.net`, feuert `fbq('init', PIXEL_ID)` + `fbq('track', 'PageView')` auf jeder Seite nach Mount. Fallback-Pixel-ID `1388009386583284` ist hartkodiert. |

### CAPI Client-Helper (Browser + Server)

| File | Rolle |
|------|-------|
| `lib/fb-capi-client.ts` | Älterer Browser-Helper. Ruft `window.fbq()` auf UND postet parallel an `/api/fb-capi` (PII: email, phone, firstName, lastName, country, fbp, fbc). Prüft `window.__consent.marketing` vor jedem Fire. |
| `lib/capi-events.ts` | Neuerer universeller Helper (Browser + Server). Ruft optional `window.fbq()` auf UND sendet an `CAPI_GATEWAY_URL` (Cloudflare Worker / Tarn-Domain `capi.mealpatterns.app`). Der Worker leitet dann zu Meta weiter. |

> **Wichtig:** `lib/capi-events.ts` sendet **nicht direkt** an `graph.facebook.com` — es geht über den Cloudflare Worker. Aber die Events landen trotzdem bei Meta.

### Server-Relay

| File | Rolle |
|------|-------|
| `app/api/fb-capi/route.ts` | Übersetzt altes camelCase-Format von `lib/fb-capi-client.ts` → Gateway-Wire-Format, reichert mit Client-IP + UA an, forwarded an `CAPI_GATEWAY_URL`. Kein direkter Kontakt zu `graph.facebook.com`. |

### Meta Lead Ads Webhook

| File | Rolle |
|------|-------|
| `app/api/meta/leads/route.ts` | Empfängt Meta Lead-Ads-Webhook-Events. **Kontaktiert `graph.facebook.com` direkt** zum Abrufen der Lead-Daten. Schreibt in Supabase `meta_leads`. Ruft `trackEvent('Lead', ...)` via `lib/capi-events.ts`. Ruft `provisionMetaLead()` auf. |

### Admin-Endpunkte (alle kontaktieren `graph.facebook.com` direkt)

| File | Was wird gesendet |
|------|-------------------|
| `app/api/admin/meta/subscribe-page/route.ts` | POST `/{page-id}/subscribed_apps` — registriert App für leadgen-Webhooks |
| `app/api/admin/meta/refresh-token/route.ts` | GET `/debug_token` + `/oauth/access_token` + `/{page-id}` — tauscht Tokens |
| `app/api/admin/meta/check-subscription/route.ts` | GET `/{page-id}/subscribed_apps` — prüft aktive Subscriptions |
| `app/api/admin/meta/backfill/route.ts` | GET `/{page-id}/leadgen_forms` + `/{form-id}/leads` — holt historische Leads |

### Page-Level `fbq()` Calls (alle client-side)

| File | Events |
|------|--------|
| `app/signup/page.tsx` | `ViewFreeTrialSignup` (pageview), `Lead` (nach Signup-Submit, inkl. eventID), `StartTrial` via `lib/fb-capi-client.trackEvent()` (nach Profil-Schritt, value 14.9 EUR) |
| `app/beta/page.tsx` | `InitiateCheckout` (pageview), `ViewBetaPagePreview` (Preview-Anzeige) |
| `app/pro-trial/page.tsx` | `InitiateCheckout` (pageview), `ViewProTrialPage` (Preview), `ClickFreeTrialCTA` (CTA-Klick, 2×) |
| `app/pro/page.tsx` | `InitiateCheckout` (pageview), `ViewProPagePreview` (Preview) |
| `app/beta-b/page.tsx` | `InitiateCheckout` (pageview), `ViewBetaBPage` (Preview) |
| `app/preview-beta/page.tsx` | `InitiateCheckout` (pageview), `ViewBetaPagePreview` (Preview) |
| `app/preview-pro/page.tsx` | `InitiateCheckout` (pageview), `ViewProPagePreview` (Preview) |

### API-Routen mit `trackEvent()` via `lib/capi-events.ts`

| File | Event | Trigger | PII gesendet |
|------|-------|---------|--------------|
| `app/auth/callback/route.ts:58` | `CompleteRegistration` | Email-Bestätigungslink geklickt | email, external_id (user_id) |
| `app/api/auth/free-trial/route.ts:89` | `StartTrial` | Neuer Trial-User provisioned | email, external_id, content_name, content_ids |
| `app/api/beta/checkout/route.ts:217` | `InitiateCheckout` | Stripe Checkout Session erstellt | email |
| `app/api/checkout/beta/route.ts:156` | `InitiateCheckout` | Stripe Checkout Session erstellt (alter Endpoint) | email |
| `app/api/pro/webhook/route.ts:487` | `Purchase` | Stripe `checkout.session.completed` | email, external_id, country, value, currency, plan |
| `app/api/webhooks/stripe/route.ts:373` | `Subscribe` | Stripe subscription event | email, external_id, country, value, currency |
| `app/api/webhooks/stripe/route.ts:390` | `Purchase` | Stripe purchase event | email, external_id, country, value, currency |
| `app/api/meta/leads/route.ts:189` | `Lead` | Meta Lead-Ads-Webhook | email, first_name, last_name, phone, country=de, form_id |

### Cookie-Banner (Consent-Gate)

| File | Relevanz |
|------|---------|
| `components/CookieBanner.tsx` | Marketing-Kategorie-Text nennt explizit "Meta-Pixel und Facebook CAPI". Nach Removal: Texte aktualisieren (Marketing-Consent bleibt für andere Zwecke sinnvoll, oder Kategorie entfernen). |

---

## 2. Daten-Felder pro Kanal

### Browser-Pixel (client-side, `connect.facebook.net`)
- Pixel-ID: `1388009386583284` (auch via `NEXT_PUBLIC_FB_PIXEL_ID`)
- Standard-Events: `PageView`, `Lead`, `InitiateCheckout`
- Custom-Events: `ViewFreeTrialSignup`, `ViewBetaPagePreview`, `ViewProTrialPage`, `ViewProPagePreview`, `ViewBetaBPage`, `ClickFreeTrialCTA`
- Automatisch von Meta gesammelt: IP, UA, Cookies (`_fbp`, `_fbc`), URL
- **Gesundheitsdaten-Risiko:** Die Seiten `/beta`, `/pro`, `/pro-trial` etc. implizieren Diabetes-Management → Meta weiss, welche User eine Diabetes-App besucht haben

### CAPI via Gateway (server-side → `capi.mealpatterns.app` → Meta)
- **PII-Felder:** `email` (gehasht), `phone`, `first_name`, `last_name`, `country`, `external_id` (user_id), `fbp`, `fbc`, `client_ip_address`, `client_user_agent`
- **Custom Data:** `value`, `currency`, `content_name`, `content_ids`, `order_id`
- **Events:** `Lead`, `CompleteRegistration`, `StartTrial`, `InitiateCheckout`, `Purchase`, `Subscribe`
- **Gesundheitsdaten-Risiko:** Health-App-Nutzung + Kaufverhalten + User-ID — klassisches Health-Data-Profil

### Meta Graph API (server-side, direkt an `graph.facebook.com`)
- `app/api/meta/leads` liest vollständige Lead-Formulardaten: Name, Email, Telefon, alle Formularfelder
- Admin-Endpunkte lesen/schreiben ausschliesslich Meta-App-Konfiguration (kein User-PII)

---

## 3. Involvierte Env-Vars

### Browser-exponiert (NEXT_PUBLIC)
| Variable | Verwendet in | Löschen |
|----------|-------------|---------|
| `NEXT_PUBLIC_FB_PIXEL_ID` | `WebOnlyTracking.tsx` | ✅ ja |
| `NEXT_PUBLIC_CAPI_ENDPOINT` | `lib/capi-events.ts` (Browser-Pfad) | ✅ ja |
| `NEXT_PUBLIC_CAPI_CLIENT_KEY` | `lib/capi-events.ts` (Browser-Pfad) | ✅ ja |

### Server-only
| Variable | Verwendet in | Löschen |
|----------|-------------|---------|
| `CAPI_GATEWAY_URL` | `lib/capi-events.ts`, `app/api/fb-capi/route.ts` | ✅ ja |
| `CAPI_SHARED_SECRET` | `lib/capi-events.ts`, `app/api/fb-capi/route.ts` | ✅ ja |
| `META_VERIFY_TOKEN` | `app/api/meta/leads/route.ts` | ✅ ja |
| `META_APP_SECRET` | `app/api/meta/leads/route.ts`, `admin/meta/refresh-token` | ✅ ja |
| `META_APP_ID` | `app/api/admin/meta/refresh-token/route.ts` | ✅ ja |
| `META_SYSTEM_USER_TOKEN` | `app/api/meta/leads/route.ts` | ✅ ja |
| `META_PAGE_ACCESS_TOKEN` | `app/api/meta/leads/route.ts`, alle admin/meta/* | ✅ ja |
| `META_PAGE_ID` | `app/api/meta/leads/route.ts`, alle admin/meta/* | ✅ ja |
| `GRAPH_API_VERSION` | `app/api/meta/leads/route.ts`, alle admin/meta/* | ✅ ja |
| `LEAD_NOTIFY_WEBHOOK` | `app/api/meta/leads/route.ts` | ✅ ja (nur für Meta Leads genutzt) |

**Gesamt: 13 Env-Vars** sind zu löschen — aus Vercel Dashboard + Replit Secrets.

---

## 4. Conversion-Tracking: Was geht verloren, was bleibt

### Verloren nach Phase 2

| Tracking | Verlust | Ersatz |
|---------|---------|--------|
| Meta Pixel PageView (alle Seiten) | Meta weiss nicht mehr wer glev.app besucht | Vercel Analytics deckt das ab |
| Meta Pixel + CAPI Lead (signup) | Signup-Attribution in Meta Ads Manager | Kein direkter Ersatz |
| Meta CAPI CompleteRegistration (auth/callback) | Email-Bestätigung Attribution | Kein direkter Ersatz |
| Meta CAPI StartTrial (free-trial route) | Trial-Start Attribution | Kein direkter Ersatz |
| Meta CAPI InitiateCheckout (checkout routes) | Checkout-Start Attribution | Kein direkter Ersatz |
| Meta CAPI Purchase / Subscribe (stripe webhooks) | Kaufattribution | Kein direkter Ersatz im App-Code |
| Meta Lead Ads Webhook | Neue Meta-Leads werden **nicht mehr auto-provisioniert** | Manuell via Admin-Backfill oder CRM-Workflow |

> ⚠️ **Kritisch: Meta Lead Ads.** Wenn glev.app weiterhin Facebook Lead Ads schaltet, landen neue Leads nach dem Removal nicht mehr automatisch in Supabase und werden nicht provisioniert. `lib/meta-lead-provisioning.ts` bleibt im Code, aber der Webhook-Trigger entfällt. Alternative: Meta-Leads direkt aus Meta Business Suite exportieren + manuell via Backfill-Endpoint (`POST /api/admin/meta/backfill` mit `{email, name}` im Body) provisionieren — **dieser manuelle Modus braucht keine Meta-API-Keys** und überlebt das Removal.

### Verbleibt nach Phase 2 (funktioniert weiterhin)

| Analytics | Status | Anmerkung |
|-----------|--------|-----------|
| **Vercel Analytics** | ✅ Aktiv | `@vercel/analytics` in `package.json`, `<Analytics />` in `app/layout.tsx` — unabhängig von Meta, kein Consent erforderlich, datenschutzfreundlich |
| **Google Analytics** | ✅ Aktiv | `NEXT_PUBLIC_GA_MEASUREMENT_ID` + `GoogleAnalytics`-Komponente in `WebOnlyTracking.tsx`. Der GA-Block ist **separat** vom Meta-Pixel-Block — GA überlebt die Entfernung ohne Änderung |
| **Plausible** | ❌ Nicht vorhanden | |
| **PostHog** | ❌ Nicht vorhanden | |

---

## 5. Empfohlene Removal-Reihenfolge (Phase 2)

1. **`components/WebOnlyTracking.tsx`** — Meta-Pixel `<Script id="meta-pixel">` Block + `<noscript>` img entfernen. GA-Block (`{gaId && ...}`) und `<GoogleAnalytics />` bleiben unangetastet.

2. **Page-Level fbq() Calls** — Alle `window.fbq(...)` Calls entfernen aus:
   - `app/signup/page.tsx` (3 Stellen: line 101, 171, plus `import { trackEvent }` from fb-capi-client + trackEvent calls line 175, 225)
   - `app/beta/page.tsx` (2 Stellen: line 37–38, 131–132)
   - `app/pro-trial/page.tsx` (4 Stellen: line 37–38, 131–132, 243–244, 468–469)
   - `app/pro/page.tsx` (2 Stellen: line 38–39, 134–135)
   - `app/beta-b/page.tsx` (2 Stellen: line 33–34, 127–128)
   - `app/preview-beta/page.tsx` (2 Stellen: line 37–38, 131–132)
   - `app/preview-pro/page.tsx` (2 Stellen: line 38–39, 132–133)

3. **`lib/fb-capi-client.ts`** — Datei komplett löschen.

4. **`app/api/fb-capi/route.ts`** — Datei komplett löschen.

5. **`app/api/meta/leads/route.ts`** — Datei löschen.  
   ⚠️ `lib/meta-lead-provisioning.ts` NICHT löschen — die manuelle Backfill-Funktion (`POST /api/admin/meta/backfill` mit `{email, name}`) braucht diese Library und funktioniert ohne Meta-API-Keys.

6. **`app/api/admin/meta/*`** — Alle 4 Dateien löschen:
   - `subscribe-page/route.ts`
   - `refresh-token/route.ts`
   - `check-subscription/route.ts`
   - `backfill/route.ts`

7. **`trackEvent` Imports + Calls** aus API-Routen entfernen:
   - `app/auth/callback/route.ts` — `import { trackEvent }` + `trackEvent(...)` Call (line 4, 58–62)
   - `app/api/auth/free-trial/route.ts` — `import { trackEvent }` + `trackEvent(...)` Call (line 22, 89–98)
   - `app/api/beta/checkout/route.ts` — `import { trackEvent }` + `trackEvent(...)` Call (line 10, 217–226)
   - `app/api/checkout/beta/route.ts` — `import { trackEvent }` + `trackEvent(...)` Call (line 7, 156–165)
   - `app/api/pro/webhook/route.ts` — `import { trackEvent }` + `trackEvent(...)` Call (line 9, 487–502)
   - `app/api/webhooks/stripe/route.ts` — `import { trackEvent }` + alle `trackEvent(...)` Calls + `capiCountry`, `capiValue`, `capiSub` Variablen (line 12, 362–405)

8. **`lib/capi-events.ts`** — Datei löschen (erst nach Schritt 7, da sonst TypeScript-Fehler).

9. **`components/CookieBanner.tsx`** — Marketing-Beschreibungstexte aktualisieren:
   - DE: `"Meta-Pixel und Facebook CAPI zur Messung der Werbewirkung."` → z.B. `"Messung der Werbewirkung."` oder Marketing-Kategorie ganz entfernen
   - EN: `"Meta Pixel and Facebook CAPI for advertising measurement."` → entsprechend anpassen

10. **Env-Vars löschen** (Lucas macht das manuell):
    - Vercel Dashboard: alle 13 Variablen aus Tabelle in Abschnitt 3
    - Replit Secrets: dieselben Variablen prüfen + löschen
    - **Nicht löschen:** `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA bleibt aktiv)

11. **`pnpm tsc --noEmit`** — muss clean sein nach allen Änderungen.

---

## Abhängigkeits-Notiz: `lib/meta-lead-provisioning.ts`

Diese Datei ist **kein Meta-Code** — sie provisioniert User in Supabase. Sie wird nach Phase 2 nur noch vom manuellen Backfill-Modus gebraucht (kein Meta-API-Aufruf darin). **Nicht löschen.**

Die Supabase-Tabelle `meta_leads` bleibt bestehen — historische Lead-Daten bleiben erhalten, neue Einträge kommen nur noch manuell rein.
