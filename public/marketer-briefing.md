# Glev — Marketer Briefing: Tech-Stand für Ads-Launch
**Stand: 27. Mai 2026**

---

## Was wurde gebaut, damit die Ads funktionieren?

Du schaltest Ads auf eine Landing Page. Ein Nutzer klickt, landet auf glev.app, sieht die App — und soll entweder direkt kaufen oder testen. Hier ist was technisch bereit steht:

---

## 1. Free Trial — 7 Tage kostenlos testen

Ein neuer Nutzer der sich über `/signup` registriert bekommt automatisch **7 Tage Pro-Zugang geschenkt** — keine Kreditkarte nötig.

- Trial startet beim Account-Anlegen (`trial_end_at = heute + 7 Tage` in der Datenbank)
- Während des Trials sieht der Nutzer **alles** was auch ein Pro-Abonnent sieht
- Wenn der Trial ausläuft: Modal erscheint mit Upgrade-Aufforderung, App geht in den Free-Modus

**Für die Ad-Copy:** „7 Tage kostenlos — keine Kreditkarte" funktioniert technisch einwandfrei.

---

## 2. Was Free-Nutzer nach dem Trial sehen (Blur-Teaser)

Gesperrte Features werden **nicht versteckt** — sie werden **unscharf gezeigt** mit einem Schloss-Icon drüber. Der Nutzer sieht was ihn erwartet, kann es aber nicht nutzen.

### Gesperrte Bereiche ab Pro (€14,90/Mo):

| Was der Nutzer sieht | Feature |
|---|---|
| Insights: GMI / Ø-Blutzucker | Ausgewertet wie gut der Langzeit-BZ ist |
| Insights: Time-in-Range | Wie oft war der BZ im Zielbereich |
| Insights: Glukose-Trend + CV% | Wie stabil ist der BZ über Zeit |
| Insights: Mahlzeiten-Bewertung | Welche Mahlzeiten erhöhen den BZ zu stark |
| Insights: Muster-Erkennung | Wiederkehrende BZ-Muster |
| Engine: Bolus-Empfehlung | Die KI schlägt eine Insulindosis vor |

### Gesperrte Bereiche nur Plus (€29/Mo):

| Was der Nutzer sieht | Feature |
|---|---|
| PDF-Bericht für den Arzt | Export für Arzttermine |
| CSV-Export | Alle Daten als Tabelle |

> **CGM-Verbindung (LibreLink / Nightscout) ist für alle Pläne kostenlos** — kein Gate, kein Schloss.

---

## 3. Upgrade-Flow

Wenn ein gesperrtes Feature angeklickt wird → Button „Upgraden →" → `/pro` (Pricing-Seite mit Stripe-Checkout).

Stripe ist live und getestet:
- Smart S: €9/Mo
- Pro M: €14,90/Mo
- Plus L: €29/Mo

---

## 4. Meta Pixel — Purchase-Tracking

Das Meta Pixel feuert `Purchase`-Events bei erfolgreichem Checkout. Der **Test-Purchase wurde am 27.05.2026 erfolgreich im Meta Events Manager aufgezeichnet** — das Tracking funktioniert korrekt in Produktion. Der Test-Code wurde aus den Vercel-Umgebungsvariablen entfernt, nur der Live-Pixel ist aktiv.

---

## 5. Admin-Tools (für dich als Operator)

Im Admin-Backend (`glev.app/admin/users`) kannst du:

- **Nutzern manuell einen Plan setzen** — z.B. für Influencer, Tester, Friends & Family
- **Gift-Label vergeben** — markiert Nutzer sichtbar als „🎁 Lifetime Access", „Influencer" etc.
- **Free-Year-Programm** — 1-Klick für Diabetolog:innen und Multiplikator:innen (sendet automatisch Welcome-Mail)
- **Alle Nutzer** in der Übersicht mit Plan, Status, CGM-Verbindung, Land, Sprache

---

## 6. App-Plattformen

Die App ist gleichzeitig verfügbar als:
- **Web:** glev.app (läuft auf Vercel, deployed bei jedem `git push`)
- **iOS:** TestFlight (Capacitor-Shell, lädt glev.app — kein neuer App-Store-Build nötig für Content-Änderungen)
- **Android:** Google Play Internal Testing (gleiche Logik)

Ein Deploy = alle drei Plattformen aktualisiert.

---

## Zusammenfassung

| Punkt | Status |
|---|---|
| Trial (7 Tage kostenlos, keine Kreditkarte) | ✅ Live |
| Blur-Teaser für gesperrte Features | ✅ Live |
| Upgrade-Button → Stripe Checkout | ✅ Live |
| Meta Pixel Purchase-Tracking | ✅ Live + getestet |
| iOS / Android App | ✅ Live (Capacitor) |
| Admin: manueller Plan + Gift-Label | ✅ Live |
