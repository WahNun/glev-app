# Fix Report — Glev AI Toggle in Settings hakt

**Datum:** 2026-06-12
**Task:** Kein Asana-Task (direktes User-Feedback)

## Problem

Der Glev-AI-Toggle in `/settings/ai` hakte beim schnellen An/Aus/An-Schalten.

## Root Causes (3 Bugs)

**Bug 1 (Hauptbug):** `toggleAiConsent(next)` hatte `if (aiConsentBusy) return` auch
für den `next===true`-Zweig. Während ein DELETE in-flight ist (nach OFF-Klick) wurde
ein sofortiger ON-Klick silent geblockt — kein Modal, keine Reaktion.

**Bug 2 (UX):** `grantConsent()` in `lib/useGlevAI.ts` rief immer `setSheetOpen(true)`.
Von der Settings-Seite aus öffnete sich der Chat-Sheet ungewollt über der Settings-Seite.
User musste Sheet erst schließen um wieder auf Settings zu landen.

**Bug 3 (UX):** Toggle blieb nach Consent-Annahme ~200ms auf OFF, bis der
Supabase-Re-fetch in Settings abgeschlossen war (sichtbarer Flicker).

## Lösungen

**Fix 1** (`app/(protected)/settings/ai/page.tsx`):
`aiConsentBusy`-Guard nur noch für den OFF-Pfad. ON-Pfad dispatcht Modal-Event
immer (kein Write-Konflikt, da kein Write passiert bis User Accept klickt).

**Fix 2** (`lib/useGlevAI.ts`):
`consentFromExternalRef = useRef(false)`:
- Wird `true` wenn `glev:ai-open-consent-modal` Event feuert (Settings-Trigger)
- Wird `false` bei FAB-Tap (`openFromButton`) + `dismissConsent()`
`grantConsent()` liest Ref + resettet ihn: wenn `fromExternal=true` → kein
`setSheetOpen(true)` → User bleibt auf Settings-Seite.

**Fix 3** (`app/(protected)/settings/ai/page.tsx`):
`glev:ai-consent-granted`-Listener setzt `aiConsentGranted = true` sofort
(optimistisch, Event feuert nur nach erfolgreichem POST), dann re-fetch zur
Bestätigung.

## Geänderte Dateien
- `lib/useGlevAI.ts` — consentFromExternalRef, openFromButton, dismissConsent, grantConsent, onOpenModal
- `app/(protected)/settings/ai/page.tsx` — toggleAiConsent guard, onConsentGranted listener
