# Diagnose — Pricing Overhaul: Implementierungs-Status

**Datum:** 2026-05-18
**Modus:** Nur Prüfung, keine Code-Änderungen.
**Branch / HEAD:** `main` @ `0c41fde`

---

## TL;DR

| # | Check | Status |
|---|-------|--------|
| 1 | `trial_end` in Checkout-Routen | ⚠️ Teilweise — neue Routen unter `app/api/checkout/{beta,pro}/` OK; alte Route `app/api/pro/checkout/route.ts` nutzt noch `trial_period_days`. `/plus`-Route fehlt komplett. |
| 2 | €4,50 entfernt | ❌ 16 Treffer in 4 Dateien (Beta-Checkout-Code, Legal, preview-beta Layout, `messages/de.json`). |
| 3 | Homepage Pricing (S/M/L) | ❌ Keine S/M/L-Karten. Aktuell 3 Karten: **Beta · Pro · Klinik** (über `t("pricing_beta_*")`, `pricing_pro_*`, `pricing_klinik_*`). Kein „Smart"-Tier vorhanden. |
| 4 | `/beta` Landing | ⚠️ Komplett über i18n-Keys (`previewBeta.*`) — keine direkten Treffer auf „Smart"/„€9"/„Lifetime" im Page-Code. Inhalt steckt in `messages/de.json`, dort steht weiter alte Beta-Reservierungs-Copy + €4,50. |
| 5 | `/pro` Landing | ⚠️ Komplett über i18n-Keys (`previewPro.*`) — keine direkten Treffer im Page-Code. „14,90" / „Lifetime" nicht im Page-Code (müssen in den Translation-Keys liegen). |
| 6 | `/klinik` Landing | ❌ Existiert nicht. Klinik-Inhalt nur als Sektion auf der Homepage. |
| 7 | `/plus` Checkout-Route | ❌ Existiert nicht (`app/api/checkout/plus/` und `app/api/plus/` fehlen). |
| 8 | AGB / Datenschutz | ❌ `app/legal/page.tsx` enthält noch `€ 4,50` (Z. 246) und `€ 24,90` (Z. 254). |
| 9 | TypeScript | ✅ Keine **neuen** Fehler. Pre-existing Test-Fehler in `tests/unit/{evaluation,pdfReport,recommendation}.test.ts` (nicht pricing-bezogen). |

---

## CHECK 1 — `trial_end` in Checkout-Routen

**Erwartung:** `/api/beta/checkout`, `/api/pro/checkout`, `/api/plus/checkout` mit `trial_end: 1751328000`.

**Fund:**
- ✅ `app/api/checkout/beta/route.ts:88` — nutzt `trial_end: trialEnd`.
- ✅ `app/api/checkout/pro/route.ts:94` — nutzt `trial_end: PRO_TRIAL_END` (Konstante = **`1782864000`**, nicht `1751328000`).
  - `1751328000` = **2025-07-01** UTC (vergangenes Jahr).
  - `1782864000` = **2026-07-01** UTC.
  - → Code-Wert ist konsistent mit „Launch Juli 2026"; der in der Diagnose-Spec genannte Wert `1751328000` wäre **bereits in der Vergangenheit** und würde von Stripe abgelehnt. **Vermutlich Tippfehler in der Spec.** Wenn `1751328000` Absicht ist: bitte klären.
- ❌ `app/api/pro/checkout/route.ts:165` — **alte Parallel-Route** nutzt noch `trial_period_days: trialDays > 0 ? trialDays : undefined`. Existenz prüfen:
  - `app/api/pro/checkout/route.ts` (alt) ↔ `app/api/checkout/pro/route.ts` (neu).
  - → **Routen-Duplikat** → Risiko, dass je nach Frontend-Call die alte Route trifft.
- ❌ `app/api/checkout/plus/` / `app/api/plus/checkout/` existiert nicht → kein `trial_end` für Plus-Tier.

**Webhook-Treffer in `app/api/pro/webhook/route.ts` (`trial_end`) sind read-side** (Stripe-Subscription auslesen) und korrekt, nicht Teil der Setup-Pflicht.

---

## CHECK 2 — €4,50 entfernt

**Erwartung:** 0 Treffer.

**Fund: 16 Treffer in 4 Dateien.**

| Datei | Zeile | Kontext |
|---|---|---|
| `app/api/checkout/beta/route.ts` | 11, 13, 18, 78 | Kommentare + Coupon-Logik („3-Monats-Coupon auf €4,50/$4.50") |
| `app/legal/page.tsx` | 246 | Sichtbarer Preis-Block `€ 4,50` für „Free → Pro (ab Juli 2026)" |
| `app/preview-beta/layout.tsx` | 6 | Metadata-Beschreibung „Erste 3 Monate 4,50 EUR …" |
| `messages/de.json` | 1850, 1886, 2123, 2189, 2193, 2199, 2201, 2203, 2212, 2268, 2496 | UI-Strings: `pricing_beta_price`, `tier_beta_subtext`, `pricing_l2_left`, FAQ-Antworten, Hero-Subtitles, Beta-Bullets |

→ Beta-Coupon-Code in `app/api/checkout/beta/route.ts` ist Stripe-Logik (3-Monats-Discount) und müsste fachlich entschieden werden: Coupon entfernen oder nur Copy ändern?

---

## CHECK 3 — Homepage Pricing

**Erwartung:** S/M/L-Karten, altes Klinik-Paket entfernt.

**Fund:**
- Homepage (`app/page.tsx`) hat **3 Karten**:
  1. **Beta** (`pricing_beta_*` Keys, Z. 699–755): Preis aus `pricing_beta_price` (= `€4,50`), Strike-Through aus `pricing_beta_strike`, CTA → `/beta`.
  2. **Pro · Founder** (`pricing_pro_*` Keys, Z. 778–854, hervorgehoben mit Badge): 7 Bullets, CTA → `/pro`.
  3. **Klinik** (`pricing_klinik_*` Keys, Z. 1187–1290): `€299/Monat`, „Coming Soon", Email-Warteliste statt Stripe-Checkout, UI-only Toast.
- Inline-Kommentar (Z. 638–646) beschreibt diese Struktur explizit.
- ❌ **Keine S/M/L-Karten** (kein „Smart"-Tier, kein „Plus"-Tier).
- ❌ **Klinik nicht entfernt** — laut Spec sollte das alte Klinik-Paket weg sein; ist aber noch komplett im Pricing-Block drin.

---

## CHECK 4 — `/beta` Landing Page

**Erwartung:** Kein 4,50, kein „Beta-Reservierung", „Glev Smart" + €9 vorhanden.

**Fund:**
- `app/beta/page.tsx` rendert **ausschließlich über `useTranslations("previewBeta")`** — keine harten Preis-Strings im Page-Code.
- Direkte `grep`-Suche im Page-Code: **0 Treffer** für `4,50`, `Beta-Reservierung`, `Smart`, `€9`, `Lifetime`.
- Inhalt liegt in `messages/de.json` Namespace `previewBeta` (ab Z. 2187), dort steht **weiter alte Copy**:
  - Z. 2189 `hero_subtitle`: „Ab Juli: 4,50 € statt 9 €."
  - Z. 2193 `positioning`: „Die ersten 3 Monate zahlst du 4,50 €. Danach 9 €."
  - Z. 2201 `pricing_headline`: „Ab 1. Juli 2026: 4,50 € / Monat"
  - Kein „Smart"-Tier-Key gefunden.
- → Page-Code ist ready, **Translation-Keys sind nicht migriert**.

---

## CHECK 5 — `/pro` Landing Page

**Erwartung:** Kein 4,50, kein 24,90 — 14,90 + „Lifetime Lock" vorhanden.

**Fund:**
- `app/pro/page.tsx` rendert **ausschließlich über `useTranslations("previewPro")`** — keine harten Preis-Strings im Page-Code.
- Direkte `grep`-Suche im Page-Code: **0 Treffer** für `4,50`, `24,90`, `14,90`, `Lifetime`, „Glev Pro" (alles in i18n).
- Inhaltlich nicht in dieser Diagnose geprüft, da Spec-Check sich auf Page-Code bezog. Translation-Werte für `previewPro.*` müssten separat reviewed werden (Namespace startet bei `messages/de.json:2230`).
- **Hinweis:** Die alte Route `app/api/pro/checkout/route.ts` ist noch da und akzeptiert wahrscheinlich die alte €24,90-Logik.

---

## CHECK 6 — `/klinik` Landing Page

**Erwartung:** Eigene Seite, €299 + `mailto:klinik@glev.app`, kein Stripe-Checkout.

**Fund:**
- ❌ `find app -path "*/klinik*" -name "*.tsx"` → **leer**. Keine Klinik-Seite vorhanden.
- Klinik-Inhalt existiert nur **als Sektion auf der Homepage** (`app/page.tsx` Z. 1187–1290) mit Email-Warteliste + UI-Toast.

---

## CHECK 7 — `/plus` Checkout-Route

**Erwartung:** Route existiert, liest `STRIPE_PLUS_PRICE_ID` + `STRIPE_PLUS_PRICE_ID_US`, hat `trial_end`.

**Fund:**
- ❌ `find app -path "*/plus/checkout*" -name "*.ts"` → **leer**.
- Weder `app/api/checkout/plus/` noch `app/api/plus/checkout/` existiert.
- → **Plus-Tier-Backend ist nicht implementiert.**

---

## CHECK 8 — AGB / Datenschutz / Legal

**Erwartung:** Keine alten Preise.

**Fund:**
- ❌ `app/legal/page.tsx` enthält:
  - Z. 246: `<div className="price">€ 4,50</div>` — „Free → Pro (ab Juli 2026), Einführungspreis"
  - Z. 254: `<div className="price">€ 24,90</div>` — „Pro (Vollpreis), regulärer Pro-Tarif"
- Keine weiteren Hits in `terms`, `datenschutz`, `privacy`, `impressum` (Dateien nicht gefunden — vermutlich alle in `app/legal/page.tsx` konsolidiert).

---

## CHECK 9 — TypeScript

**Erwartung:** Kein Fehler.

**Fund:**
- ✅ **Keine neuen** pricing-bezogenen Fehler.
- Pre-existing Test-Fehler (nicht relevant für Pricing-Overhaul):
  - `tests/unit/evaluation.test.ts` — `reasoning` fehlt auf `EvaluateEntryResult` (4×)
  - `tests/unit/pdfReport.test.ts` — `children` / `ExerciseType` Mismatch (7×)
  - `tests/unit/recommendation.test.ts` — `reasoning` fehlt auf `RecommendOutput` (9×)
- App-Code (`app/`) selbst typecheckt sauber.

---

## Empfohlene Reihenfolge der Fixes (Priorität)

1. **Trial-End-Wert klären** (Spec sagt `1751328000` = 2025-07-01; Code hat `1782864000` = 2026-07-01). Spec ist vermutlich Tippfehler — bitte bestätigen.
2. **Alte Parallel-Route entfernen:** `app/api/pro/checkout/route.ts` löschen oder zur neuen `app/api/checkout/pro/route.ts` umleiten — sonst greift das Frontend evtl. weiter den `trial_period_days`-Pfad.
3. **`/plus`-Checkout-Route bauen** (komplett fehlend).
4. **`/klinik`-Page bauen** (komplett fehlend) ODER Klinik-Sektion auf Homepage als die endgültige Lösung dokumentieren.
5. **Homepage-Pricing migrieren** auf S/M/L (Smart/Pro/+) ODER Spec anpassen, falls das aktuelle Beta/Pro/Klinik-Layout final ist.
6. **`messages/de.json` Pricing-Strings** auf neue Tarife migrieren (alle €4,50 / €9 / €24,90 / „Beta-Reservierung"-Wordings).
7. **`app/legal/page.tsx`** Preisblöcke aktualisieren.
8. **`app/preview-beta/layout.tsx`** Metadata-Beschreibung aktualisieren.
9. **`app/api/checkout/beta/route.ts`** Coupon-Logik fachlich entscheiden (Coupon weiter nutzen oder ersatzlos streichen).

Pre-existing Test-Fehler in `tests/unit/` sind **separate Baustelle**, kein Pricing-Thema.
