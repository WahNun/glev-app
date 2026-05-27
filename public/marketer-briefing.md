# Glev — Marketer Briefing: Tech-Stand für Ads-Launch
**Stand: 27. Mai 2026**

---

## Deine ursprünglichen Aufgaben an mich & was davon läuft

Du hast mir ein End-to-End CAPI-Setup-Brief gegeben. Hier was du gefordert hast und was davon jetzt live ist:

| Deine Anforderung | Status |
|---|---|
| Browser Pixel + Server CAPI parallel, dedupliziert per `event_id` | ✅ Live |
| Signup-Tracking | ✅ Live |
| Purchase-Event mit echtem EUR-Wert bei Stripe-Checkout | ✅ Live + heute getestet |
| Recurring-Renewal-Tracking via Stripe Webhook | ✅ Live |
| DSGVO-Consent-Check vor jedem Fire | ✅ implementiert |
| UTM-Params + fbclid durch den ganzen Funnel | ✅ Live |
| Meta Lead Ad IDs | ✅ Live |

**Deine Annahmen über den Stack und wie sie sich in der Realität verhalten:**

| Deine Annahme | Realität |
|---|---|
| Hosting: Replit | Dev auf Replit, **Produktion auf Vercel** (glev.app) — CAPI läuft als Vercel Serverless Function |
| DB: Drizzle / Prisma / Pseudo-API | **Supabase** (PostgreSQL) — alle ~5 DB-Stellen auf Supabase-Client gemappt |
| Framework: Next.js | ✅ korrekt — Next.js 15 App Router |
| Payment: Stripe | ✅ korrekt — zwei Webhook-Endpoints (Pro + Beta) |

---

## Was der Nutzer-Funnel technisch macht

**Schritt 1 — Neuer Nutzer kommt über Ad:**
Pixel feuert `PageView` bei Landing. UTM-Parameter + `fbclid` werden aus der URL gezogen und durch den ganzen Funnel mitgetragen.

**Schritt 2 — Signup:**
`CompleteRegistration`-Event feuert (Browser Pixel + Server CAPI parallel, gleiche `event_id` → Meta dedupliziert). Nutzer bekommt automatisch 7 Tage Pro-Zugang — keine Kreditkarte nötig.

**Schritt 3 — Trial läuft ab:**
App komplett gesperrt. Modal mit Upgrade-Aufforderung. Kein Weiterkommen ohne Abo.

**Schritt 4 — Kauf:**
`Purchase`-Event feuert mit echtem EUR-Wert via Stripe Webhook (Server CAPI) + Browser Pixel beim Checkout-Success. Test-Purchase heute erfolgreich im Meta Events Manager aufgezeichnet. Test-Code aus Vercel entfernt — nur Live-Pixel aktiv.

---

## Was bezahlende Nutzer sehen (Upsell-Mechanismus)

Wer zahlt aber ein niedrigeres Abo hat, sieht höherwertige Features **unscharf mit Schloss** — visueller Anreiz zum Upgrade ohne hartes Nein.

| Plan | Was unscharf sichtbar ist |
|---|---|
| Smart (€9) | Alle KI-Insights, Bolus-Empfehlung |
| Pro (€14,90) | PDF-Arztbericht, CSV-Export |

> **CGM-Verbindung (LibreLink / Nightscout) kostenlos für alle Pläne** — kein Gate.

---

## Pläne & Preise

| Plan | Preis | Positionierung |
|---|---|---|
| Glev Smart S | €9/Mo | CGM-Basis, Grundfunktionen |
| Glev Pro M | €14,90/Mo | Alle KI-Insights + Bolus-Engine |
| Glev+ L | €29/Mo | PDF-Arztbericht, CSV, Caregiver |

---

## Plattformen

Ein `git push` = Web (glev.app) + iOS (TestFlight) + Android (Play Store) gleichzeitig aktualisiert. Kein separater App-Store-Build für Content-Änderungen nötig.

---

## Zusammenfassung

| Punkt | Status |
|---|---|
| Meta Pixel (Browser) | ✅ Live |
| Server CAPI (Vercel) | ✅ Live |
| Deduplication per event_id | ✅ Live |
| Purchase-Tracking EUR | ✅ Live + heute getestet |
| Trial 7 Tage → App-Sperre danach | ✅ Live |
| Stripe Checkout (3 Pläne) | ✅ Live |
| Blur-Teaser für Upsell innerhalb Pläne | ✅ Live |
| iOS / Android App | ✅ Live |
| Admin: Plan + Gift-Label | ✅ Live |
