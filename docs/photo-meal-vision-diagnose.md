# Photo-Meal-Vision Diagnose (2026-06-20)

## Symptom

Camera-Upload klappt: Bild erscheint im Chat. LLM antwortet: „Ich kann keine Bilder sehen oder analysieren."
Erwartung: Foto → Macros-Schätzung → Mini-Preview-Chip.

## Root Cause 1 — Images nicht in Phase 1 (Hauptursache)

**Datei:** `app/api/ai/chat/route.ts`

Die Chat-Route hat zwei Phasen:
- **Phase 1** (non-streaming, `tools: GLEV_TOOLS`): Modell kann Tool-Calls machen (z. B. `log_meal_entry`), sieht aber **kein Bild**.
- **Phase 2** (streaming, kein `tools`): Modell sieht **jetzt das Bild**, kann aber **keine Tools** mehr aufrufen.

Vor dem Fix wurden `imageAttachments` und die `image_url`-Transformation erst in Phase 2 (ab Zeile ~1083) aufgebaut und angewendet. Das Modell sah das Foto erst, als keine Tools mehr verfügbar waren → konnte `log_meal_entry` nie aus einem Bild-Input auslösen.

**Fix:** `imageAttachments` / `pdfAttachments` / `hasImages` vor Phase 1 hoisten. Image-Transformation auf das letzte User-Message-Objekt **vor** Phase 1 anwenden, sodass das Modell das Foto im Tool-Call-Round sieht und `log_meal_entry` (mit `from_photo=true`) aufrufen kann.

## Root Cause 2 — Kein System-Prompt-Instruction für Foto-Mahlzeit

**Datei:** `lib/ai/glevChatPrompt.ts`

Das System-Prompt hatte keinerlei Anweisung, was das Modell tun soll, wenn ein Bild im Chat angehängt ist. Ohne explizite Instruktion verhält sich gpt-4o-mini defensiv und beschreibt das Bild nur textuell (oder sagt, es könne keine Bilder sehen, wenn das Format nicht unterstützt wird).

**Fix:** Neue `FOTO-MAHLZEIT`-Instruktion eingefügt: Wenn ein Bild vorhanden ist, sofort `log_meal_entry` mit `from_photo=true`, `items[]` pro Komponente, und `input_text` aufrufen. Kein Text danach.

## Root Cause 3 — HEIC-Format nicht von OpenAI unterstützt

**Datei:** `components/GlevAIChatSheet.tsx`

iOS-Kamera speichert Fotos standardmäßig als HEIC. OpenAI gpt-4o-mini unterstützt nur JPEG, PNG, WEBP, GIF. Das Upload-Endpoint akzeptierte HEIC → Datei landet in Storage → OpenAI bekommt ein Format, das es nicht dekodieren kann → „Ich kann dieses Bild nicht sehen."

**Fix:** Client-seitige HEIC/HEIF-Ablehnung in `addFiles` mit Toast-Meldung. Der User sieht sofort: „HEIC-Format nicht unterstützt – bitte JPEG/PNG verwenden."

## Vision-Modell-Wahl

**Modell:** `gpt-4o-mini` (bereits im Einsatz als Standard-Chat-Modell)

Keine zusätzliche API-Key-Konfiguration nötig:
- `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` (Replit AI Integration)
- Fallback: `OPENAI_API_KEY`

gpt-4o-mini hat Vision built-in. Kein separater Vision-Endpoint nötig.

## Neues `from_photo` Tool-Parameter

`log_meal_entry` bekommt ein optionales `from_photo: boolean`-Feld. Wenn `true`:
- `toolLogMealEntry` überschreibt `resolvedNutritionSource = "vision_estimate"` (nach Aggregator-Lauf)
- SSE-Frame enthält `nutritionSource: "vision_estimate"`
- `MealChipExpanded` zeigt `📷 Foto`-Badge statt `✨ KI`

## Neuer AggregateSource-Wert

`"vision_estimate"` in `lib/nutrition/types.ts` → AggregateSource.
`aggregateSourceLabel()` in `lib/nutrition/badgeFor.ts` → "Foto" (de) / "Photo" (en).

## Geänderte Dateien

| Datei | Änderung |
|---|---|
| `app/api/ai/chat/route.ts` | Image-Transformation vor Phase 1 hoisten; Phase-2-Block bereinigt |
| `lib/ai/glevChatPrompt.ts` | `FOTO-MAHLZEIT`-Instruktion hinzugefügt |
| `lib/ai/glevTools.ts` | `from_photo`-Param + `vision_estimate`-Override |
| `lib/nutrition/types.ts` | `"vision_estimate"` zu AggregateSource |
| `lib/nutrition/badgeFor.ts` | `aggregateSourceLabel()` hinzugefügt |
| `components/GlevAIChatSheet.tsx` | HEIC-Ablehnung + `📷 Foto`-Badge |
