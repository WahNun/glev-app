# Diagnose Pricing Overhaul — 2026-05-18

## Zusammenfassung

**Done:**
- Neue Checkout-Routen `app/api/checkout/beta/route.ts` + `app/api/checkout/pro/route.ts` nutzen `trial_end`.
- `/beta`- und `/pro`-Page-Code sind sauber auf `useTranslations()` umgestellt (keine harten Preis-Strings im Page-Code).
- TypeScript für App-Code clean.

**Fehlt:**
- Alte Parallel-Route `app/api/pro/checkout/route.ts` lebt noch und nutzt `trial_period_days` (Routen-Duplikat).
- `/plus`-Checkout-Route existiert nicht.
- `/klinik`-Page existiert nicht (Inhalt nur als Homepage-Sektion).
- Homepage zeigt **Beta / Pro / Klinik**, nicht **Smart / Pro / + (S/M/L)**.
- `messages/de.json` enthält noch 11 alte €4,50-Strings — d.h. die i18n-cleanen Pages rendern weiter alte Copy.
- `app/legal/page.tsx` zeigt noch €4,50 + €24,90.
- `app/preview-beta/layout.tsx` Metadata enthält noch „4,50 EUR".
- Beta-Checkout-Route hat noch 3-Monats-Coupon-Logik auf €4,50/$4.50.
- Spec-Wert `trial_end: 1751328000` = 2025-07-01 (Vergangenheit, Stripe lehnt ab). Code hat `1782864000` = 2026-07-01 — vermutlich Spec-Tippfehler.

---

## CHECK 1 — `trial_end`

| Route | Status | Befund |
|---|---|---|
| `app/api/checkout/beta/route.ts:88` | ✅ | `trial_end: trialEnd` |
| `app/api/checkout/pro/route.ts:94` | ✅ | `trial_end: PRO_TRIAL_END` (Konstante = `1782864000` = 2026-07-01 UTC) |
| `app/api/pro/checkout/route.ts:165` | ❌ | **Alte Parallel-Route** nutzt noch `trial_period_days: trialDays > 0 ? trialDays : undefined` |
| `app/api/checkout/plus/` | ❌ | Existiert nicht |

**Wertabgleich:** Spec sagt `1751328000` → das ist **2025-07-01** (Vergangenheit, Stripe würde mit „trial_end must be at least 48h in future" rejecten). Code-Wert `1782864000` = 2026-07-01 ist konsistent mit „Launch Juli 2026". → Spec vermutlich Tippfehler.

**Webhook-Treffer** in `app/api/pro/webhook/route.ts` (`trial_end`-Lesezugriffe auf Stripe-Subscription) sind read-side und korrekt.

---

## CHECK 2 — €4,50 entfernt

❌ **16 Treffer in 4 Dateien:**

| Datei | Zeilen | Kontext |
|---|---|---|
| `app/api/checkout/beta/route.ts` | 11, 13, 18, 78 | Kommentare + 3-Monats-Coupon-Logik (`€4,50/$4.50`) |
| `app/legal/page.tsx` | 246 | Sichtbarer Preis-Block „Free → Pro (ab Juli 2026)" |
| `app/preview-beta/layout.tsx` | 6 | Metadata-Description „Erste 3 Monate 4,50 EUR …" |
| `messages/de.json` | 1850, 1886, 2123, 2189, 2193, 2199, 2201, 2203, 2212, 2268, 2496 | UI-Strings: `pricing_beta_price`, `tier_beta_subtext`, `pricing_l2_left`, FAQ-Antworten, Hero-Subtitles, Beta-Bullets |

→ Beta-Coupon-Code ist Stripe-Logik (kein bloßer Text) — fachlich entscheiden: Coupon weg oder nur Copy anpassen?

---

## CHECK 3 — Homepage

❌ **Keine S/M/L-Karten.** Aktuelle Struktur (`app/page.tsx`):

| Karte | Zeilen | i18n-Namespace | Status |
|---|---|---|---|
| Beta | 699–755 | `pricing_beta_*` | Preis aus `pricing_beta_price` = `€4,50`, CTA → `/beta` |
| Pro · Founder (hervorgehoben) | 778–854 | `pricing_pro_*` | 7 Bullets, CTA → `/pro` |
| Klinik (Coming Soon) | 1187–1290 | `pricing_klinik_*` | `€299/Monat`, Email-Warteliste, kein Stripe |

- Inline-Kommentar Z. 638–646 dokumentiert diese 3-Karten-Struktur explizit.
- ❌ Kein „Smart"-Tier, kein „Plus"-Tier.
- ❌ Klinik nicht entfernt — laut Spec sollte das alte Klinik-Paket weg sein.

---

## CHECK 4 — `/beta`

✅ **Page-Code sauber** — `app/beta/page.tsx` rendert ausschließlich über `useTranslations("previewBeta")`. Direkte grep-Suche im Page-Code: 0 Treffer für `4,50`, `Beta-Reservierung`, `Smart`, `€9`, `Lifetime`.

❌ **Translation-Keys nicht migriert** — Inhalt liegt in `messages/de.json` Namespace `previewBeta` (ab Z. 2187):

| Key | Zeile | Inhalt |
|---|---|---|
| `hero_subtitle` | 2189 | „Ab Juli: 4,50 € statt 9 €." |
| `positioning` | 2193 | „Die ersten 3 Monate zahlst du 4,50 €. Danach 9 €." |
| `flow_3_text` | 2199 | „4,50 € statt 9 €." |
| `pricing_headline` | 2201 | „Ab 1. Juli 2026: 4,50 € / Monat" |
| `pricing_bullet_2` | 2203 | „Erste 3 Monate: 4,50 € / Monat" |
| `faq_a3` | 2212 | „Die ersten 3 Monate 4,50 €, danach 9 €/Monat — dauerhaft." |

Kein „Glev Smart"-Key im Beta-Namespace gefunden.

---

## CHECK 5 — `/pro`

✅ **Page-Code sauber** — `app/pro/page.tsx` rendert ausschließlich über `useTranslations("previewPro")`. Direkte grep-Suche im Page-Code: 0 Treffer für `4,50`, `24,90`, `14,90`, `Lifetime`, „Glev Pro".

⚠️ **Translation-Keys nicht in dieser Diagnose verifiziert** — Namespace `previewPro` startet bei `messages/de.json:2230`, müsste separat auf „14,90" + „Lifetime Lock" geprüft werden.

⚠️ **Backend-Risiko:** alte Route `app/api/pro/checkout/route.ts` (siehe CHECK 1) könnte vom Frontend weiter angesprochen werden und alte €24,90-Logik triggern.

---

## CHECK 6 — `/klinik`

❌ **Page existiert nicht.**

```
$ find app -path "*/klinik*" -name "*.tsx"
(leer)
```

Klinik-Inhalt existiert nur als Sektion auf der Homepage (`app/page.tsx` Z. 1187–1290) mit Email-Warteliste + UI-only Toast statt Stripe-Checkout. Kein `mailto:klinik@glev.app` im Repo gefunden.

---

## CHECK 7 — `/plus` Checkout

❌ **Route existiert nicht.**

```
$ find app -path "*/plus/checkout*" -name "*.ts"
(leer)
$ ls app/api/plus/  →  No such file or directory
$ ls app/api/checkout/  →  beta  pro     (kein plus/)
```

→ Plus-Tier-Backend ist komplett nicht implementiert. Auch keine Page (`app/plus/`).

---

## CHECK 8 — AGB / Datenschutz

❌ **`app/legal/page.tsx` enthält alte Preise:**

| Zeile | Inhalt |
|---|---|
| 246 | `<div className="price">€ 4,50</div>` — „Free → Pro (ab Juli 2026), Einführungspreis" |
| 254 | `<div className="price">€ 24,90</div>` — „Pro (Vollpreis), regulärer Pro-Tarif" |

Keine separaten `terms`-/`datenschutz`-/`privacy`-/`impressum`-Dateien gefunden — vermutlich alle in `app/legal/page.tsx` konsolidiert.

---

## CHECK 9 — TypeScript

✅ **Keine neuen pricing-bezogenen Fehler.** App-Code (`app/`) typecheckt clean.

⚠️ Pre-existing Test-Fehler (**nicht pricing-relevant**, separate Baustelle):

| Datei | Fehler |
|---|---|
| `tests/unit/evaluation.test.ts` | `reasoning` fehlt auf `EvaluateEntryResult` (4×) |
| `tests/unit/pdfReport.test.ts` | `children` / `ExerciseType` Mismatch (7×) |
| `tests/unit/recommendation.test.ts` | `reasoning` fehlt auf `RecommendOutput` (9×) |

---

## Offene Punkte (priorisiert)

1. **`trial_end`-Wert klären:** Spec sagt `1751328000` (2025-07-01, Vergangenheit). Code hat `1782864000` (2026-07-01). Bestätigen, dass Code-Wert gemeint ist.
2. **Routen-Duplikat auflösen:** `app/api/pro/checkout/route.ts` löschen oder auf `app/api/checkout/pro/route.ts` umleiten — sonst greift das Frontend evtl. weiter den `trial_period_days`-Pfad.
3. **`/plus`-Checkout-Route bauen** (komplett fehlend) inkl. `STRIPE_PLUS_PRICE_ID` + `STRIPE_PLUS_PRICE_ID_US` + `trial_end`.
4. **`/klinik`-Page bauen** ODER Entscheidung dokumentieren, dass Klinik-Sektion auf Homepage die finale Lösung ist + `mailto:klinik@glev.app` ergänzen.
5. **Homepage-Pricing migrieren** auf S/M/L (Smart/Pro/+) ODER Spec anpassen, falls Beta/Pro/Klinik der finale Stand ist.
6. **`messages/de.json` Pricing-Strings** auf neue Tarife migrieren (alle `€4,50`-, `€9`-, `€24,90`- und „Beta-Reservierung"-Wordings).
7. **`previewPro`-Namespace** in `messages/de.json` separat auf „€14,90" + „Lifetime Lock" prüfen — diese Diagnose hat nur den Page-Code abgedeckt.
8. **`app/legal/page.tsx`** Preisblöcke aktualisieren.
9. **`app/preview-beta/layout.tsx`** Metadata-Description aktualisieren.
10. **`app/api/checkout/beta/route.ts`** 3-Monats-Coupon fachlich entscheiden: weiter nutzen, oder ersatzlos streichen?

Pre-existing Test-Fehler in `tests/unit/` sind **separate Baustelle**, kein Pricing-Thema.
