# REPLIT PROMPT — glev.app/pro: Copy Update

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## AUFGABE

Füge oben auf der /pro Seite einen Szenario-Block ein (Aha-Moment) und ersetze die bestehende Feature-Beschreibung. Kein Styling-Änderung — nur Copy.

---

## STEP 1 — Datei finden

```bash
find app -name "page.tsx" | xargs grep -l "pro\|Pro" -i 2>/dev/null
```

Wahrscheinlich unter:
- `app/(public)/pro/page.tsx`
- `app/pro/page.tsx`

---

## STEP 2 — Szenario-Block einbauen

Füge diesen Block direkt unterhalb der Hero-Headline / oberhalb der Feature-Liste ein:

```tsx
<section>
  <p>Du bist bei 112 mg/dL. Du willst gleich 60g Kohlenhydrate essen. Dein Wert steigt leicht.</p>

  <div>
    <div>
      <strong>Ohne Glev</strong>
      <p>Du spritzt sofort → später 220 mg/dL. Überzucker.</p>
    </div>
    <div>
      <strong>Mit Glev</strong>
      <p>Du wartest 10 Minuten → stabil bei 140. Fertig.</p>
    </div>
  </div>
</section>
```

Übernimm die Klassen der umliegenden Sections (nicht neu erfinden).

---

## STEP 3 — Feature-Texte ersetzen

Suche die 3 Feature-Cards / Feature-Bullets und ersetze deren Texte:

**Feature 1:**
- Titel: `Trend erkannt`
- Text: `Nicht nur der aktuelle Wert — Glev sieht, wohin er geht.`

**Feature 2:**
- Titel: `Mahlzeit einberechnet`
- Text: `Kohlenhydrate, Protein, Fett — alles fließt in die Empfehlung ein.`

**Feature 3:**
- Titel: `Timing angepasst`
- Text: `Wann spritzen, nicht nur wie viel — der Unterschied zwischen 140 und 220.`

---

## STEP 4 — CTA sicherstellen

Der primäre CTA-Button auf /pro soll lauten:

```
Frühzugang testen
```

Und auf `/beta` verlinken. Falls er das schon tut — stehen lassen. Nur Text anpassen falls nötig.

---

## NICHT ÄNDERN

- Preisanzeige
- FAQ
- Styling / Tailwind-Klassen
- Andere Seiten

---

## VERIFY

1. `tsc --noEmit` → kein Fehler
2. /pro im Browser → Szenario-Block sichtbar, Vorher/Nachher lesbar
3. CTA → landet auf /beta
4. `git add -A && git commit -m "copy(pro): add scenario block and update features" && git push origin main`

=== END ===
