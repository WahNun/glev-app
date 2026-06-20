# Build 13 — IAP Sandbox Test + Apple Submission Checklist

Generiert: 2026-06-18  
Voraussetzung: IAP-Backend komplett (Edge Function deployed, Webhook in RC registriert, Test-Webhook 200 OK).

---

## A) Build 13 vorbereiten (~15 min)

- [ ] `cd ~/Documents/Claude/Projects/glev-app`
- [ ] `git status` — muss clean sein
- [ ] `git pull` — sicherstellen latest main
- [ ] Build:
  - npm-Variante: `npm run build`
  - pnpm-Variante (wenn pnpm-lock.yaml authority): `pnpm build`
- [ ] `npx cap sync ios`
- [ ] **D-032 FALLE:** nach sync `ios/App/CapApp-SPM/Package.swift` checken — alle Plugins müssen drin sein (Haptics, CapgoCapacitorHealth, Local-Notifications, Push-Notifications, RevenueCat-Purchases-Capacitor). Falls gestrippt → manuell restaurieren laut AGENTS.md
- [ ] `npx cap open ios`

## B) Xcode-Settings (~10 min)

- [ ] Build Number hochsetzen (von 12 auf 13)
- [ ] Marketing Version checken (1.0.13 oder dein Schema)
- [ ] Bundle Identifier verify: muss konsistent sein mit Vorgänger-Build (entweder `app.glev` ODER `com.glev.app` — Diskrepanz war HealthKit-Verdacht von gestern, separat klären)
- [ ] Signing & Capabilities → HealthKit aktiviert ✓
- [ ] Signing & Capabilities → Push Notifications aktiviert ✓
- [ ] Product → Archive (5-15 min Build)
- [ ] Distribute → App Store Connect → Upload → automatic signing

## C) ASC Sandbox-Tester (parallel zum Archive, ~5 min)

- [ ] App Store Connect → Users and Access → Sandbox Testers → +
- [ ] Test-Account anlegen (NICHT deine echte Apple-ID, frische Test-Mail z.B. `glev-sandbox-2026@mailinator.com`)
- [ ] Passwort notieren (vorzugsweise in Password-Manager)
- [ ] Region: Germany (oder die Region die du testen willst — beeinflusst Pricing)

## D) Test-iPhone Setup (~3 min)

- [ ] Settings → App Store → ganz runter scrollen → **Sandbox Account** (NICHT Apple ID oben!) → Sign in mit Sandbox-Tester
- [ ] TestFlight öffnen → Glev Build 13 installieren (1-2 min nach Upload bis TestFlight Mail kommt)

## E) Sandbox-Test-Kauf (~5 min)

- [ ] Glev öffnen, mit echtem Supabase-Account einloggen
- [ ] Zu einer Pro-Feature-Stelle navigieren (Engine, AI-Coach, Insights advanced)
- [ ] Paywall öffnen — sollte sich Glev-Brand-Design zeigen (Tier-Toggle Smart/Pro, 2 Cards Monthly/Yearly, MEISTGEWÄHLT-Badge auf Yearly)
- [ ] Pro Yearly antappen → Apple Buy-Sheet öffnet
- [ ] Sandbox-Account-Hinweis sichtbar (oben: „[Environment: Sandbox]" oder ähnlich)
- [ ] 7-tägiger Free-Trial-Hinweis sichtbar
- [ ] Bestätigen mit Sandbox-Passwort

## F) Verify Supabase (~2 min)

- [ ] Supabase Dashboard → Table Editor → profiles → suche deinen Test-User
- [ ] `subscription_tier` = "pro" ✓
- [ ] `subscription_source` = "apple_iap" ✓
- [ ] `subscription_status` = "active" ✓
- [ ] `subscription_renews_at` = gesetzt (~7 Tage in der Zukunft für Trial, oder 1 Jahr) ✓

Falls Werte nicht aktualisiert: Edge Function Logs checken — Supabase Dashboard → Edge Functions → revenuecat-webhook → Logs.

## G) Verify RevenueCat Dashboard (~2 min)

- [ ] RC Dashboard → Customers → Search nach Supabase user.id
- [ ] Active Entitlement: `glev_pro` ✓
- [ ] Latest Event: `INITIAL_PURCHASE` (Sandbox-Environment markiert) ✓

## H) Verify Glev App (~2 min)

- [ ] Pro-Features unlocked (Engine voll funktionsfähig, AI-Coach erreichbar, Insights advanced)
- [ ] Account-Sheet zeigt „Pro aktiv — Abrechnung via App Store" (oder ähnlich)
- [ ] Verwaltungs-Link öffnet `https://apps.apple.com/account/subscriptions` ✓
- [ ] App-Restart → Pro-Status persistiert (kein Re-Login nötig)

## I) ASC: 4 Subscriptions zur Submission stellen (~15 min)

In App Store Connect → Glev → In-App Purchases → für jede der 4 Subscriptions:
- [ ] Smart Monthly — Status checken, falls „Ready to Submit": Submit
- [ ] Smart Yearly — Submit
- [ ] Pro Monthly — Submit
- [ ] Pro Yearly — Submit

Wenn Status „Missing Metadata": Localizations (DE/EN-US/EN-UK), Pricing, Review Information komplett prüfen.

## J) Build 13 zur App Review (~10 min)

In App Store Connect → Glev → App Store tab → + Version oder existing Version 1.0.13:
- [ ] Build 13 auswählen (aus uploaded TestFlight-Builds)
- [ ] In-App Purchases-Section: 4 Subscriptions associated
- [ ] What's New: kurz beschreiben („In-App Purchase für Glev Pro / Smart" o.ä.)
- [ ] App Review Information:
  - Demo-Account: Glev-Login (separates Test-Account oder dein eigenes mit Hinweis)
  - Notes für Review-Team (siehe Reply-Brief unten)
- [ ] Submit for Review

### Reply-Brief Vorlage (Notes for App Review)

```
This build addresses the Guideline 3.1.1 rejection from Build 12 by 
implementing In-App Purchases via RevenueCat.

Pro and Smart subscriptions are now available as native In-App Purchases:
- Smart Monthly / Yearly (7-day free trial)
- Pro Monthly / Yearly (7-day free trial)

To test:
1. Login with the provided demo account
2. Navigate to any Pro-locked feature (Engine, AI-Coach)
3. The paywall opens with both tiers and billing cycles
4. Select any package to trigger Apple's IAP purchase flow

Cross-platform subscriptions (web Stripe customers) are detected via 
the user profile and bypass the paywall correctly per 3.1.3(a) 
multiplatform service guidelines — they see an "Already subscribed 
via Web" message and a subscription management link to glev.app.

Webhook integration confirmed working in sandbox testing — 
subscription state syncs to the user profile within seconds of purchase.

Thank you for your review.
```

## K) Apple Small Business Program — Status checken

- [ ] ASC → Agreements, Tax, and Banking → Small Business Program → Status
- [ ] Falls noch „Pending": OK, läuft weiter (1-3 Tage)
- [ ] Falls „Approved": RevenueCat-Dashboard Start Date aktualisieren auf Approval-Datum

---

## Troubleshooting

**Paywall öffnet nicht / leer:**
- Browser-Konsole / iOS-Konsole checken — RevenueCat-SDK-Init-Fehler?
- NEXT_PUBLIC_REVENUECAT_IOS_KEY in Vercel gesetzt? (sollte ja sein)
- `Purchases.logIn(user.id)` nach Login aufgerufen?

**Apple Buy-Sheet zeigt Fehler "Cannot connect to iTunes Store":**
- Sandbox-Account aktiv? Settings → App Store → Sandbox Account
- TestFlight-Build (nicht Direct-Install)?

**Webhook feuert aber profiles wird nicht updated:**
- Edge Function Logs: Supabase Dashboard → Edge Functions → revenuecat-webhook → Logs
- Authorization Header in RC genau gleich wie REVENUECAT_WEBHOOK_AUTH_HEADER secret?
- `app_user_id` im Event = Supabase user.id (sonst kein Match)?

**Apple Reviewer sieht Pro nicht freigeschaltet:**
- Demo-Account in App Review Info hat Sandbox-Käufer-Status?
- Optimistic UI Update funktioniert (sollte gestern via setOptimisticTier implementiert sein)?
