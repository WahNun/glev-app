# Makro-Berechnung: Legacy vs. AI-Chat vs. Future Option

**Stand:** Juni 2026  
**Kontext:** Glev T1D — Insulin-Entscheidungssystem  
**Zielgruppe:** Produkt- und Technik-Diskussion

---

## 1. Überblick

Glev hat derzeit **zwei parallele Pfade** für die Makro-Berechnung einer Mahlzeit.
Sie nutzen unterschiedliche Quellen und liefern unterschiedliche Genauigkeit und Geschwindigkeit.

| | Legacy | AI-Chat (aktuell) | Future Option |
|---|---|---|---|
| Trigger | Sprache/Tippen im Engine-Screen | Glev AI Chat | Glev AI Chat (verbessert) |
| Makro-Quelle | OFF / USDA / User-History | Mistral-Schätzung | Mistral-Extraktion + OFF/USDA |
| Genauigkeit | hoch (DB-basiert) | mittel (LLM-Schätzung) | hoch (DB-basiert) |
| Ladezeit (typisch) | ~2,7 s | ~2–3 s | ~2,2 s |
| Ladezeit (best case) | ~1,6 s | ~1,5 s | ~1,6 s |
| Ladezeit (worst case) | ~6 s | ~4 s | ~3,5 s |

---

## 2. Option A — Legacy Pipeline (`/api/parse-food`)

### Wie es funktioniert

**Stage 1 — GPT-4o-mini Parser** (`lib/nutrition/parseFood.ts`)

Der Parser liest den Freitext und extrahiert **Struktur**, schätzt aber **keine Makros**:
- Einzelne Items mit Portionsgröße (z. B. `banana 120g`)
- Markenerkennung (`is_branded`)
- Zweisprachige Suchbegriffe für OFF (DE) und USDA (EN)
- Modell: GPT-4o-mini, Strict JSON Schema (garantiert valide Struktur, keine Markdown-Fences)

**Stage 2 — Smart Aggregator** (`lib/nutrition/aggregate.ts`)

Für jedes Item wird **parallel** (Promise.all) nach dieser Priorität gesucht:

```
1. User-History      (RLS-geschützt, persönliche Daten — schnellster + personalisiertester Pfad)
   ↓ miss
2a. branded → Open Food Facts  →  USDA-Fallback
2b. generic → USDA             →  OFF-Fallback
   ↓ beide miss
3. GPT-4o-mini Estimator       (letzter Ausweg — gibt nie silent zeros zurück)
```

Ergebnis: Jedes Item bekommt ein `source`-Tag: `user_history | open_food_facts | usda | estimated`.

### Ladezeiten — mit Belegen

Alle Timeouts sind Hardcoded im Code:

```
PARSE_TIMEOUT_MS  = 6.000 ms  (parseFood.ts Zeile 87)
OFF_TIMEOUT_MS    = 2.500 ms  (openFoodFacts.ts Zeile 19)
USDA_TIMEOUT_MS   = 2.500 ms  (usda.ts Zeile 21)
ESTIMATE_TIMEOUT  = 4.000 ms  (estimate.ts Zeile 47)
```

Typische Antwortzeiten aus Code-Kommentaren:

| Stage | Best Case | Typisch (p95) | Worst Case |
|---|---|---|---|
| Stage 1 (GPT Parser) | ~0,8 s | ~1,5 s | 6,0 s (Timeout) |
| Stage 2 — User-History-Hit | ~10 ms | ~50 ms | ~200 ms |
| Stage 2 — OFF (warm cache) | 0 ms | ~1,2 s | 2,5 s (Timeout) |
| Stage 2 — USDA (warm cache) | 0 ms | ~0,6 s | 2,5 s (Timeout) |
| Stage 2 — OFF + USDA parallel | 0 ms | ~1,2 s | 2,5 s |
| Stage 2 — GPT Estimator (Fallback) | — | ~2,0 s | 4,0 s (Timeout) |

**Quelle der p95-Werte:** Direkt in den Client-Dateien kommentiert  
(`openFoodFacts.ts` Zeile 14: *"OFF p95 is ~1.2s when healthy"*,  
`usda.ts` Zeile 16–17: *"USDA p95 is ~600ms when not rate-limited"*)

**Gesamtladezeit (Stage 1 + Stage 2, parallel):**

```
Best case  (User-History-Hit):         ~1,5 s + ~50 ms    = ~1,6 s
Typisch    (DB-Hit, OFF oder USDA):    ~1,5 s + ~1,2 s    = ~2,7 s
Schlechter (beides Miss, GPT-Fallback):~1,5 s + 2,5 s + ~2 s = ~6 s
```

> **Wichtig:** OFF und USDA laufen in `Promise.all` parallel — der langsamere der beiden bestimmt Stage-2-Zeit, nicht die Summe.  
> **Cache:** In-Process-LRU für OFF und USDA. Beim zweiten Aufruf desselben Items in derselben Vercel-Instanz: 0 ms.

### Stärken
- **Echte Nährwertdaten** — Open Food Facts hat Barcode-Daten für Millionen von Markenprodukten (Haribo, Yfood, Bettery, Coca Cola etc.)
- **USDA Foundation/SR Legacy** — kuratierte Referenzwerte für generische Zutaten (Banane, Hühnerbrust, Reis)
- **Personalisiert** — User-History lernt aus vergangenen Logs: typische Portionsgrößen, individuelle Korrekturen
- **Transparent** — jedes Item bekommt ein `source`-Tag, die UI kann "aus Datenbank" vs. "geschätzt" anzeigen
- **Sicherheitsnetz** — schlägt nie lautlos fehl (NutritionEstimateError → UI fordert manuelle Eingabe)

### Schwächen
- Läuft nur bei Aktivierung durch den Engine-Screen (Sprache oder Tippen)
- Nutzer muss den AI-Chat verlassen und in den Engine-Screen wechseln
- Bei unbekannten Nischenprodukten fällt es auf GPT-Schätzung zurück

---

## 3. Option B — AI-Chat direkt (aktueller Stand)

### Wie es funktioniert

Wenn der Nutzer im Glev AI Chat eine Mahlzeit nennt, ruft Mistral das Tool `log_meal_entry` auf.
Die Parameter `carbs_grams`, `protein_grams`, `fat_grams` werden von Mistral selbst befüllt — **direkt aus dem Trainings-Wissen des Modells, ohne externen DB-Aufruf.**

Tool-Beschreibung im System-Prompt (Zeile 164, `glevTools.ts`):  
> *"Bei unklaren Werten schätze die Makros nach bestem Wissen — der Nutzer kann sie anschließend korrigieren."*

Das Ergebnis wird als `meal_prep`-Frame gesendet, der Engine-Screen öffnet sich mit vorausgefüllten Makros.

### Ladezeiten

Die Chip-Anzeige hängt am Ende des gesamten Mistral-Streaming-Turns (Parser + Antworttext + Tool-Call-Parameter erscheinen alle in einem Stream):

| Phase | Typisch | Worst Case |
|---|---|---|
| Mistral: Tool-Call (erster Turn) | ~1,5–2 s | ~4 s |
| Mistral: Antwort-Text nach Tool | ~0,5–1 s | ~2 s |
| Stream-Ende → Chip sichtbar | — | — |
| **Gesamt bis Chip** | **~2–3 s** | **~4–6 s** |

> Keine separaten Timeout-Werte im Code — Mistral-Streaming läuft bis zur natürlichen Terminierung oder Browser-Disconnect.

### Stärken
- **Keine zusätzliche Latenz durch externe APIs** — alles in einem Mistral-Turn
- **Kontextbewusst** — Mistral kennt den Gesprächsverlauf ("wie letzte Woche", "ähnlich wie das Croissant davor")
- Funktioniert auch für Gerichte, die in keiner DB stehen (exotische Küche, Eigenrezepte)

### Schwächen
- **Keine echten Nährwertdatenbanken** — Mistral schätzt aus Parameterwissen, das beim Training eingefroren wurde
- **Keine User-History** — persönliche Portionsgrößen oder Korrekturen fließen nicht ein
- **Keine `source`-Transparenz** — Nutzer sieht nicht, ob der Wert aus echten Daten stammt oder geschätzt ist
- **Markierte Fehlerquellen:** Für Haribo z. B. kennt Mistral "~75g KH / 100g" ungefähr, aber nicht die aktuellen Produktvarianten. Die Lücke zum echten Wert kann bei Insulindosierung klinisch relevant sein.

---

## 4. Option C — Future: Mistral-Extraktion + DB-Pipeline (Backlog)

### Idee

`log_meal_entry` ruft nach dem Tool-Call-Parameter-Parsing intern die Aggregator-Pipeline auf, anstatt Mistrals Schätzwerte direkt weiterzugeben.

**Smart-Variante (empfohlen):**  
Mistral liefert `input_text` + `item_list` (Namen + Gramm). Stage 1 (GPT-Parser) wird **übersprungen** — Mistral hat die Items schon strukturiert. Stage 2 (Aggregator: OFF/USDA/User-History) läuft direkt mit Mistrals extrahierten Items.

```
Mistral Tool-Call (~1–1,5 s)
  → Stage 2 Aggregator parallel: OFF + USDA + User-History (~1,2 s)
  → meal_prep mit DB-basierten Makros → Chip sichtbar
Gesamt: ~2,2 s (typisch), ~3,5 s (worst case)
```

**Full-Variante (nicht empfohlen):**  
Stage 1 (GPT-Parser) wird dazwischen geschaltet — re-parsed den Text ein zweites Mal. Fügt ~1,5 s hinzu ohne Mehrwert, weil Mistral bereits strukturiert hat.

### Ladezeiten

| Variante | Best Case | Typisch | Worst Case |
|---|---|---|---|
| Smart (Stage 2 only) | ~1,6 s | ~2,2 s | ~3,5 s |
| Full (Stage 1 + Stage 2) | ~3,1 s | ~4,2 s | ~9 s |

### Stärken
- Gleiche Datenqualität wie Legacy (OFF/USDA/User-History)
- Bleibt im Chat-Flow — kein UI-Bruch, kein Tab-Wechsel nötig
- `source`-Tag kann im Engine-Prefill angezeigt werden ("Quelle: Open Food Facts")
- User-History funktioniert auch im Chat

### Schwächen
- ~200–500 ms langsamer als aktueller AI-Chat-Pfad (wegen Stage-2-Lookup)
- Komplexere Fehlerbehandlung: Was wenn OFF/USDA beide zu lange brauchen?
- Erfordert Umbau von `toolLogMealEntry()` in `glevTools.ts`

---

## 5. Gesamtvergleich

| Kriterium | Legacy | AI-Chat (jetzt) | Future Smart |
|---|---|---|---|
| **Makro-Quelle** | OFF + USDA + User-History | Mistral-Wissen | OFF + USDA + User-History |
| **Ladezeit typisch** | ~2,7 s | ~2–3 s | ~2,2 s |
| **Ladezeit best case** | ~1,6 s | ~1,5 s | ~1,6 s |
| **Ladezeit worst case** | ~6 s | ~4 s | ~3,5 s |
| **Genauigkeit Marken** | ✅ hoch (echte Label-Daten) | ⚠️ mittel | ✅ hoch |
| **Genauigkeit Generics** | ✅ hoch (USDA kuratiert) | ⚠️ mittel | ✅ hoch |
| **Personalisierung** | ✅ User-History | ❌ keine | ✅ User-History |
| **Transparenz (source)** | ✅ per-item source-Tag | ❌ keine | ✅ per-item source-Tag |
| **Kontextbewusst** | ❌ kein Gesprächskontext | ✅ ja | ✅ ja |
| **UI-Bruch** | ⚠️ wechselt Tab | ✅ bleibt im Chat | ✅ bleibt im Chat |
| **Implementierungsaufwand** | — (fertig) | — (fertig) | mittel (~1 Sprint) |

---

## 6. Einschätzung

**Kurzfristig (jetzt):** Der AI-Chat-Pfad ist für Schnell-Logging und kontextuelle Eingaben gut genug — besonders weil der Nutzer die Makros im Engine-Screen sieht und korrigieren kann, bevor er speichert. Die Schätzqualität von Mistral ist für Standardnahrungsmittel (Banane, Nudeln, Brot) akzeptabel.

**Mittelfristig (Backlog):** Option C Smart ist der klare Gewinner — gleiche oder bessere Ladezeit als Legacy, Datenbank-Genauigkeit, und kein UI-Bruch. Der Schlüssel ist Stage 1 zu überspringen (Mistral hat schon strukturiert) und direkt in Stage 2 zu gehen.

**Wo die Lücke klinisch relevant wird:** Branded Products. Haribo Goldbären (ca. 77g KH / 100g laut Etikett) können je nach Produktvariante abweichen. Für einen T1D mit 1:10 ICR bedeutet eine 10 % Schätzabweichung bei 50g Haribo rund 0,5 IE Bolus-Fehler — relevant aber vom Nutzer korrigierbar.

---

*Belege: `lib/nutrition/parseFood.ts` (L87), `lib/nutrition/openFoodFacts.ts` (L14–19), `lib/nutrition/usda.ts` (L16–21), `lib/nutrition/estimate.ts` (L47), `lib/nutrition/aggregate.ts` (L18–36), `lib/ai/glevTools.ts` (L162–197)*
