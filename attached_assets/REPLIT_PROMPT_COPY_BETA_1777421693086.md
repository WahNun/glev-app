# REPLIT PROMPT — glev.app/beta: Copy Update

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## AUFGABE

Ersetze die Copy auf der /beta Seite — Headline, Subline, Trust-Signale, Dringlichkeit und CTA-Text. Kein Layout, kein Styling.

---

## STEP 1 — Datei finden

```bash
find app -name "page.tsx" | xargs grep -l "beta\|Beta" -i 2>/dev/null
```

Wahrscheinlich unter:
- `app/(public)/beta/page.tsx`
- `app/beta/page.tsx`

---

## STEP 2 — Neue Copy einbauen

### Headline
**Neu:**
```
Bessere Insulinentscheidungen. Jetzt in der Beta testen.
```

### Subline
**Neu:**
```
Wir bauen Glev gemeinsam mit den ersten Nutzer:innen auf. Du bekommst echten Einfluss auf das Produkt — und Zugang, bevor es für alle öffnet.
```

### Dringlichkeit (falls Countdown oder Platz-Anzeige vorhanden)
Ersetze durch statischen Text:
```
Noch 23 Plätze frei
```
(Kein Countdown-Timer — statischer Text ist ehrlicher)

### Trust-Signale
Falls bereits vorhanden: ersetzen. Falls nicht: als 3 kurze Zeilen unter dem Formular einfügen:
```
Kein Spam · DSGVO-konform · Nur echte Updates
```

### Formular-Labels (falls vorhanden, sonst stehen lassen)
- E-Mail-Feld: `Deine E-Mail-Adresse`
- Zusatzfeld 1: `Hast du Typ-1-Diabetes?` — Optionen: Ja / Nein
- Zusatzfeld 2: `Dein CGM-Gerät` — Optionen: FreeStyle Libre / Dexcom / Anderes

Falls das Formular diese Felder nicht hat: **nicht hinzufügen** — nur bestehende Labels umbenennen.

### CTA-Button-Text
**Neu:**
```
Frühzugang sichern
```

---

## NICHT ÄNDERN

- Countdown-Logik (falls vorhanden, nur ausblenden oder durch statischen Text ersetzen)
- Preisanzeige / Feature-Liste
- Styling / Tailwind-Klassen
- Andere Seiten

---

## VERIFY

1. `tsc --noEmit` → kein Fehler
2. /beta im Browser → neue Headline, Subline und Trust-Zeile sichtbar
3. CTA-Button → führt zum Stripe Payment Link (nicht verändern)
4. `git add -A && git commit -m "copy(beta): update headline, subline, trust signals and CTA" && git push origin main`

=== END ===
