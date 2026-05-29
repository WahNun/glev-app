# Insights UI-Fixes: Bars Y-Achse, Typ-Labels, Tageszeit-Chip, Performance-Tiles

## Was geändert wurde

### InsightMicroBars — Y-Achse + Baseline
- Y-Achse links: max / mid (wenn max ≥ 4) / 0 als kleine Mono-Labels
- Horizontale Midline-Gridlinie (halbe Höhe, 25 % Opacity)
- X-Achse: 1px Baseline unter den Balken, Labels danach (statt innerhalb der Bar-Höhe)
- Y-Achse-Breite: 22px fest, damit Zahlen nicht abgeschnitten werden

### Karte 14 — Mahlzeiten-Typ-Tile-Labels
- `whiteSpace:nowrap + textOverflow:ellipsis + overflow:hidden` entfernt
- Stattdessen `lineHeight:1.25 + wordBreak:break-word + flex:1 + letterSpacing:0.04em`
- `alignItems:center` → `flex-start` damit die %-Zahl oben rechts bleibt wenn der Label umbricht

### Karte 14 — Unterer Chip (Verwechslungs-Fix)
- Bisher: "Schnelle Kohlenhydrate 36 %" → wirkte wie Trefferquote (war aber COUNT-Anteil)
- Neu: Count-Anzeige "Schnelle Kohlenhydrate · 10×" + Mini-Label "häufigster Typ" oben
- `domPct` bleibt im Code, wird aber nicht mehr angezeigt

### Karte 15 — Tageszeit: dritter Chip
- Neuer "Aktivstes Fenster"-Chip: Tageszeit mit den meisten Mahlzeiten + absoluter Count
- Gesamtzahl-Zeile darunter (totalMeals)
- Best/Worst-Chips bleiben unverändert oben

### Karte 16 — Performance-Tiles Rendering-Fix
- **Problem:** `transformStyle:preserve-3d + backfaceVisibility:hidden` auf CSS-Grid-Container funktioniert auf iOS Safari nicht — Back-Content leckte durch den Front durch
- **Fix:** CSS 3D-Flip komplett entfernt; `{flipped ? backContent : frontContent}` mit `transition:opacity 0.15s` — zuverlässig auf allen Plattformen
- Card-Header hinzugefügt: `CardLabel "Leistungs-Metriken"` + Rechts-Hint "Tippen zum Erklären"
- Ø Glukose: Farb-Kodierung dynamisch (<100→GREEN / 100–130→ORANGE / >130→PINK)
- Trefferquote: Farb-Kodierung dynamisch (≥70→GREEN / ≥50→ORANGE / <50→PINK) statt hart GREEN

### Neue i18n-Keys
- `card_performance_title` / `card_performance_sub` in `messages/de.json` + `messages/en.json`

## Keine strukturellen Änderungen
- Kein neues Schema, keine neue Auth-Logik, keine neuen API-Routes
- Kein D-XXX-Eintrag erforderlich
