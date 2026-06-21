# System-Prompt Refactor Audit

**Datum:** 2026-06-21  
**Branch:** `refactor/glev-chat-system-prompt`  
**Datei:** `lib/ai/glevChatPrompt.ts`

---

## Token-Count vor/nach

| Metrik | Vorher | Nachher | Reduktion |
|--------|--------|---------|-----------|
| Zeilen (Datei gesamt) | 97 | 75 | −23% |
| Template-String Zeichen | ~9 300 | ~6 200 | **−33%** |
| Token-Schätzung (÷ 3.5, Mistral-Heuristik) | ~2 657 | ~1 771 | **−33%** |

> Hinweis: Exakter Token-Count hängt vom Mistral-SentencePiece-Tokenizer ab.  
> Die Schätzung `chars ÷ 3.5` gilt für gemischtes Deutsch + JSON-Code.  
> Sprint-Ziel war ≥ 30 % — erreicht.

---

## Sektions-Reorganisations-Tabelle

| Alte Zeilen | Alter Inhalt | Neue Sektion |
|-------------|-------------|--------------|
| 11–16 | „Du bist Glev … Deine Aufgabe … Stil …" (Rolle + Tone split) | `## ROLE` (zusammengeführt) |
| 18–22 | „Strikte Grenzen (niemals brechen)" | `## SAFETY RULES` #1–4 |
| 24–26 | „Stil:" (Plaintext, nicht alarmistisch) | `## ROLE` (gemerged) |
| 28–30 | Tool-Übersicht READ + WRITE Liste | `## TOOL CATALOG` Header |
| 31 | MULTI-ENTRY | `## INTERACTION RULES` – Multi-Entry |
| 32 | BOLUS-BERECHNUNG / navigate_to | `## SAFETY RULES` #5 |
| 33 | WICHTIG — Bolus vs. Basal (READ) | `## TOOL CATALOG / READ-Tools` |
| 34 | WICHTIG — Zeitangaben (Lokalzeit) | `## TOOL CATALOG / READ-Tools` |
| 35 | READ-Tools aktiv nutzen | `## TOOL CATALOG / READ-Tools` |
| 36 | get_check_history | `## TOOL CATALOG / READ-Tools` |
| 37 | GEWOHNHEITS- UND MUSTERFRAGEN | `## TOOL CATALOG / READ-Tools` |
| 38 | Nur abgerufene Daten | `## SAFETY RULES` #8 |
| 39 | Keine Daten → ehrlich | `## TOOL CATALOG / READ-Tools` |
| 41–43 | WRITE-Tools intro + UI-Gate | `## TOOL CATALOG / WRITE-Tools` intro |
| 44 | log_exercise_entry | `## TOOL CATALOG / WRITE-Tools` |
| 45 | log_symptom_entry | `## TOOL CATALOG / WRITE-Tools` |
| 46 | log_influence_entry + Alkohol-Sperre | `## TOOL CATALOG / WRITE-Tools` |
| 47 | log_cycle_entry | `## TOOL CATALOG / WRITE-Tools` |
| 48 | BOLUS vs. BASAL (Loggen) | `## TOOL CATALOG / WRITE-Tools` log_bolus/basal |
| 49 | NIEMALS Dosis empfehlen ohne Zahl | `## SAFETY RULES` #6 |
| 50 | Zeitpunkt des Loggings (logged_at) | `## INTERACTION RULES` – Zeitpunkt |
| 51 | edit_macro | `## TOOL CATALOG / WRITE-Tools` log_meal_entry |
| 52–57 | log_meal_entry + items[]-Regel + Beispiele | `## TOOL CATALOG / WRITE-Tools` log_meal_entry |
| 58–68 | ALKOHOL-PFLICHT-REGEL + 8 Few-Shots | `## TOOL CATALOG / WRITE-Tools` log_meal_entry |
| 69 | FOTO-MAHLZEIT | `## TOOL CATALOG / WRITE-Tools` log_meal_entry |
| 70 | Nach Tool-Call Textregeln | `## INTERACTION RULES` – Nach WRITE-Tool |
| 71 | BESTÄTIGUNGS-LOOP | `## INTERACTION RULES` – BESTÄTIGUNGS-LOOP |
| 72 | add_appointment Datumskonvertierung | `## TOOL CATALOG / WRITE-Tools` add_appointment |
| 73 | log_fingerstick mmol/L → mg/dL | `## TOOL CATALOG / WRITE-Tools` log_fingerstick |
| 74 | add_timeline_check | `## TOOL CATALOG / WRITE-Tools` add_timeline_check |
| 76–90 | Feedback-Funnel + submit_structured_feedback | `## TOOL CATALOG / WRITE-Tools` submit_structured_feedback |
| 90 | COMPLIANCE-GUARD | `## SAFETY RULES` #7 |
| 92–97 | User-Memory (save_user_observation) | `## MEMORY` |

---

## Konsolidierte Redundanzen

| # | Redundanz | Alter Ort | Lösung |
|---|-----------|-----------|--------|
| 1 | „max. 3 Sätze" | Zeilen 15 + 16 (doppelt) | Einmal in `## ROLE` |
| 2 | `WICHTIG`-Marker | Zeilen 33, 34, 53 | Entfernt — Sektions-Header gibt Kontext |
| 3 | `KRITISCH`-Marker | Zeilen 71, 77 | Entfernt — Inhalt bleibt, Label weg |
| 4 | WRITE-Tools Listung | Zeile 30 (Liste) + Zeilen 41–43 (erneute Einleitung) | Einmalige intro-Zeile in WRITE-Sektion |
| 5 | Dosis-Regel gesplittet | Zeile 32 (navigate_to) + Zeile 49 (NIEMALS raten) | Zusammengeführt in SAFETY #5 + #6 |
| 6 | BESTÄTIGUNGS-LOOP embedded | Zeile 71 (mitten in WRITE-Sektion) | Eigenständige Rule in `## INTERACTION RULES` |
| 7 | Stil-Abschnitt | Zeilen 24–26 (eigene Sektion) | In `## ROLE` gemerged |
| 8 | COMPLIANCE-GUARD | Zeile 90 (Ende Feedback-Sektion) | In `## SAFETY RULES` #7 hochgezogen |
| 9 | feedback categories (verbose) | Zeilen 83–88 (6 bullet-Blöcke) | Kompakte Dot-Notation (eine Zeile) |
| 10 | feedback severity (verbose) | Zeile 89 | Kompakte Dot-Notation |

---

## Semantische Preservation-Checkliste

### 4 Hard Constraints (alle vorhanden)
- [x] Kein Medizinprodukt / keine Dosisempfehlung (SAFETY #1)
- [x] Keine Diagnose / Boli nicht bewerten (SAFETY #2)
- [x] Auffälligkeiten → Diabetes-Team (SAFETY #3)
- [x] Notfall → sofort KH / Notarzt (SAFETY #4)

### 11 Tool-Calling-Regeln (alle vorhanden)
- [x] MULTI-ENTRY (INTERACTION RULES)
- [x] BOLUS navigate_to → engine_bolus (SAFETY #5)
- [x] Bolus vs. Basal READ (READ-Tools)
- [x] Zeitfelder Lokalzeit (READ-Tools)
- [x] READ aktiv nutzen (READ-Tools)
- [x] get_check_history (READ-Tools)
- [x] GEWOHNHEITS-Regel → limit:20 (READ-Tools)
- [x] WRITE UI-Gate (WRITE intro)
- [x] BESTÄTIGUNGS-LOOP (INTERACTION RULES)
- [x] Nach log_meal_entry kein Text (log_meal_entry)
- [x] add_timeline_check meal_id aus Tool-Result (add_timeline_check)

### 8 Alkohol-Beispiele (alle vorhanden, Zahlen identisch)
- [x] Bockwurst + Bier (500ml, 20g alcohol_g)
- [x] 0,5l Bier / ein Bier (500ml, 20g)
- [x] 0,33l Bier (330ml, 13g)
- [x] Rotwein 0,2l (200ml, 16g)
- [x] Aperol Spritz (200ml, 12g)
- [x] Vodka Tonic (250ml, 13g)
- [x] Whiskey 4cl (40ml, 13g)
- [x] alkoholfreies Bier (500ml, 0g)
