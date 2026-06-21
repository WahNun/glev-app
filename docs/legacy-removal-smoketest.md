# Legacy AI Removal — Smoke Test Checklist
**Branch**: `refactor/remove-legacy-ai`  
**Sprint completed**: 2026-06-19  
**Build status**: TypeScript ✓, Compiled ✓ (Supabase URL error in local page-data collection is pre-existing env issue, not related to our changes)

---

## Commits in this sprint

| # | Commit | Description |
|---|--------|-------------|
| 1 | `783b7456` | docs: legacy-ai-removal-plan.md (Phase 1 diagnosis) |
| 2 | `12bc56b7` | refactor(ai): delete AiHelperSheet.tsx (zero callers) |
| 3 | `ab11c050` | fix(engine): consentLoaded guard — prevent Flash-of-Old-UI |
| 4 | `e253701d` | refactor(engine): remove startRecording/handleVoice/recording state |
| 5 | `47b6d2e8` | refactor(ai): replace legacy-navigate with open-paywall in fabAction |
| 6 | `c5d7804a` | refactor(ai): remove orphan /api/transcribe route and its unit tests |
| 7 | `91f03be6` | refactor(ai): Phase 3 cleanup — VoiceRecordingContext and voice=1 remnants |

---

## Manual smoke test scenarios

### /engine — Flash-of-Old-UI fix
- [ ] Sign in as a user WITH Glev AI consent (Smart/Pro tier)
- [ ] Navigate to /engine
- [ ] The old voice start button and EngineChatPanel should NOT flash before the Glev AI fullscreen opens
- [ ] The Macros-Prüfen button (Step 1 → Step 2) should be responsive and not get obscured

### /engine — No AI user
- [ ] Sign in as a free user (no ai_voice flag, no Smart/Pro plan)
- [ ] Navigate to /engine
- [ ] The EngineChatPanel ("AI FOOD PARSER") should appear (for non-consented users)
- [ ] No recording button should appear anywhere in the engine page

### FAB — Free user
- [ ] As a free user on any page (/dashboard, /entries, /insights, /settings)
- [ ] Tap the Glev FAB
- [ ] PaywallSheet should open with `initialTier="smart"` (Smart tier highlighted)
- [ ] NOT navigate to /engine?voice=1

### FAB — Smart/Pro user (consented)
- [ ] Tap FAB on /engine → opens fullscreen Glev AI chat
- [ ] Tap FAB on /dashboard → navigates to /glev-ai
- [ ] No "Speak" pill in header (removed)
- [ ] FAB aria-label stays "Glev" always (no "Aufnahme beenden" suffix)

### Quick-add — Voice entry removed
- [ ] Tap the "+" quick-add menu in the header
- [ ] The "open_engine" entry should navigate to `/engine?tab=engine` (NO ?voice=1)
- [ ] No auto-recording should start on the engine page

### /settings/ai — No hang
- [ ] Navigate to /settings/ai
- [ ] Page should load without hanging or staying blank
- [ ] (Note: if still blank, this is a usePlan/useFeatureFlag loading issue separate from this sprint)

### Glev AI Chat — Still works
- [ ] As Smart/Pro user, open GlevAIChatSheet (swipe up or via /glev-ai)
- [ ] Hold-to-talk mic button works (useVoxtral → /api/transcribe/mistral/stream)
- [ ] Chat responses work (Mistral via /api/ai/chat)
- [ ] Intent routing works (/api/ai/classify-intent still active)

---

## What was removed

| File | Reason |
|------|--------|
| `components/AiHelperSheet.tsx` | Zero callers — Phase-1 placeholder replaced by GlevAIChatSheet |
| `app/api/transcribe/route.ts` | Only caller was handleVoice (now removed); active STT path uses /mistral/stream |
| `tests/unit/openai429.test.ts` | Only tested exports from the deleted route |
| Engine `startRecording()` / `handleVoice()` | Legacy MediaRecorder → /api/transcribe → /api/parse-food path |
| `VoiceRecordingProvider` + `useVoiceRecording` | voice.recording was always false after engine removal |
| `arrowHint` state + effect in Layout | Driven by voice.recording (always false) |
| `?voice=1` in quick-add href | Auto-start effect removed from engine page |
| e2e voice-recording-while-tab-switching test | Tested the removed code path |

## What was NOT removed (still active)

- `/api/ai/classify-intent` — used by useVoiceIntents in GlevAIChatSheet
- `/api/transcribe/mistral` and `/api/transcribe/mistral/stream` — used by useVoxtral
- `EngineChatPanel` — still active for non-consented users (food text parser)
- `lib/fabAction.ts` — kept, `legacy-navigate` replaced with `open-paywall`
- `lib/voiceRecordingContext.tsx` — file kept (exported but no longer imported by Layout)
