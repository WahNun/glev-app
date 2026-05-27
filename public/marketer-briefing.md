# Glev — Marketer Briefing: Tech-Stand für Ads-Launch
**Stand: 27. Mai 2026**

---

## 1. Free Trial — 7 Tage voller Zugang

Neuer Nutzer → registriert sich → bekommt automatisch **7 Tage Pro-Zugang**, keine Kreditkarte nötig.

Nach 7 Tagen: **App komplett gesperrt** — Modal erscheint, kein Weiterkommen ohne Upgrade.

**Für die Ad-Copy:** „7 Tage kostenlos testen — dann ab €14,90/Mo" ✅

---

## 2. Upgrade-Flow nach Trial-Ende

Trial abgelaufen → Modal blockiert die App → „Jetzt upgraden" → Stripe Checkout:

| Plan | Preis | Für wen |
|---|---|---|
| Glev Smart S | €9/Mo | Einsteiger, CGM-Basis |
| Glev Pro M | €14,90/Mo | Alle KI-Insights + Bolus-Engine |
| Glev+ L | €29/Mo | PDF-Arztbericht, CSV, Caregiver |

---

## 3. Blur-Teaser für bezahlte Nutzer auf niedrigerem Plan

Wer bereits zahlt aber ein höheres Feature haben will sieht es **unscharf mit Schloss** — kein hartes Nein, sondern ein visueller Anreiz zum Upgrade.

Beispiel Smart-User (€9) sieht unscharf:
- KI-Bolus-Empfehlung
- Alle Insights-Karten (GMI, TIR, Muster, Mahlzeiten-Bewertung…)

Beispiel Pro-User (€14,90) sieht unscharf:
- PDF-Arztbericht
- CSV-Export

> **CGM-Verbindung (LibreLink / Nightscout) ist für alle Pläne kostenlos** — kein Gate.

---

## 4. Meta Pixel — Purchase-Tracking

`Purchase`-Event feuert bei erfolgreichem Stripe-Checkout. **Test-Purchase wurde am 27.05.2026 erfolgreich im Meta Events Manager aufgezeichnet.** Test-Code aus Vercel entfernt, nur Live-Pixel aktiv.

---

## 5. Admin-Tools

Unter `glev.app/admin/users`:
- Manuellen Plan setzen (für Influencer, Tester, Friends & Family)
- Gift-Label vergeben (🎁 sichtbar in der Übersicht + Detailseite)
- Free-Year-Programm für Diabetolog:innen (1-Klick + automatische Welcome-Mail)

---

## 6. Plattformen

Ein `git push` = Web + iOS (TestFlight) + Android (Play Store) gleichzeitig aktualisiert. Kein separater App-Store-Build nötig für Content-Änderungen.

---

## Zusammenfassung

| Punkt | Status |
|---|---|
| Trial 7 Tage → danach App komplett gesperrt | ✅ Live |
| Stripe Checkout (3 Pläne) | ✅ Live |
| Blur-Teaser für Upgrades zwischen Plänen | ✅ Live |
| Meta Pixel Purchase-Tracking | ✅ Live + getestet |
| iOS / Android App | ✅ Live |
| Admin: Plan + Gift-Label | ✅ Live |
